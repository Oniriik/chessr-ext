/**
 * analysisHandler - WebSocket message handler for move analysis
 * Uses Stockfish ONLY (separate from Komodo suggestion pool)
 */

import type { WebSocket } from 'ws';
import { StockfishPool } from '../engine/StockfishPool.js';
import { getAnalysisConfig, ANALYSIS_DEPTH } from '../engine/StockfishConfig.js';
import {
  AnalysisQueue,
  type AnalysisResult,
  type MoveClassification,
  type GamePhase,
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

// ============ CLASSIFICATION LOGIC ============

/**
 * Classify move based on CPL (centipawn loss)
 * Thresholds calibrated for depth 10
 */
function classifyMove(cpl: number): MoveClassification {
  if (cpl <= 10) return 'best';
  if (cpl <= 25) return 'excellent';
  if (cpl <= 60) return 'good';
  if (cpl <= 120) return 'inaccuracy';
  if (cpl <= 250) return 'mistake';
  return 'blunder';
}

/**
 * Calculate accuracy impact using exponential curve
 * Formula: cap * (1 - exp(-cpl / scale))
 * - 0 CPL = 0 impact
 * - 50 CPL = ~12 impact
 * - 150 CPL = ~25 impact
 * - 300+ CPL = ~40 (capped)
 */
function computeImpact(cpl: number): number {
  const cap = 40;
  const scale = 150;
  const impact = cap * (1 - Math.exp(-cpl / scale));
  return Math.round(impact * 10) / 10;
}

/**
 * Detect game phase from material count
 * Piece values: Q=9, R=5, B=3, N=3, P=1
 * Starting material = 78 (excluding kings)
 */
function detectPhase(fen: string): GamePhase {
  const board = fen.split(' ')[0];

  const pieceValues: Record<string, number> = {
    q: 9, Q: 9,
    r: 5, R: 5,
    b: 3, B: 3,
    n: 3, N: 3,
    p: 1, P: 1,
  };

  let material = 0;
  for (const char of board) {
    material += pieceValues[char] || 0;
  }

  const startingMaterial = 78;
  const ratio = material / startingMaterial;

  if (ratio > 0.85) return 'opening';
  if (ratio > 0.35) return 'middlegame';
  return 'endgame';
}

/**
 * Get phase weight multiplier
 * Opening: mistakes less impactful (learning phase)
 * Middlegame: standard weight
 * Endgame: mistakes more impactful (precision required)
 */
function getPhaseWeight(phase: GamePhase): number {
  switch (phase) {
    case 'opening':
      return 0.7;
    case 'middlegame':
      return 1.0;
    case 'endgame':
      return 1.3;
  }
}

/**
 * Normalize evaluation to player's perspective
 * Positive = good for player, Negative = bad for player
 */
function normalizeEval(evalCp: number, playerColor: 'white' | 'black'): number {
  return playerColor === 'white' ? evalCp : -evalCp;
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

      // 1. Analyze position BEFORE move (get best eval and best move)
      const beforeResults = await engine.search(fenBefore, 2, { depth: ANALYSIS_DEPTH });

      // 2. Analyze position AFTER move (get resulting eval)
      const afterResults = await engine.search(fenAfter, 1, { depth: ANALYSIS_DEPTH });

      // Extract evaluations (already normalized to white's perspective by EngineManager)
      const bestEvalRaw = beforeResults[0]?.evaluation ?? 0;
      const evalAfterRaw = afterResults[0]?.evaluation ?? 0;
      const bestMove = beforeResults[0]?.move ?? move;

      // Normalize to player's perspective
      const bestEval = normalizeEval(bestEvalRaw, playerColor);
      const evalAfter = normalizeEval(evalAfterRaw, playerColor);

      // Calculate CPL (from player's perspective, positive = loss)
      const cpl = Math.max(0, bestEval - evalAfter);

      // Detect phase and calculate weighted impact
      const phase = detectPhase(fenBefore);
      const phaseWeight = getPhaseWeight(phase);
      const accuracyImpact = computeImpact(cpl);
      const weightedImpact = Math.round(accuracyImpact * phaseWeight * 10) / 10;

      const classification = classifyMove(cpl);

      return {
        move,
        classification,
        cpl,
        accuracyImpact,
        weightedImpact,
        phase,
        evalBefore: bestEval,
        evalAfter,
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
          result: `${result.move} → ${result.classification}, cpl=${result.cpl}`,
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
