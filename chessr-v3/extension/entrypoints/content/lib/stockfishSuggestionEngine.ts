/**
 * StockfishSuggestionEngine — runs Stockfish WASM in a WebWorker via Blob
 * URL (same CSP-workaround pattern as SuggestionEngine / AnalysisEngine).
 *
 * Differences vs the Komodo Dragon SuggestionEngine:
 *   - binary URLs: /engine/stockfish.js + /engine/stockfish.wasm
 *   - no opening book (Stockfish uses NNUE evaluation; book moves come
 *     from the suggestion-store layer if needed, not from the engine)
 *   - no Personality / Variety / Dynamism / King Safety setoptions —
 *     Stockfish doesn't advertise them, so `buildEngineSetOptions` filters
 *     them out automatically via the `_supportedOptions` set
 *   - id = 'stockfish'
 *
 * The labeling, search loop, cancel semantics and capability discovery
 * are identical and inherited via duplication. A future refactor can
 * parameterise SuggestionEngine to share this code; for now keeping the
 * paths separate avoids breaking the Komodo path during stockfish dev.
 */

import { buildEngineSetOptions, type EngineParams } from './engineConfig.js';
import { buildGoCommand, type SearchOptions } from './searchOptions.js';
import { labelSuggestions, type LabeledSuggestion, type Suggestion } from './engineLabeler.js';
import type { IEngine, SuggestionSearchParams as IEngineSearchParams } from './engineApi';
import type { EngineCapabilities } from '../stores/engineStore';

// Stockfish WASM hash. Stockfish benefits more from large hash than
// Komodo at the same time budget (NNUE eval is heavier per node, fewer
// nodes searched, deeper hash hits more important). 512 MB matches
// Komodo so users see consistent memory usage when switching engines.
const HASH_MB = 512;
const SEARCH_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 10_000;

export interface StockfishSuggestionSearchParams extends EngineParams {
  fen: string;
  moves?: string[];
  search?: SearchOptions;
}

export class StockfishSuggestionEngine implements IEngine {
  readonly id = 'stockfish' as const;
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

  private lastFullmove: number | null = null;

  get ready() { return this._ready; }
  get supportedOptions(): ReadonlySet<string> { return this._supportedOptions; }

  async init(): Promise<void> {
    const jsUrl = browser.runtime.getURL('/engine/stockfish.js');
    const wasmUrl = browser.runtime.getURL('/engine/stockfish.wasm');
    const response = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: new URL(jsUrl).pathname,
    }) as { text?: string; error?: string };
    if (response.error || !response.text) {
      throw new Error(`Failed to fetch stockfish.js: ${response.error}`);
    }

    const blob = new Blob([response.text], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    // No book — Stockfish uses NNUE; hash fragment carries only the wasm URL.
    this.worker = new Worker(this.blobUrl + '#' + encodeURIComponent(wasmUrl));

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
      throw new Error('Stockfish WASM does not advertise MultiPV — cannot run suggestions');
    }

    this._ready = true;
    await this.newGame();
  }

  getCapabilities(): EngineCapabilities {
    const s = this._supportedOptions;
    return {
      hasPersonality: s.has('Personality'),                       // false on Stockfish
      hasUciElo: s.has('UCI Elo') || s.has('UCI_Elo'),             // true on Stockfish
      hasDynamism: s.has('Dynamism'),                              // false on Stockfish
      hasKingSafety: s.has('King Safety'),                         // false on Stockfish
      hasVariety: s.has('Variety'),                                // false on Stockfish
    };
  }

  async search(params: IEngineSearchParams): Promise<LabeledSuggestion[]> {
    if (!this.worker || !this._ready) throw new Error('StockfishSuggestionEngine not initialised');

    if (this.activeResolve) await this.cancel();

    const currentFullmove = parseFullmove(params.fen);
    if (this.lastFullmove !== null && currentFullmove < this.lastFullmove) {
      await this.newGame();
    }
    this.lastFullmove = currentFullmove;

    return new Promise<LabeledSuggestion[]>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.activeFen = params.fen;
      this.activeMultiPv = Math.max(1, Math.min(3, params.multiPv ?? 1));
      this.activeResults = new Map();

      this.activeTimer = setTimeout(() => {
        this.abortActive(new Error('Search timeout'));
      }, SEARCH_TIMEOUT_MS);

      this.activeListener = (e: MessageEvent) => this.onSearchLine(typeof e.data === 'string' ? e.data : '');
      this.worker!.addEventListener('message', this.activeListener);

      const opts = buildEngineSetOptions(params as EngineParams, this._supportedOptions);
      console.log('[Chessr][dbg][sf] setoption payload', opts);
      for (const [k, v] of Object.entries(opts)) this.sendRaw(`setoption name ${k} value ${v}`);

      this.sendRaw('isready');
      this.waitForToken('readyok').then(() => {
        if (this.activeResolve !== resolve) return;
        const movesSuffix = params.moves?.length ? ` moves ${params.moves.join(' ')}` : '';
        this.sendRaw(`position fen ${params.fen}${movesSuffix}`);
        this.sendRaw(buildGoCommand(params.search ?? null, 'stockfish'));
      });
    });
  }

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

  async cancel(): Promise<void> {
    if (!this.activeResolve) return;
    if (this.cancelling) return this.cancelling;

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
      const allRaws = Array.from(this.activeResults.values());
      let raws = allRaws.sort((a, b) => a.multipv - b.multipv).slice(0, mp);

      // bestmove without prior info — synthesise a single move with neutral
      // eval so the arrow still renders. Less common on Stockfish than on
      // Komodo (which has its book), but keep the safety net.
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

function parseFullmove(fen: string): number {
  const parts = fen.split(' ');
  const n = parseInt(parts[5] ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Parse a UCI `info` line into a Suggestion. Identical shape to
 *  suggestionEngine.ts's helper — duplicated locally for now to keep this
 *  engine self-contained. Refactor target: share via engineLabeler. */
function parseInfo(line: string): Suggestion | null {
  const tokens = line.split(/\s+/);
  let multipv = 1, depth = 0, cp: number | null = null, mate: number | null = null;
  let pvStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'multipv') multipv = parseInt(tokens[++i], 10);
    else if (t === 'depth') depth = parseInt(tokens[++i], 10);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = parseInt(tokens[++i], 10);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
    } else if (t === 'pv') { pvStart = i + 1; break; }
  }
  if (pvStart < 0) return null;
  const pv = tokens.slice(pvStart).filter(Boolean);
  if (pv.length === 0) return null;
  const evaluation = mate !== null ? (mate > 0 ? 100 : -100) : (cp ?? 0) / 100;
  const winRate = mate !== null
    ? (mate > 0 ? 100 : 0)
    : Math.max(0, Math.min(100, 50 + (cp ?? 0) / 4));
  return {
    multipv,
    move: pv[0],
    evaluation,
    depth,
    winRate,
    drawRate: 0,
    lossRate: 100 - winRate,
    mateScore: mate,
    pv,
  };
}
