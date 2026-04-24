/**
 * ServerAnalysisEngine — drop-in AnalysisEngine replacement that forwards
 * single-FEN evaluations to the server over WebSocket. Used as a fallback
 * when the Stockfish WASM AnalysisEngine fails to init.
 *
 * Protocol (server: chessr-v3/serveur/src/handlers/analysisHandler.ts):
 *   → { type: 'engine_eval_request', requestId, fen, depth? }
 *   ← { type: 'engine_eval_response', requestId, evaluation, bestMove, depth }
 *   ← { type: 'engine_eval_error',    requestId, error }
 *
 * `evaluation` is in centipawns, side-to-move POV — same contract as the
 * client AnalysisEngine so moveAnalysis.ts doesn't need to know which
 * backend is in use.
 */

import { sendWs, onWsMessage } from './websocket';
import type { AnalysisResult } from './analysisEngine';

const EVAL_TIMEOUT_MS = 10_000;

export class ServerAnalysisEngine {
  private _ready = true;
  private _disposed = false;

  get ready(): boolean { return this._ready && !this._disposed; }
  get disposed(): boolean { return this._disposed; }

  async init(): Promise<void> {
    // WS already connected; nothing to do.
  }

  async analyze(fen: string): Promise<AnalysisResult> {
    if (this._disposed) throw new Error('ServerAnalysisEngine disposed');
    const requestId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<AnalysisResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Server eval timeout'));
      }, EVAL_TIMEOUT_MS);

      const off = onWsMessage((msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === 'engine_eval_response') {
          clearTimeout(timer);
          off();
          resolve({
            evaluation: msg.evaluation ?? 0,
            bestMove: msg.bestMove ?? '',
            depth: msg.depth ?? 0,
          });
          return;
        }
        if (msg.type === 'engine_eval_error') {
          clearTimeout(timer);
          off();
          reject(new Error(msg.error || 'server eval error'));
          return;
        }
      });

      sendWs({ type: 'engine_eval_request', requestId, fen });
    });
  }

  destroy(): void {
    this._disposed = true;
    this._ready = false;
  }
}
