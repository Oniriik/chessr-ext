/**
 * TorchAnalysisEngine — runs torch.wasm in a Worker. Mode-specific:
 *
 *   mode='rich' (default):
 *     fetchFullAnalysis(history) → TorchAnalysis
 *       Chess.com pipeline (`position startpos moves <X>` + `fetch analysis`).
 *       Returns rich JSON with CAPS, effective Elo, native 11-class.
 *       Only valid when game is rooted at startpos.
 *     analyze(fen) → throws (wrong mode).
 *
 *   mode='uci':
 *     analyze(fen) → AnalysisResult
 *       Standard UCI search (`position fen X` + `go depth N`). Works for
 *       any position. Drop-in compatible with AnalysisBackend.
 *     fetchFullAnalysis(history) → throws (wrong mode).
 *
 * Why two modes / two workers: torch's `UseDeclarativePositionCommand`
 * setoption is a Catch-22:
 *   - true  → fetch_analysis emits CAPS / effectiveElo / tallies, but
 *             `position fen X` crashes the wasm.
 *   - false → `position fen X` works, but fetch_analysis emits zeros for
 *             CAPS / effectiveElo (degenerate output).
 * Two parallel workers — one per mode — sidestep the dilemma. Memory cost
 * is 2 × 26 MB ≈ 52 MB.
 *
 * Lifecycle:
 *   const richEng = new TorchAnalysisEngine({ mode: 'rich' });
 *   const uciEng  = new TorchAnalysisEngine({ mode: 'uci' });
 *   await Promise.all([richEng.init(), uciEng.init()]);
 *   await richEng.fetchFullAnalysis(history)  // startpos-rooted
 *   await uciEng.analyze(fen)                 // any position
 *   richEng.destroy(); uciEng.destroy();
 */

import { parseFetchAnalysisJson, type TorchAnalysis } from './torchJson.js';
import type { AnalysisResult, AnalysisBackend, MoveClassification } from './moveAnalysis.js';

const INIT_TIMEOUT_MS = 10_000;
const ANALYSIS_TIMEOUT_MS = 5_000;
const UCI_GO_TIMEOUT_MS = 10_000;
const UCI_GO_DEPTH = 14;

export type TorchEngineMode = 'rich' | 'uci';

/** Setoption pack for the rich (fetch_analysis) mode — UseDeclarativePositionCommand=true
 *  is required for fetch_analysis to compute effectiveElo/CAPS/tallies. Verified via
 *  /tmp/torch-game-states.mjs: WITHOUT this option, fetch_analysis returns null Elo. */
const SETOPTIONS_RICH = [
  'UseDeclarativePositionCommand value true',
  'BlackElo value 1500',
  'WhiteElo value 1500',
  'HandleContinuations value true',
  'HandleContinuationsDepth value 14',
  'UserColor value white',
  'BotChatPrioritizePlayerMove value true',
  'SerializeSpeechDetails value true',
  'AllowBoardEventsWithoutSpeech value true',
  'ServeCommandV2 value true',
  'SpeechV3 value true',
  'ClassificationV3 value true',
  'UCI_Chess960 value false',
  'UseRatingRanges value true',
  'Language value en_US',
  'MultiPV value 1',
  'Hash value 32',
  'Threads value 1',
];

/** Setoption pack for the UCI standard mode — drops UseDeclarativePositionCommand
 *  so `position fen <X>` doesn't crash the wasm. Minimal — just what plain
 *  UCI search needs. */
const SETOPTIONS_UCI = [
  'MultiPV value 1',
  'Hash value 32',
  'Threads value 1',
];

/** Narrowed Worker shape — only what TorchAnalysisEngine actually uses.
 *  Lets the test harness ship a stub without satisfying the full DOM Worker
 *  interface (`dispatchEvent`, `onmessageerror`, etc., not used here). */
export interface WorkerLike {
  postMessage(message: string): void;
  addEventListener(event: 'message' | 'error' | 'messageerror', cb: (e: any) => void): void;
  removeEventListener(event: 'message' | 'error' | 'messageerror', cb: (e: any) => void): void;
  terminate(): void;
}

export interface TorchAnalysisDeps {
  /** Fetch the JS source of torch.js (extension URL → text). The default
   *  uses browser.runtime.sendMessage('fetchExtensionFile') to bypass
   *  page CSP, mirroring the legacy analysisEngine.ts pattern. */
  fetchEngineSource: () => Promise<string>;
  /** Factory for the Worker. Default constructs `new Worker(blobUrl + #wasmUrl)`.
   *  Tests inject a fake (typed as WorkerLike, not Worker). */
  workerFactory: (blobUrl: string, wasmUrlHash: string) => WorkerLike;
  /** URL of torch.wasm (passed via worker location hash). */
  wasmUrl: string;
  /** Mode determines which setoption pack is sent at init and which
   *  call methods are valid. Default: 'rich'. */
  mode: TorchEngineMode;
}

export class TorchAnalysisEngine implements AnalysisBackend {
  private worker: WorkerLike | null = null;
  private blobUrl: string | null = null;
  private _ready = false;
  private _disposed = false;
  private deps: TorchAnalysisDeps;
  /** Sequential queue: torch processes UCI commands in order; pipelining
   *  position+go OR position+fetch_analysis from concurrent calls puts
   *  the listeners in a state where listener N can resolve with the
   *  payload from a previous call (and worse: deeply nested calls have
   *  triggered wasm abort()s in production). Serialise everything. */
  private cmdQueue: Promise<unknown> = Promise.resolve();

  constructor(deps?: Partial<TorchAnalysisDeps>) {
    this.deps = {
      fetchEngineSource: deps?.fetchEngineSource ?? defaultFetchEngineSource,
      workerFactory: deps?.workerFactory ?? defaultWorkerFactory,
      wasmUrl: deps?.wasmUrl ?? defaultWasmUrl(),
      mode: deps?.mode ?? 'rich',
    };
  }

  get ready() { return this._ready && !this._disposed; }
  get mode(): TorchEngineMode { return this.deps.mode; }

  async init(): Promise<void> {
    if (this._disposed) throw new Error('engine disposed');
    const source = await this.deps.fetchEngineSource();
    const blob = new Blob([source], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = this.deps.workerFactory(this.blobUrl, this.deps.wasmUrl);

    this.worker.addEventListener('error', (e) => {
      const msg = (e as ErrorEvent).message ?? 'torch worker crashed';
      console.warn('[Chessr][torch] worker error:', msg);
      // Clean up immediately — no point holding the dead Worker + BlobURL.
      // Subsequent enqueue() calls will see disposed=true and reject; the
      // catch handlers in content.tsx re-init via buildLiveAnalysis.
      this._disposed = true;
      this._ready = false;
      try { this.worker?.terminate(); } catch { /* ignore */ }
      this.worker = null;
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
    });

    await this.cmd('uci', 'uciok', INIT_TIMEOUT_MS);
    const pack = this.deps.mode === 'rich' ? SETOPTIONS_RICH : SETOPTIONS_UCI;
    for (const opt of pack) this.send(`setoption name ${opt}`);
    await this.cmd('isready', 'readyok', INIT_TIMEOUT_MS);
    // NOTE: do NOT send `ucinewgame` here. With UseDeclarativePositionCommand=true,
    // sending ucinewgame puts torch's fetch_analysis pipeline into a state
    // where ANY subsequent fetch_analysis (even on a 1-move sequence)
    // crashes the wasm. Verified via /tmp/torch-test-init.mjs.
    this._ready = true;
  }

  /** Standard UCI search on any position. Drop-in compatible with the
   *  AnalysisBackend.analyze(fen) contract — used for eval-bar / per-move
   *  classification when game isn't startpos-rooted (or as a generic
   *  single-position eval). Only valid in mode='uci'. */
  async analyze(fen: string): Promise<AnalysisResult> {
    if (this._disposed) throw new Error('engine disposed');
    if (!this._ready || !this.worker) throw new Error('engine not ready');
    if (this.deps.mode !== 'uci') throw new Error("analyze(fen) requires mode='uci'");

    return this.enqueue(async () => {
      this.send(`position fen ${fen}`);
      // Track best info during the search so we can report it on bestmove.
      let lastInfo: { cp: number | null; mate: number | null; depth: number; pv: string } = {
        cp: null, mate: null, depth: 0, pv: '',
      };
      const onMsg = (e: any) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (!line.startsWith('info ') || !line.includes(' pv ')) return;
        // Parse `info depth N ... score cp X | score mate Y ... pv MOVE...`
        const m = line.match(/depth\s+(\d+)/);
        if (m) lastInfo.depth = parseInt(m[1], 10);
        const cpM = line.match(/score\s+cp\s+(-?\d+)/);
        const mateM = line.match(/score\s+mate\s+(-?\d+)/);
        if (cpM) { lastInfo.cp = parseInt(cpM[1], 10); lastInfo.mate = null; }
        if (mateM) { lastInfo.mate = parseInt(mateM[1], 10); lastInfo.cp = null; }
        const pvIdx = line.indexOf(' pv ');
        if (pvIdx >= 0) lastInfo.pv = line.slice(pvIdx + 4).trim();
      };
      this.worker!.addEventListener('message', onMsg);

      try {
        const bestmoveLine = await this.waitForLinePrefix(
          'bestmove',
          () => this.send(`go depth ${UCI_GO_DEPTH}`),
          UCI_GO_TIMEOUT_MS,
        );
        const bestMove = bestmoveLine.split(/\s+/)[1] ?? '';
        // Mate is mapped to ±10000 cp (sentinel) so callers see a saturated
        // value; chessr's classifier only uses cp delta so this works.
        const evaluation = lastInfo.mate !== null
          ? (lastInfo.mate > 0 ? 10000 : -10000)
          : (lastInfo.cp ?? 0);
        return { evaluation, bestMove, depth: lastInfo.depth };
      } finally {
        this.worker?.removeEventListener('message', onMsg);
      }
    });
  }

  /** Custom Chess.com `fetch analysis` pipeline. ONLY valid when `history`
   *  replays from startpos to the current position — caller must validate
   *  via historyMatchesFen() before invoking. Returns the rich JSON.
   *  Only valid in mode='rich'. */
  async fetchFullAnalysis(history: string[]): Promise<TorchAnalysis> {
    if (this._disposed) throw new Error('engine disposed');
    if (!this._ready || !this.worker) throw new Error('engine not ready');
    if (this.deps.mode !== 'rich') throw new Error("fetchFullAnalysis requires mode='rich'");

    return this.enqueue(async () => {
      const movesPart = history.length ? ` moves ${history.join(' ')}` : '';
      this.send(`position startpos${movesPart}`);

      const json = await this.waitForLinePrefix(
        'json ',
        () => this.send('fetch analysis'),
        ANALYSIS_TIMEOUT_MS,
      );
      let raw: unknown;
      try {
        raw = JSON.parse(json.slice(5));
      } catch (e) {
        throw new Error(`torch JSON parse error: ${(e as Error).message}`);
      }
      return parseFetchAnalysisJson(raw);
    });
  }

  /** Classify a candidate move from the position reached by `history`.
   *  Runs `position startpos moves <history> <candidate>` + `fetch analysis`
   *  and returns torch's classification of the LAST move (the candidate).
   *  Caller must ensure history replays from startpos to the side-to-move
   *  position (via historyMatchesFen). Only valid in mode='rich'. */
  async classifyCandidate(history: string[], candidateUci: string): Promise<MoveClassification | null> {
    if (this._disposed) throw new Error('engine disposed');
    if (!this._ready || !this.worker) throw new Error('engine not ready');
    if (this.deps.mode !== 'rich') throw new Error("classifyCandidate requires mode='rich'");

    return this.enqueue(async () => {
      const moves = [...history, candidateUci];
      this.send(`position startpos moves ${moves.join(' ')}`);
      const json = await this.waitForLinePrefix(
        'json ',
        () => this.send('fetch analysis'),
        ANALYSIS_TIMEOUT_MS,
      );
      let raw: unknown;
      try {
        raw = JSON.parse(json.slice(5));
      } catch (e) {
        throw new Error(`torch JSON parse error: ${(e as Error).message}`);
      }
      const parsed = parseFetchAnalysisJson(raw);
      const last = parsed.moveAnalyses[parsed.moveAnalyses.length - 1];
      return last?.classification ?? null;
    });
  }

  /** Update the WhiteElo / BlackElo setoptions torch uses for classification
   *  thresholds (rating ranges drive what counts as "great" vs "excellent",
   *  inacc vs mistake, etc.). Safe to call between fetch_analysis runs;
   *  must NOT be called mid-search. Queued through the same cmdQueue as
   *  position/go to guarantee that. Only meaningful in mode='rich' (the
   *  UCI mode pack omits these options). */
  setRatings(whiteElo: number, blackElo: number): Promise<void> {
    if (this.deps.mode !== 'rich') return Promise.resolve();
    return this.enqueue(async () => {
      const w = Math.round(whiteElo);
      const b = Math.round(blackElo);
      console.log(`[Chessr][torch] setRatings → WhiteElo=${w} BlackElo=${b}`);
      this.send(`setoption name WhiteElo value ${w}`);
      this.send(`setoption name BlackElo value ${b}`);
      // Wait for readyok so a subsequent fetch_analysis sees the new
      // values applied (torch may need an isready handshake to commit
      // setoption changes — confirmed via /tmp/torch-ratings-update.mjs).
      await this.cmd('isready', 'readyok', INIT_TIMEOUT_MS);
    });
  }

  /** Serialise commands on the worker — torch is single-threaded and
   *  pipelining position+go pairs has triggered wasm aborts in prod. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.cmdQueue.catch(() => undefined).then(async () => {
      if (this._disposed) throw new Error('engine disposed');
      if (!this._ready || !this.worker) throw new Error('engine not ready');
      return work();
    });
    this.cmdQueue = next;
    return next;
  }

  destroy(): void {
    this._disposed = true;
    this._ready = false;
    if (this.worker) {
      try { this.send('quit'); } catch { /* ignore */ }
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }

  // ────────── internals ──────────

  private send(cmd: string) { this.worker?.postMessage(cmd); }

  private cmd(send: string, awaitToken: string, timeoutMs: number): Promise<void> {
    return this.waitForToken(awaitToken, () => this.send(send), timeoutMs);
  }

  private waitForToken(token: string, trigger: () => void, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('worker missing'));
      const onMsg = (e: any) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.includes(token)) {
          this.worker?.removeEventListener('message', onMsg);
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        this.worker?.removeEventListener('message', onMsg);
        reject(new Error(`torch: timeout waiting for ${token}`));
      }, timeoutMs);
      this.worker.addEventListener('message', onMsg);
      trigger();
    });
  }

  private waitForLinePrefix(prefix: string, trigger: () => void, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('worker missing'));
      const onMsg = (e: any) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.startsWith(prefix)) {
          this.worker?.removeEventListener('message', onMsg);
          clearTimeout(timer);
          resolve(line);
        }
      };
      const timer = setTimeout(() => {
        this.worker?.removeEventListener('message', onMsg);
        // Timeout on a json-line means the wasm probably aborted (the
        // worker is alive but the engine no longer emits anything).
        // Mark the engine dead so the caller's catch handler triggers
        // a re-init via buildLiveAnalysis.
        this._ready = false;
        this._disposed = true;
        reject(new Error(`torch: timeout waiting for line prefixed "${prefix}" (engine may have aborted)`));
      }, timeoutMs);
      this.worker.addEventListener('message', onMsg);
      trigger();
    });
  }
}

// ─── default deps (browser-only) ───
async function defaultFetchEngineSource(): Promise<string> {
  const response = await browser.runtime.sendMessage({
    type: 'fetchExtensionFile',
    path: '/engine/torch.js',
  }) as { text?: string; error?: string };
  if (response.error || !response.text) {
    throw new Error(`Failed to fetch torch.js: ${response.error}`);
  }
  return response.text;
}

function defaultWorkerFactory(blobUrl: string, wasmUrlHash: string): WorkerLike {
  return new Worker(blobUrl + '#' + encodeURIComponent(wasmUrlHash));
}

function defaultWasmUrl(): string {
  return browser.runtime.getURL('/engine/torch.wasm');
}
