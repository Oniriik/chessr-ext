/**
 * TorchAnalysisEngine — runs torch.wasm in a Worker and exposes a
 * single analyze(history) call that returns a parsed TorchAnalysis.
 *
 * Lifecycle:
 *   const eng = new TorchAnalysisEngine();
 *   await eng.init();                                 // 1× per game
 *   const a = await eng.analyze(['e2e4', 'e7e5', ...]); // after each move
 *   eng.destroy();                                    // on game end / unmount
 *
 * Init sends the full setoption pack required to enable ServeCommandV2 +
 * ClassificationV3 (see ChessHv3 reference at content.js:1950-1972).
 * analyze() drives `position startpos moves <history>` + `fetch analysis`
 * and waits for the next `json ` line.
 *
 * Does NOT implement AnalysisBackend — its analyze(history) signature
 * differs from the legacy analyze(fen). content.tsx routes around this
 * via a dedicated module-scope slot (see buildLiveAnalysis).
 */

import { parseFetchAnalysisJson, type TorchAnalysis } from './torchJson.js';

const INIT_TIMEOUT_MS = 10_000;
const ANALYSIS_TIMEOUT_MS = 5_000;

const SETOPTIONS = [
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
}

export class TorchAnalysisEngine {
  private worker: WorkerLike | null = null;
  private blobUrl: string | null = null;
  private _ready = false;
  private _disposed = false;
  private deps: TorchAnalysisDeps;
  /** Sequential queue: torch processes UCI commands in order; pipelining
   *  position+fetch_analysis from concurrent analyze() calls puts the
   *  json-listeners in a state where listener N can resolve with the
   *  payload from a previous call (and worse: deeply nested fetch_analysis
   *  calls have triggered wasm abort()s in production). Serialise. */
  private analysisQueue: Promise<unknown> = Promise.resolve();

  constructor(deps?: Partial<TorchAnalysisDeps>) {
    this.deps = {
      fetchEngineSource: deps?.fetchEngineSource ?? defaultFetchEngineSource,
      workerFactory: deps?.workerFactory ?? defaultWorkerFactory,
      wasmUrl: deps?.wasmUrl ?? defaultWasmUrl(),
    };
  }

  get ready() { return this._ready && !this._disposed; }

  async init(): Promise<void> {
    if (this._disposed) throw new Error('engine disposed');
    const source = await this.deps.fetchEngineSource();
    const blob = new Blob([source], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = this.deps.workerFactory(this.blobUrl, this.deps.wasmUrl);

    this.worker.addEventListener('error', (e) => {
      this._disposed = true;
      this._ready = false;
      const msg = (e as ErrorEvent).message ?? 'torch worker crashed';
      console.warn('[Chessr][torch] worker error:', msg);
    });

    await this.cmd('uci', 'uciok', INIT_TIMEOUT_MS);
    for (const opt of SETOPTIONS) this.send(`setoption name ${opt}`);
    await this.cmd('isready', 'readyok', INIT_TIMEOUT_MS);
    this.send('ucinewgame');
    this._ready = true;
  }

  async analyze(history: string[]): Promise<TorchAnalysis> {
    if (this._disposed) throw new Error('engine disposed');
    if (!this._ready || !this.worker) throw new Error('engine not ready');

    // Chain on the previous analysis so commands are strictly sequential.
    // .catch on the prior promise so that if it failed, this one doesn't
    // immediately reject — we want each call to attempt its own work.
    const next = this.analysisQueue.catch(() => undefined).then(async () => {
      // Re-check state at the moment we actually start (may have been
      // disposed while we were queued).
      if (this._disposed) throw new Error('engine disposed');
      if (!this._ready || !this.worker) throw new Error('engine not ready');

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
    this.analysisQueue = next;
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
