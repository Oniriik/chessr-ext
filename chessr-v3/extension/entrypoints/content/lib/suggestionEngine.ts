/**
 * SuggestionEngine — runs Komodo Dragon WASM in a WebWorker via Blob URL
 * (same CSP-workaround pattern as AnalysisEngine). MultiPV, per-search setoption,
 * capability discovery at init.
 */

import { buildEngineSetOptions, type EngineParams } from './engineConfig.js';
import { buildGoCommand, type SearchOptions } from './searchOptions.js';
import { labelSuggestions, type LabeledSuggestion, type Suggestion } from './engineLabeler.js';

const HASH_MB = 64;
const SEARCH_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 10_000;

export interface SuggestionSearchParams extends EngineParams {
  fen: string;
  moves?: string[];
  search?: SearchOptions;
}

export class SuggestionEngine {
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private _ready = false;
  private _supportedOptions: Set<string> = new Set();

  private activeResolve: ((s: LabeledSuggestion[]) => void) | null = null;
  private activeReject: ((e: Error) => void) | null = null;
  private activeListener: ((e: MessageEvent) => void) | null = null;
  private activeFen: string | null = null;
  private activeMultiPv = 1;
  private activeTimer: ReturnType<typeof setTimeout> | null = null;
  private activeResults: Map<string, Suggestion> = new Map();
  private cancelling: Promise<void> | null = null;

  // Fullmove number of the last searched FEN — used as a safety net to detect
  // a game rewind or a new game the host forgot to signal, in which case we
  // implicitly fire ucinewgame before the search proceeds.
  private lastFullmove: number | null = null;

  get ready() { return this._ready; }
  get supportedOptions(): ReadonlySet<string> { return this._supportedOptions; }

  async init(jsUrl: string, wasmUrl: string, bookUrl?: string): Promise<void> {
    const response = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: new URL(jsUrl).pathname,
    }) as { text?: string; error?: string };
    if (response.error || !response.text) {
      throw new Error(`Failed to fetch dragon.js: ${response.error}`);
    }

    const blob = new Blob([response.text], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    // Hash fragment carries wasm URL (required) + optional book URL,
    // separated by '|'. Glue reads both during Worker bootstrap.
    const hash =
      encodeURIComponent(wasmUrl) +
      (bookUrl ? '|' + encodeURIComponent(bookUrl) : '');
    this.worker = new Worker(this.blobUrl + '#' + hash);

    // Phase 1: collect options during `uci` → `uciok`.
    await this.withTimeout(
      new Promise<void>((resolve) => {
        const onMessage = (e: MessageEvent) => {
          const line = typeof e.data === 'string' ? e.data : '';
          if (line.startsWith('option name ')) {
            const m = line.match(/^option name (.+?) type /);
            if (m) this._supportedOptions.add(m[1]);
          } else if (line.includes('uciok')) {
            this.worker!.removeEventListener('message', onMessage);
            resolve();
          }
        };
        this.worker!.addEventListener('message', onMessage);
        this.sendRaw('uci');
      }),
      INIT_TIMEOUT_MS,
      'uci init timeout',
    );

    if (this._supportedOptions.has('Hash')) this.sendRaw(`setoption name Hash value ${HASH_MB}`);
    if (this._supportedOptions.has('Threads')) this.sendRaw('setoption name Threads value 1');

    await this.withTimeout(
      this.waitForToken('readyok', () => this.sendRaw('isready')),
      INIT_TIMEOUT_MS,
      'isready timeout',
    );

    if (!this._supportedOptions.has('MultiPV')) {
      throw new Error('Dragon WASM does not advertise MultiPV — cannot run suggestions');
    }

    this._ready = true;
    // Initial game boundary — clears any residual state from prior init.
    await this.newGame();
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this.worker || !this._ready) throw new Error('SuggestionEngine not initialised');

    if (this.activeResolve) await this.cancel();

    // Safety net: if fullmove number regressed, the host likely didn't emit
    // chessr:newGame (e.g., puzzle retry, daily-bot restart, SPA edge case).
    // Reset engine state so residual transposition data for the previous game
    // doesn't skew this new game's analysis.
    const currentFullmove = parseFullmove(params.fen);
    if (this.lastFullmove !== null && currentFullmove < this.lastFullmove) {
      await this.newGame();
    }
    this.lastFullmove = currentFullmove;

    return new Promise<LabeledSuggestion[]>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.activeFen = params.fen;
      this.activeMultiPv = Math.max(1, Math.min(3, params.multiPv));
      this.activeResults = new Map();

      this.activeTimer = setTimeout(() => {
        this.abortActive(new Error('Search timeout'));
      }, SEARCH_TIMEOUT_MS);

      this.activeListener = (e: MessageEvent) => this.onSearchLine(typeof e.data === 'string' ? e.data : '');
      this.worker!.addEventListener('message', this.activeListener);

      const opts = buildEngineSetOptions(params, this._supportedOptions);
      for (const [k, v] of Object.entries(opts)) this.sendRaw(`setoption name ${k} value ${v}`);

      this.sendRaw('isready');
      this.waitForToken('readyok').then(() => {
        if (this.activeResolve !== resolve) return; // cancelled meanwhile
        const movesSuffix = params.moves?.length ? ` moves ${params.moves.join(' ')}` : '';
        this.sendRaw(`position fen ${params.fen}${movesSuffix}`);
        this.sendRaw(buildGoCommand(params.search ?? null, 'dragon'));
      });
    });
  }

  /**
   * Signal a new game boundary to the engine. Clears the transposition table
   * and lets Dragon reset per-game state. Should be called exactly once per
   * game (at start or on transition), NOT between consecutive positions of
   * the same game — otherwise analysis cached between moves gets thrown away.
   */
  async newGame(): Promise<void> {
    if (!this.worker || !this._ready) return;
    this.lastFullmove = null;
    this.sendRaw('ucinewgame');
    await this.waitForToken('readyok', () => this.sendRaw('isready'));
  }

  destroy(): void {
    if (this.activeResolve) this.abortActive(new Error('Engine destroyed'));
    if (this.worker) {
      try { this.sendRaw('quit'); } catch { /* ignore */ }
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this._ready = false;
  }

  /**
   * Cancel any in-flight search. The rejected caller receives an AbortError,
   * letting content.tsx silently ignore cancellations without risking stale
   * arrows from the old request being set on the store.
   *
   * Public so the content script can call it on game end / new game transitions.
   */
  async cancel(): Promise<void> {
    if (!this.activeResolve) return;
    if (this.cancelling) return this.cancelling;

    // Swap trick: we've sent `stop`; UCI will emit one final `bestmove` that
    // would normally call activeResolve. Replace activeResolve to instead
    // REJECT the original caller (with AbortError) and unblock cancel().
    // Guarantees the UCI buffer is drained before the next search starts.
    this.cancelling = new Promise<void>((resolve) => {
      const prevReject = this.activeReject!;
      this.activeResolve = () => {
        prevReject(new DOMException('Suggestion search cancelled', 'AbortError'));
        resolve();
      };
      this.sendRaw('stop');
    });
    await this.cancelling;
    this.cancelling = null;
  }

  private abortActive(err: Error): void {
    if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
    if (this.activeListener && this.worker) this.worker.removeEventListener('message', this.activeListener);
    this.activeListener = null;
    const reject = this.activeReject;
    this.activeResolve = null; this.activeReject = null; this.activeFen = null;
    this.activeResults = new Map();
    reject?.(err);
  }

  private onSearchLine(line: string) {
    if (!line) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const parsed = parseInfo(line);
      if (parsed) {
        if (this.activeFen && this.activeFen.split(' ')[1] === 'b') {
          parsed.evaluation = -parsed.evaluation;
          if (parsed.mateScore !== null) parsed.mateScore = -parsed.mateScore;
          [parsed.winRate, parsed.lossRate] = [parsed.lossRate, parsed.winRate];
        }
        this.activeResults.set(parsed.move, parsed);
      }
    } else if (line.startsWith('bestmove')) {
      const resolve = this.activeResolve;
      const fen = this.activeFen!;
      const mp = this.activeMultiPv;
      let raws = Array.from(this.activeResults.values())
        .sort((a, b) => a.multipv - b.multipv)
        .slice(0, mp);

      // Book move fallback: when Komodo plays from its opening book it emits
      // `bestmove X` WITHOUT any prior `info` lines. Synthesise a single-move
      // suggestion so the arrow still renders (eval/depth unknown, flag depth=0).
      if (raws.length === 0) {
        const bestMove = line.split(/\s+/)[1];
        if (bestMove && bestMove !== '(none)' && bestMove.length >= 4) {
          raws = [{
            multipv: 1,
            move: bestMove,
            evaluation: 0,
            depth: 0,
            winRate: 50,
            drawRate: 0,
            lossRate: 50,
            mateScore: null,
            pv: [bestMove],
          }];
        }
      }

      if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
      if (this.activeListener && this.worker) this.worker.removeEventListener('message', this.activeListener);
      this.activeListener = null;
      this.activeResolve = null; this.activeReject = null; this.activeFen = null;
      this.activeResults = new Map();
      if (resolve) resolve(labelSuggestions(raws, fen));
    }
  }

  private sendRaw(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitForToken(token: string, trigger?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.includes(token)) {
          this.worker!.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMessage);
      trigger?.();
    });
  }

  private withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(msg)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}

/** FEN fullmove (field 6, 1-indexed, increments after black's move). */
function parseFullmove(fen: string): number {
  const parts = fen.split(' ');
  const n = parseInt(parts[5] ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseInfo(line: string): Suggestion | null {
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  if (!pvMatch) return null;
  const pv = pvMatch[1].split(/\s+/).filter((m) => m.length >= 4);
  if (!pv.length) return null;

  const multipv = parseInt(line.match(/\bmultipv\s+(\d+)/)?.[1] || '1');
  const depth = parseInt(line.match(/\bdepth\s+(\d+)/)?.[1] || '0');

  let evaluation = 0;
  let mateScore: number | null = null;
  let winRate = 50, drawRate = 0, lossRate = 50;

  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);

  if (mateMatch) {
    mateScore = parseInt(mateMatch[1]);
    evaluation = mateScore > 0 ? 10000 : -10000;
    winRate = mateScore > 0 ? 100 : 0;
    drawRate = 0;
    lossRate = mateScore > 0 ? 0 : 100;
  } else if (cpMatch) {
    evaluation = parseInt(cpMatch[1]);
  }

  if (wdlMatch) {
    winRate = parseInt(wdlMatch[1]) / 10;
    drawRate = parseInt(wdlMatch[2]) / 10;
    lossRate = parseInt(wdlMatch[3]) / 10;
  } else if (!mateMatch && cpMatch) {
    winRate = 50 + 50 * (2 / (1 + Math.exp(-evaluation / 400)) - 1);
    winRate = Math.round(winRate * 10) / 10;
    lossRate = Math.round((100 - winRate) * 10) / 10;
  }

  return {
    multipv, move: pv[0], evaluation, depth,
    winRate: Math.round(winRate * 10) / 10,
    drawRate: Math.round(drawRate * 10) / 10,
    lossRate: Math.round(lossRate * 10) / 10,
    mateScore, pv,
  };
}
