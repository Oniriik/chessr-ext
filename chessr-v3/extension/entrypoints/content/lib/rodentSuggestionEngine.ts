/**
 * RodentSuggestionEngine — runs Rodent IV (built from sources via
 * scripts/build-rodent-wasm.sh) in a WebWorker. Rodent is a vanilla
 * Emscripten build, so we prepend a small worker glue that:
 *   - wires `postMessage` → stdin via FS.init() callback
 *   - wires Module.print → postMessage (UCI output)
 *   - maps wasm/data file requests to extension URLs via locateFile
 *
 * Pattern mirrors SuggestionEngine (Dragon/Komodo) but does not share code
 * since the worker bootstrap is different — Dragon's glue handles the
 * stdin/locateFile dance internally; Rodent's plain Emscripten output does
 * not.
 *
 * Build flags include `-sASYNCIFY=1` so std::getline() in Rodent's main UCI
 * loop can pause the C++ stack while waiting for postMessage input.
 */

import { buildGoCommand, type SearchOptions } from './searchOptions.js';
import { labelSuggestions, type LabeledSuggestion, type Suggestion } from './engineLabeler.js';
import type { IEngine, SuggestionSearchParams as IEngineSearchParams } from './engineApi';
import type { EngineCapabilities } from '../stores/engineStore';

const HASH_MB = 32;
const SEARCH_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 15_000;

/** Worker preamble prepended to rodent.js — wires Emscripten Module hooks
 *  to postMessage for both stdin and stdout. The `location.hash` carries the
 *  wasm + data URLs since `new Worker(blobUrl)` can't propagate them through
 *  the blob source on its own. */
const WORKER_GLUE = `
self.Module = self.Module || {};
let stdinBuf = '';
const hashParts = (location.hash || '#').slice(1).split('|').map(decodeURIComponent);
const wasmUrl = hashParts[0] || '';
const dataUrl = hashParts[1] || '';
self.Module.locateFile = (path) => {
  if (path.endsWith('.wasm')) return wasmUrl;
  if (path.endsWith('.data')) return dataUrl;
  return path;
};
self.Module.print = (t) => self.postMessage(t);
self.Module.printErr = (t) => self.postMessage(t);
self.Module.preRun = [function() {
  // Asyncify pause: returning null tells Emscripten "no input now"; with
  // -sASYNCIFY=1 the C++ stack pauses, yields to the JS event loop, and
  // resumes once stdinBuf grows.
  FS.init(function stdin() {
    if (stdinBuf.length === 0) return null;
    const c = stdinBuf.charCodeAt(0);
    stdinBuf = stdinBuf.slice(1);
    return c;
  });
}];
self.onmessage = function(e) {
  if (typeof e.data === 'string') {
    stdinBuf += e.data + '\\n';
  }
};
`;

export interface RodentSearchParams extends IEngineSearchParams {
  // Rodent-specific knobs
  eloTarget?: number;       // 800..2800 (used when limitStrength)
  limitStrength?: boolean;
  imprecision?: number;     // 0..100 (mapped to EvalBlur)
  personality?: string;     // e.g. 'karpov', 'default'
  multiPv?: number;
  fen: string;
  moves?: string[];
  search?: SearchOptions;
}

export class RodentSuggestionEngine implements IEngine {
  readonly id = 'rodent' as const;
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

  // Cached options applied — skip re-sending unchanged values to avoid spam.
  private lastApplied: {
    elo?: number;
    limitStrength?: boolean;
    imprecision?: number;
    personality?: string;
    multiPv?: number;
  } = {};

  get ready() { return this._ready; }
  get supportedOptions(): ReadonlySet<string> { return this._supportedOptions; }

  async init(): Promise<void> {
    const jsUrl = browser.runtime.getURL('/engine/rodent/rodent.js');
    const wasmUrl = browser.runtime.getURL('/engine/rodent/rodent.wasm');
    const dataUrl = browser.runtime.getURL('/engine/rodent/rodent.data');

    const response = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: new URL(jsUrl).pathname,
    }) as { text?: string; error?: string };
    if (response.error || !response.text) {
      throw new Error(`Failed to fetch rodent.js: ${response.error}`);
    }

    const fullSource = WORKER_GLUE + response.text;
    const blob = new Blob([fullSource], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    const hash =
      encodeURIComponent(wasmUrl) + '|' + encodeURIComponent(dataUrl);
    this.worker = new Worker(this.blobUrl + '#' + hash);

    // Phase 1: drive UCI handshake, collect advertised options.
    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
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
        this.worker!.addEventListener('error', (err) => {
          reject(new Error('Rodent worker error: ' + ((err as ErrorEvent).message ?? 'unknown')));
        }, { once: true });
        // Tiny delay to let preRun + FS.init wire up before pushing UCI.
        setTimeout(() => this.sendRaw('uci'), 50);
      }),
      INIT_TIMEOUT_MS,
      'uci init timeout',
    );

    if (this._supportedOptions.has('Hash')) {
      this.sendRaw(`setoption name Hash value ${HASH_MB}`);
    }
    // UseBook stays true (default) — Rodent's full opening books are
    // preloaded into MEMFS at /books/ via Emscripten --preload-file. Each
    // personality .txt sets its own MainBookFile/GuideBookFile, so GMs play
    // their authentic opening repertoires (Karpov → players/ph-karpov2.bin,
    // etc.).

    await this.withTimeout(
      this.waitForToken('readyok', () => this.sendRaw('isready')),
      INIT_TIMEOUT_MS,
      'isready timeout',
    );

    if (!this._supportedOptions.has('MultiPV')) {
      throw new Error('Rodent WASM does not advertise MultiPV — cannot run suggestions');
    }

    this._ready = true;
    await this.newGame();
  }

  getCapabilities(): EngineCapabilities {
    const s = this._supportedOptions;
    return {
      hasPersonality: s.has('PersonalityFile'),
      hasUciElo: s.has('UCI_Elo'),
      hasDynamism: false,
      hasKingSafety: false,
      hasVariety: false,
    };
  }

  async search(params: RodentSearchParams): Promise<LabeledSuggestion[]> {
    if (!this.worker || !this._ready) throw new Error('RodentSuggestionEngine not initialised');
    if (this.activeResolve) await this.cancel();

    return new Promise<LabeledSuggestion[]>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.activeFen = params.fen;
      this.activeMultiPv = Math.max(1, Math.min(3, params.multiPv ?? 1));
      this.activeResults = new Map();

      this.activeTimer = setTimeout(() => {
        this.abortActive(new Error('Search timeout'));
      }, SEARCH_TIMEOUT_MS);

      this.activeListener = (e: MessageEvent) =>
        this.onSearchLine(typeof e.data === 'string' ? e.data : '');
      this.worker!.addEventListener('message', this.activeListener);

      this.applyRodentOptions(params);

      this.sendRaw('isready');
      this.waitForToken('readyok').then(() => {
        if (this.activeResolve !== resolve) return;
        const movesSuffix = params.moves?.length ? ` moves ${params.moves.join(' ')}` : '';
        this.sendRaw(`position fen ${params.fen}${movesSuffix}`);
        this.sendRaw(buildGoCommand(params.search ?? null, 'dragon'));
      });
    });
  }

  /** Send only the options that changed since last search — Rodent re-parses
   *  every setoption synchronously, so spamming all 5 each call slows things
   *  for ~no benefit. */
  private applyRodentOptions(p: RodentSearchParams): void {
    const elo = clamp(p.eloTarget ?? 1800, 800, 2800);
    const limitStrength = p.limitStrength ?? true;
    const imprecision = clamp(p.imprecision ?? 0, 0, 100);
    const personality = p.personality ?? 'default';
    const multiPv = this.activeMultiPv;

    const opts: Record<string, string | number> = {};

    if (this._supportedOptions.has('UCI_LimitStrength') &&
        this.lastApplied.limitStrength !== limitStrength) {
      opts['UCI_LimitStrength'] = limitStrength ? 'true' : 'false';
      this.lastApplied.limitStrength = limitStrength;
    }
    if (this._supportedOptions.has('UCI_Elo') && this.lastApplied.elo !== elo) {
      opts['UCI_Elo'] = elo;
      this.lastApplied.elo = elo;
    }
    if (this._supportedOptions.has('EvalBlur') &&
        this.lastApplied.imprecision !== imprecision) {
      // Quadratic curve: humanlike "Imprecision 50" ≈ EvalBlur 50,000 (noticeable)
      // Humanlike "Imprecision 100" ≈ EvalBlur 200,000 (blunder-prone)
      opts['EvalBlur'] = Math.round((imprecision * imprecision) * 20);
      this.lastApplied.imprecision = imprecision;
    }
    if (this._supportedOptions.has('PersonalityFile') &&
        this.lastApplied.personality !== personality) {
      // PersonalityFile expects a filename, ext appended.
      opts['PersonalityFile'] = `${personality}.txt`;
      this.lastApplied.personality = personality;
    }
    if (this._supportedOptions.has('MultiPV') && this.lastApplied.multiPv !== multiPv) {
      opts['MultiPV'] = multiPv;
      this.lastApplied.multiPv = multiPv;
    }

    console.log('[Chessr][rodent] setoption payload', opts);
    for (const [k, v] of Object.entries(opts)) {
      this.sendRaw(`setoption name ${k} value ${v}`);
    }
  }

  async newGame(): Promise<void> {
    if (!this.worker || !this._ready) return;
    this.sendRaw('ucinewgame');
    this.lastApplied = {}; // ucinewgame may reset some options
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
    if (this.activeListener && this.worker) {
      this.worker.removeEventListener('message', this.activeListener);
    }
    this.activeListener = null;
    const reject = this.activeReject;
    this.activeResolve = null; this.activeReject = null; this.activeFen = null;
    this.activeResults = new Map();
    reject?.(err);
  }

  private onSearchLine(line: string): void {
    if (!line) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const parsed = parseInfoLine(line);
      if (parsed) {
        if (this.activeFen && this.activeFen.split(' ')[1] === 'b') {
          parsed.evaluation = -parsed.evaluation;
          if (parsed.mateScore !== null) parsed.mateScore = -parsed.mateScore;
          [parsed.winRate, parsed.lossRate] = [parsed.lossRate, parsed.winRate];
        }
        // Index by move so later (deeper) info overrides earlier.
        this.activeResults.set(parsed.move, parsed);
      }
    } else if (line.startsWith('bestmove')) {
      const resolve = this.activeResolve;
      const fen = this.activeFen!;
      const mp = this.activeMultiPv;
      const allRaws = Array.from(this.activeResults.values());

      let raws = allRaws
        .sort((a, b) => a.multipv - b.multipv)
        .slice(0, mp);

      // Book / unexpected bestmove without prior info — synth single entry.
      if (raws.length === 0) {
        const bestMove = line.split(/\s+/)[1];
        if (bestMove && bestMove !== '(none)' && bestMove.length >= 4) {
          raws = [{
            multipv: 1, move: bestMove, evaluation: 0, depth: 0,
            winRate: 50, drawRate: 0, lossRate: 50,
            mateScore: null, pv: [bestMove],
          }];
        }
      }

      if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
      if (this.activeListener && this.worker) {
        this.worker.removeEventListener('message', this.activeListener);
      }
      this.activeListener = null;
      this.activeResolve = null; this.activeReject = null;
      this.activeFen = null; this.activeResults = new Map();

      const labelled = labelSuggestions(raws, fen);
      resolve?.(labelled);
    }
  }

  private sendRaw(msg: string): void {
    if (this.worker) this.worker.postMessage(msg);
  }

  private waitForToken(token: string, trigger?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.includes(token)) {
          this.worker?.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMsg);
      trigger?.();
    });
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Parse one Rodent `info ... pv MOVE...` line into a Suggestion. */
function parseInfoLine(line: string): Suggestion | null {
  const depthM = line.match(/depth\s+(\d+)/);
  const multipvM = line.match(/multipv\s+(\d+)/);
  const cpM = line.match(/score\s+cp\s+(-?\d+)/);
  const mateM = line.match(/score\s+mate\s+(-?\d+)/);
  const pvIdx = line.indexOf(' pv ');
  if (pvIdx < 0) return null;
  const pv = line.slice(pvIdx + 4).trim().split(/\s+/);
  const move = pv[0];
  if (!move || move.length < 4) return null;

  const depth = depthM ? parseInt(depthM[1], 10) : 0;
  const multipv = multipvM ? parseInt(multipvM[1], 10) : 1;
  let evaluation = 0;
  let mateScore: number | null = null;
  if (mateM) {
    mateScore = parseInt(mateM[1], 10);
    evaluation = mateScore > 0 ? 10000 : -10000;
  } else if (cpM) {
    evaluation = parseInt(cpM[1], 10);
  }

  // Convert cp eval to win/draw/loss percentages via logistic — same model
  // as engineLabeler expects but without depending on it directly.
  const winProb = 1 / (1 + Math.exp(-evaluation / 100));
  const winRate = Math.round(winProb * 100);
  const lossRate = 100 - winRate;
  const drawRate = 0;

  return {
    multipv, move, evaluation, depth,
    winRate, drawRate, lossRate, mateScore, pv,
  };
}
