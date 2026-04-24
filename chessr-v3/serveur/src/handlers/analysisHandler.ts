/**
 * analysisHandler — Stockfish move-analysis via WebSocket.
 *
 * Adapted from chessr-next/serveur/src/handlers/analysisHandler.ts.
 * Takes (msg, userId, sendFn) and uses v3 wsLog. Classification formulas
 * (winProb / classifyMove / computeCAPS2 / normalizeEval) are unchanged.
 */

import { StockfishPool } from '../engine/StockfishPool.js';
import { getAnalysisConfig, ANALYSIS_DEPTH } from '../engine/StockfishConfig.js';
import { AnalysisQueue, type MoveClassification } from '../queue/AnalysisQueue.js';
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

let stockfishPool: StockfishPool | null = null;
const queue = new AnalysisQueue();
let isLoopRunning = false;

function winProb(evalPawns: number): number {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function classifyMove(bestEval: number, afterEval: number): MoveClassification {
  const wpBefore = winProb(bestEval);
  const wpAfter = winProb(afterEval);
  const wpDiff = Math.max(0, wpBefore - wpAfter);
  if (wpDiff <= 0.001) return 'best';
  if (wpDiff <= 2) return 'excellent';
  if (wpDiff <= 5) return 'good';
  if (wpDiff <= 10) return 'inaccuracy';
  if (wpDiff <= 20) return 'mistake';
  return 'blunder';
}

function computeCAPS2(diff: number, absEval: number): number {
  if (diff <= 0) return 100;
  const raw = 100 * (1 - 0.50 * Math.pow(diff, 0.95) * (1 + 0.005 * Math.pow(absEval, 2.25)));
  return Math.max(0, Math.min(100, raw));
}

function normalizeEval(evalCp: number, playerColor: 'white' | 'black'): number {
  const evalPawns = evalCp / 100;
  return playerColor === 'white' ? evalPawns : -evalPawns;
}

export async function initStockfishPool(maxInstances = 1): Promise<void> {
  stockfishPool = new StockfishPool(maxInstances);
  await stockfishPool.init();
  startProcessingLoop();
}

function startProcessingLoop(): void {
  if (isLoopRunning) return;
  isLoopRunning = true;

  const processNext = async (): Promise<void> => {
    if (!isLoopRunning) return;
    const request = queue.dequeue();
    if (!request) { setTimeout(processNext, 100); return; }

    queue.markProcessing(request.userId);
    try {
      const engine = await stockfishPool?.acquire();
      if (!engine) {
        request.callback(new Error('Stockfish pool unavailable'));
        queue.markDone(request.userId);
        setTimeout(processNext, 100);
        return;
      }
      try {
        if (!queue.isRequestValid(request.requestId, request.userId)) {
          stockfishPool?.release(engine);
          queue.markDone(request.userId);
          setTimeout(processNext, 0);
          return;
        }
        const result = await request.process(engine);
        if (queue.isRequestValid(request.requestId, request.userId)) {
          request.callback(null, result);
        }
      } finally {
        stockfishPool?.release(engine);
      }
    } catch (error) {
      console.error(`[AnalysisHandler] Error processing ${request.requestId}:`, error);
      request.callback(error instanceof Error ? error : new Error(String(error)));
    } finally {
      queue.markDone(request.userId);
    }
    setTimeout(processNext, 0);
  };

  processNext();
}

export function handleAnalysisRequest(
  message: AnalysisMessage,
  userId: string,
  send: SendFn,
): void {
  const { requestId, fenBefore, fenAfter, move, playerColor } = message;

  if (!requestId || !fenBefore || !fenAfter || !move || !playerColor) {
    send({ type: 'analysis_error', requestId, error: 'Missing required fields' });
    return;
  }

  logStart(userId, requestId, 'analyze', `move=${move}, color=${playerColor}`);
  const config = getAnalysisConfig();

  queue.enqueue({
    requestId,
    userId,
    process: async (engine) => {
      await engine.configure(config);
      const beforeResults = await engine.search(fenBefore, 1, { depth: ANALYSIS_DEPTH });
      const afterResults = await engine.search(fenAfter, 1, { depth: ANALYSIS_DEPTH });
      const bestEvalRaw = beforeResults[0]?.evaluation ?? 0;
      const evalAfterRaw = afterResults[0]?.evaluation ?? 0;
      const bestMove = beforeResults[0]?.move ?? move;

      const bestEval = normalizeEval(bestEvalRaw, playerColor);
      const evalAfter = normalizeEval(evalAfterRaw, playerColor);
      const diff = Math.max(0, bestEval - evalAfter);
      const wpBefore = winProb(bestEval);
      const wpAfter = winProb(evalAfter);
      const wpDiff = Math.max(0, wpBefore - wpAfter);
      const absEval = Math.abs(bestEval);
      const caps2 = computeCAPS2(diff, absEval);
      const classification = classifyMove(bestEval, evalAfter);

      return {
        move,
        classification,
        caps2: Math.round(caps2 * 10) / 10,
        diff: Math.round(diff * 100) / 100,
        wpDiff: Math.round(wpDiff * 100) / 100,
        evalBefore: Math.round(bestEval * 100) / 100,
        evalAfter: Math.round(evalAfter * 100) / 100,
        bestMove,
      };
    },
    callback: (error, result) => {
      if (error) {
        logEnd(userId, requestId, 'analyze', `fail:${error.message || 'analysis error'}`);
        send({ type: 'analysis_error', requestId, error: error.message || 'Analysis error' });
        return;
      }
      if (result) {
        logEnd(userId, requestId, 'analyze',
          `${result.move} → ${result.classification}, caps2=${result.caps2}`);
        send({ type: 'analysis_response', requestId, ...result });
      }
    },
  });
}

/**
 * Single-FEN eval used by ServerAnalysisEngine to match the client
 * AnalysisEngine.analyze(fen) API signature. Lighter than
 * handleAnalysisRequest (one FEN, no classification math on the server —
 * the extension's moveAnalysis.ts does the math after getting two evals).
 */
export function handleFenEvalRequest(
  message: FenEvalMessage,
  userId: string,
  send: SendFn,
): void {
  const { requestId, fen, depth } = message;
  if (!requestId || !fen) {
    send({ type: 'engine_eval_error', requestId, error: 'Missing requestId or fen' });
    return;
  }
  const searchDepth = Math.max(1, Math.min(ANALYSIS_DEPTH, depth || ANALYSIS_DEPTH));

  queue.enqueue({
    requestId,
    userId,
    process: async (engine) => {
      await engine.configure(getAnalysisConfig());
      const results = await engine.search(fen, 1, { depth: searchDepth });
      const top = results[0];
      return {
        move: top?.move ?? '',
        classification: 'best' as MoveClassification,
        caps2: 0,
        diff: 0,
        wpDiff: 0,
        evalBefore: top?.evaluation ?? 0,
        evalAfter: 0,
        bestMove: top?.move ?? '',
      };
    },
    callback: (error, result) => {
      if (error) {
        send({ type: 'engine_eval_error', requestId, error: error.message || 'eval error' });
        return;
      }
      if (result) {
        // EngineManager normalizes to white-POV. Un-flip to side-to-move POV
        // to match the client AnalysisEngine.analyze() contract that
        // moveAnalysis.ts expects.
        const isBlackToMove = fen.split(' ')[1] === 'b';
        const evalSideToMove = isBlackToMove ? -result.evalBefore : result.evalBefore;
        send({
          type: 'engine_eval_response',
          requestId,
          evaluation: evalSideToMove,
          bestMove: result.bestMove,
          depth: searchDepth,
        });
      }
    },
  });
}

export function handleUserDisconnectAnalysis(userId: string): void {
  queue.cancelForUser(userId);
}

export async function shutdownStockfishPool(): Promise<void> {
  isLoopRunning = false;
  if (stockfishPool) await stockfishPool.shutdown();
}
