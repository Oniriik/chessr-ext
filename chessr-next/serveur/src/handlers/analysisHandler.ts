/**
 * analysisHandler - WebSocket message handler for move analysis
 * Uses Stockfish 18 @ depth 18 with CAPS2 scoring calibrated to Chess.com
 */

import type { WebSocket } from 'ws';
import { StockfishPool } from '../engine/StockfishPool.js';
import { getAnalysisConfig, ANALYSIS_DEPTH } from '../engine/StockfishConfig.js';
import {
  AnalysisQueue,
  type AnalysisResult,
  type MoveClassification,
} from '../queue/AnalysisQueue.js';
import { logStart, logEnd, logError } from '../utils/logger.js';
import { logActivity } from '../utils/activityLogger.js';

export interface Client {
  ws: WebSocket;
  user: {
    id: string;
    email: string;
  };
}

export interface AnalysisMessage {
  type: 'analyze';
  requestId: string;
  fenBefore: string;
  fenAfter: string;
  move: string;
  playerColor: 'white' | 'black';
}

// Stockfish pool instance (separate from Komodo)
let stockfishPool: StockfishPool | null = null;

// Request queue
const queue = new AnalysisQueue();

// Processing loop flag
let isLoopRunning = false;

// ============ FORMULAS (calibrated to Chess.com) ============

/**
 * Win probability using Chess.com's formula
 * Returns 0-100 (percentage)
 */
function winProb(evalPawns: number): number {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Classify move based on win probability % loss
 * Thresholds match Chess.com's Expected Points model
 */
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

/**
 * Compute CAPS2 score from pawn diff and position eval
 * Calibrated via regression on Chess.com data
 * Returns roughly -100 to 100 (can go negative for blunders)
 */
function computeCAPS2(diff: number, absEval: number): number {
  if (diff <= 0) return 100;
  return 100 * (1 - 0.50 * Math.pow(diff, 0.95) * (1 + 0.005 * Math.pow(absEval, 2.25)));
}

/**
 * Normalize evaluation to player's perspective (in pawns)
 * Positive = good for player, Negative = bad for player
 */
function normalizeEval(evalCp: number, playerColor: 'white' | 'black'): number {
  const evalPawns = evalCp / 100;
  return playerColor === 'white' ? evalPawns : -evalPawns;
}

// ============ POOL MANAGEMENT ============

/**
 * Initialize the Stockfish pool
 */
export async function initStockfishPool(maxInstances: number = 1): Promise<void> {
  stockfishPool = new StockfishPool(maxInstances);
  await stockfishPool.init();
  startProcessingLoop();
}

/**
 * Start the queue processing loop
 */
function startProcessingLoop(): void {
  if (isLoopRunning) return;
  isLoopRunning = true;

  const processNext = async (): Promise<void> => {
    if (!isLoopRunning) return;

    const request = queue.dequeue();

    if (!request) {
      setTimeout(processNext, 100);
      return;
    }

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
          console.log(`[AnalysisHandler] Request ${request.requestId} superseded, skipping`);
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

// ============ REQUEST HANDLER ============

/**
 * Handle move analysis request
 */
export function handleAnalysisRequest(message: AnalysisMessage, client: Client): void {
  const { requestId, fenBefore, fenAfter, move, playerColor } = message;

  // Validate required fields
  if (!requestId || !fenBefore || !fenAfter || !move || !playerColor) {
    client.ws.send(
      JSON.stringify({
        type: 'analysis_error',
        requestId,
        error: 'Missing required fields',
      })
    );
    return;
  }

  logStart({
    requestId,
    email: client.user.email,
    type: 'analyze',
    params: `move=${move}, color=${playerColor}`,
  });

  const config = getAnalysisConfig();

  queue.enqueue({
    requestId,
    userId: client.user.id,

    process: async (engine) => {
      // Configure engine for analysis
      await engine.configure(config);

      // 1. Analyze position BEFORE move (get best eval)
      const beforeResults = await engine.search(fenBefore, 1, { depth: ANALYSIS_DEPTH });

      // 2. Analyze position AFTER move (get resulting eval)
      const afterResults = await engine.search(fenAfter, 1, { depth: ANALYSIS_DEPTH });

      // Extract evaluations (already normalized to white's perspective by EngineManager)
      const bestEvalRaw = beforeResults[0]?.evaluation ?? 0;
      const evalAfterRaw = afterResults[0]?.evaluation ?? 0;
      const bestMove = beforeResults[0]?.move ?? move;

      // Normalize to player's perspective (in pawns)
      const bestEval = normalizeEval(bestEvalRaw, playerColor);
      const evalAfter = normalizeEval(evalAfterRaw, playerColor);

      // Raw pawn difference
      const diff = Math.max(0, bestEval - evalAfter);

      // Win probability difference (for classification)
      const wpBefore = winProb(bestEval);
      const wpAfter = winProb(evalAfter);
      const wpDiff = Math.max(0, wpBefore - wpAfter);

      // CAPS2 score
      const absEval = Math.abs(bestEval);
      const caps2 = computeCAPS2(diff, absEval);

      // Classification based on WP% loss
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
      // Guard: client may have disconnected while request was queued
      if (client.ws.readyState !== 1) return;

      if (error) {
        logError({
          requestId,
          email: client.user.email,
          type: 'analyze',
          error: error.message || 'Analysis error',
        });
        client.ws.send(
          JSON.stringify({
            type: 'analysis_error',
            requestId,
            error: error.message || 'Analysis error',
          })
        );
        return;
      }

      if (result) {
        logEnd({
          requestId,
          email: client.user.email,
          type: 'analyze',
          result: `${result.move} → ${result.classification}, caps2=${result.caps2}`,
        });

        client.ws.send(
          JSON.stringify({
            type: 'analysis_result',
            requestId,
            ...result,
          })
        );

        // Log activity for admin dashboard metrics
        logActivity(client.user.id, 'analysis');
      }
    },
  });
}

/**
 * Handle user disconnection
 */
export function handleAnalysisDisconnect(userId: string): void {
  queue.cancelForUser(userId);
}

/**
 * Shutdown the Stockfish pool
 */
export async function shutdownStockfishPool(): Promise<void> {
  isLoopRunning = false;
  if (stockfishPool) {
    await stockfishPool.shutdown();
  }
}

/**
 * Get handler statistics
 */
export function getAnalysisStats() {
  return {
    queue: queue.getStats(),
    pool: stockfishPool ? stockfishPool.getStats() : null,
  };
}
