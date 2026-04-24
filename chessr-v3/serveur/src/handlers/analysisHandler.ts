/**
 * analysisHandler — WS → BullMQ analysis queue.
 *
 * Two message types:
 *   - 'analysis_request'   : full move classification (fenBefore + fenAfter)
 *   - 'engine_eval_request': single-FEN eval (used by the client fallback)
 */

import {
  enqueueClassify,
  enqueueEval,
  removePendingAnalysisForUser,
} from '../queue/analysisQueue.js';
import { logStart, logEnd } from '../lib/wsLog.js';

export interface AnalysisMessage {
  type: 'analysis_request';
  requestId: string;
  fenBefore: string;
  fenAfter: string;
  move: string;
  playerColor: 'white' | 'black';
}

export interface FenEvalMessage {
  type: 'engine_eval_request';
  requestId: string;
  fen: string;
  depth?: number;
}

type SendFn = (data: unknown) => void;

export async function handleAnalysisRequest(
  message: AnalysisMessage,
  userId: string,
  send: SendFn,
): Promise<void> {
  const { requestId, fenBefore, fenAfter, move, playerColor } = message;

  if (!requestId || !fenBefore || !fenAfter || !move || !playerColor) {
    send({ type: 'analysis_error', requestId, error: 'Missing required fields' });
    return;
  }

  // No logStart/logEnd here — the extension drives a single
  // `[analysis] source=wasm|server` line via analysis_log_start/end so the
  // log shape is identical regardless of which path computed the result.

  try {
    const r = await enqueueClassify({
      kind: 'classify',
      requestId,
      userId,
      fenBefore,
      fenAfter,
      move,
      playerColor,
    });
    send({
      type: 'analysis_response',
      requestId,
      move: r.move,
      classification: r.classification,
      caps2: r.caps2,
      diff: r.diff,
      wpDiff: r.wpDiff,
      evalBefore: r.evalBefore,
      evalAfter: r.evalAfter,
      bestMove: r.bestMove,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'analysis_error', requestId, error: msg });
  }
}

export async function handleFenEvalRequest(
  message: FenEvalMessage,
  userId: string,
  send: SendFn,
): Promise<void> {
  const { requestId, fen, depth } = message;
  if (!requestId || !fen) {
    send({ type: 'engine_eval_error', requestId, error: 'Missing requestId or fen' });
    return;
  }

  // No logStart/logEnd here — the extension drives a single
  // `[eval] source=wasm|server` line via eval_log_start/end.

  try {
    const r = await enqueueEval({ kind: 'eval', requestId, userId, fen, depth });
    send({
      type: 'engine_eval_response',
      requestId,
      evaluation: r.evaluation,
      bestMove: r.bestMove,
      depth: r.depth,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'engine_eval_error', requestId, error: msg });
  }
}

export async function handleUserDisconnectAnalysis(userId: string): Promise<void> {
  try { await removePendingAnalysisForUser(userId); } catch { /* ignore */ }
}
