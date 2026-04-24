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
import type { MoveAnalysisResult } from './moveAnalysis';

const EVAL_TIMEOUT_MS = 10_000;
const CLASSIFY_TIMEOUT_MS = 20_000;

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

  /**
   * Single-shot move classification — sends `analysis_request` (which the
   * server processes with 2 Stockfish runs + classification math) and
   * returns the full MoveAnalysisResult. Saves one WS round-trip vs
   * calling `.analyze()` twice and computing client-side.
   *
   * `playerColor` is derived from the side-to-move in fenBefore so the
   * caller doesn't have to thread it through.
   */
  async classifyMove(fenBefore: string, fenAfter: string): Promise<MoveAnalysisResult> {
    if (this._disposed) throw new Error('ServerAnalysisEngine disposed');
    const playerColor: 'white' | 'black' = fenBefore.split(' ')[1] === 'b' ? 'black' : 'white';
    const requestId = `cls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<MoveAnalysisResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Server classify timeout'));
      }, CLASSIFY_TIMEOUT_MS);

      const off = onWsMessage((msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === 'analysis_response') {
          clearTimeout(timer);
          off();
          resolve({
            classification: msg.classification,
            caps2: msg.caps2,
            diff: msg.diff,
            wpDiff: msg.wpDiff,
            evalBefore: msg.evalBefore,
            evalAfter: msg.evalAfter,
            bestMove: msg.bestMove,
          });
          return;
        }
        if (msg.type === 'analysis_error') {
          clearTimeout(timer);
          off();
          reject(new Error(msg.error || 'server classify error'));
          return;
        }
      });

      sendWs({
        type: 'analysis_request',
        requestId,
        fenBefore,
        fenAfter,
        // The server still requires `move` for legacy validation. Empty
        // string is fine — the response carries `bestMove` separately,
        // and the played move is implicit in the fen diff.
        move: '_',
        playerColor,
      });
    });
  }

  destroy(): void {
    this._disposed = true;
    this._ready = false;
  }
}
