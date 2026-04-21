/**
 * AnalysisEngine — Runs Stockfish WASM in a WebWorker via Blob URL
 * to bypass host page CSP. Single analysis at a time, depth 14.
 */

const ANALYSIS_DEPTH = 12;
const HASH_MB = 32;

export interface AnalysisResult {
  evaluation: number; // centipawns, side-to-move perspective
  bestMove: string;   // UCI format
  depth: number;
}

export class AnalysisEngine {
  private worker: Worker | null = null;
  private _ready = false;
  private _disposed = false;
  private pendingResolve: ((result: AnalysisResult) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private currentResult: AnalysisResult | null = null;

  get ready() { return this._ready && !this._disposed; }
  get disposed() { return this._disposed; }

  async init(jsUrl: string, wasmUrl: string): Promise<void> {
    console.log('[Chessr] Engine init, jsUrl:', jsUrl, 'wasmUrl:', wasmUrl);

    // Content scripts can't fetch/Worker chrome-extension:// URLs (page CSP blocks it).
    // Fetch the JS source via the background service worker, then create a Blob URL Worker.
    const response = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: '/engine/stockfish.js',
    }) as { text?: string; error?: string };

    if (response.error || !response.text) {
      throw new Error(`Failed to fetch stockfish.js via background: ${response.error}`);
    }

    // Create Blob URL Worker. Pass WASM URL via hash fragment —
    // stockfish.js reads self.location.hash to locate the .wasm file.
    const blob = new Blob([response.text], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(blobUrl + '#' + encodeURIComponent(wasmUrl));

    // If Stockfish traps (RuntimeError: unreachable) the worker's WASM memory
    // is corrupted — every subsequent UCI command triggers another trap.
    // Mark the engine permanently disposed so future `analyze()` calls bail
    // instantly instead of bouncing more postMessages off the dead worker.
    // Re-init (new AnalysisEngine) is the caller's concern.
    const onWorkerError = (e: ErrorEvent | Event) => {
      if (this._disposed) return;
      const msg = (e as ErrorEvent).message || 'Stockfish worker crashed';
      console.warn('[Chessr] Stockfish worker crashed:', msg);
      this._disposed = true;
      this._ready = false;
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject?.(new Error(msg));
      try { this.worker?.terminate(); } catch { /* ignore */ }
      this.worker = null;
    };
    this.worker.addEventListener('error', onWorkerError);
    this.worker.addEventListener('messageerror', onWorkerError);

    // UCI init sequence
    await this.uciCommand('uci', 'uciok');
    this.sendRaw(`setoption name Hash value ${HASH_MB}`);
    this.sendRaw('setoption name Threads value 1');
    this.sendRaw('setoption name MultiPV value 1');
    this.sendRaw('setoption name UCI_ShowWDL value true');
    await this.uciCommand('isready', 'readyok');

    this._ready = true;
  }

  async analyze(fen: string): Promise<AnalysisResult> {
    if (this._disposed) throw new Error('Engine disposed');
    if (!this.worker || !this._ready) {
      throw new Error('Engine not initialized');
    }

    // Cancel any in-flight analysis and wait for the stop's bestmove to drain
    // the UCI output queue. Capped at 2s — if the Worker is stuck (WASM trap)
    // we bail rather than hang forever.
    if (this.pendingResolve) {
      this.sendRaw('stop');
      await Promise.race([
        new Promise<void>((resolve) => {
          const oldResolve = this.pendingResolve!;
          this.pendingResolve = () => {
            oldResolve(this.currentResult!);
            resolve();
          };
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (this._disposed) throw new Error('Engine disposed during cancel');
    }

    // Synchronise on isready/readyok BEFORE posting the new position+go.
    // Without this, Stockfish occasionally traps mid-cleanup when the next
    // `position` lands before its internal search loop has fully unwound.
    // Cap at 2s so a dead worker doesn't wedge us.
    await Promise.race([
      this.waitForToken('readyok', () => this.sendRaw('isready')),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (this._disposed) throw new Error('Engine disposed during isready');

    return new Promise<AnalysisResult>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.currentResult = { evaluation: 0, bestMove: '', depth: 0 };

      const onMessage = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : e.data?.toString?.() || '';

        if (line.startsWith('info') && line.includes('score')) {
          this.parseInfo(line);
        }

        if (line.startsWith('bestmove')) {
          this.worker!.removeEventListener('message', onMessage);
          const bestMove = line.split(' ')[1] || this.currentResult!.bestMove;
          this.currentResult!.bestMove = bestMove;
          const res = this.pendingResolve;
          const result = { ...this.currentResult! };
          this.pendingResolve = null;
          this.pendingReject = null;
          res?.(result);
        }
      };

      this.worker!.addEventListener('message', onMessage);
      this.sendRaw(`position fen ${fen}`);
      this.sendRaw(`go depth ${ANALYSIS_DEPTH}`);
    });
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

  destroy(): void {
    if (this.worker) {
      this.sendRaw('quit');
      this.worker.terminate();
      this.worker = null;
    }
    this._ready = false;
    if (this.pendingReject) {
      this.pendingReject(new Error('Engine destroyed'));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
  }

  private sendRaw(cmd: string) {
    if (this._disposed) return;
    try {
      this.worker?.postMessage(cmd);
    } catch {
      // Worker is terminated or in bad state — mark disposed so the engine
      // gets re-init on next attempt.
      this._disposed = true;
      this._ready = false;
    }
  }

  private uciCommand(cmd: string, waitFor: string): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.includes(waitFor)) {
          this.worker!.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMessage);
      this.sendRaw(cmd);
    });
  }

  private parseInfo(line: string) {
    const depthMatch = line.match(/\bdepth (\d+)/);
    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;

    if (depth < (this.currentResult?.depth || 0)) return;

    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);

    let evaluation: number;
    if (mateMatch) {
      const mateIn = parseInt(mateMatch[1], 10);
      evaluation = mateIn > 0 ? 30000 - mateIn * 10 : -30000 - mateIn * 10;
    } else if (cpMatch) {
      evaluation = parseInt(cpMatch[1], 10);
    } else {
      return;
    }

    const pvMatch = line.match(/\bpv (\S+)/);
    const bestMove = pvMatch ? pvMatch[1] : this.currentResult?.bestMove || '';

    this.currentResult = { evaluation, bestMove, depth };
  }
}
