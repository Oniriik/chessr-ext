/**
 * suggestionHandler - WebSocket message handler for suggestion requests
 */

import type { WebSocket } from 'ws';
import { EnginePool } from '../engine/EnginePool.js';
import { getEngineConfig, SEARCH_NODES } from '../engine/KomodoConfig.js';
import { labelSuggestions } from '../engine/MoveLabeler.js';
import { SuggestionQueue } from '../queue/SuggestionQueue.js';

export interface Client {
  ws: WebSocket;
  user: {
    id: string;
    email: string;
  };
}

export interface SuggestionMessage {
  type: 'suggestion';
  requestId: string;
  fen: string;
  moves?: string[]; // UCI format moves (e2e4, g1f3, etc.) to replay game context
  targetElo?: number;
  personality?: string;
  multiPv?: number;
  contempt?: number; // Win intent (0-100) from side-to-move perspective
}

// Engine pool instance
let enginePool: EnginePool | null = null;

// Request queue
const queue = new SuggestionQueue();

// Processing loop running flag
let isLoopRunning = false;

/**
 * Initialize the engine pool
 */
export async function initEnginePool(maxInstances: number = 2): Promise<void> {
  enginePool = new EnginePool(maxInstances);
  await enginePool.init();

  // Start the processing loop
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
      // No requests, check again in 100ms
      setTimeout(processNext, 100);
      return;
    }

    // Mark user as processing
    queue.markProcessing(request.userId);

    try {
      // Acquire an engine from the pool
      const engine = await enginePool?.acquire();

      if (!engine) {
        // Pool was shut down
        request.callback(new Error('Engine pool unavailable'));
        queue.markDone(request.userId);
        setTimeout(processNext, 100);
        return;
      }

      try {
        // Check if request is still valid (not superseded)
        if (!queue.isRequestValid(request.requestId, request.userId)) {
          console.log(`[SuggestionHandler] Request ${request.requestId} superseded, skipping`);
          enginePool?.release(engine);
          queue.markDone(request.userId);
          setTimeout(processNext, 0);
          return;
        }

        // Process the request
        const result = await request.process(engine);

        // Check again if request is still valid before sending response
        if (queue.isRequestValid(request.requestId, request.userId)) {
          request.callback(null, result);
        }
      } finally {
        // Always release the engine
        enginePool?.release(engine);
      }
    } catch (error) {
      console.error(`[SuggestionHandler] Error processing ${request.requestId}:`, error);
      request.callback(error instanceof Error ? error : new Error(String(error)));
    } finally {
      queue.markDone(request.userId);
    }

    // Process next immediately
    setTimeout(processNext, 0);
  };

  // Start the loop
  processNext();
}

/**
 * Handle suggestion request message
 */
export function handleSuggestionRequest(message: SuggestionMessage, client: Client): void {
  const { requestId, fen, moves, targetElo, personality, multiPv, contempt } = message;

  // Validate required fields
  if (!requestId || !fen) {
    client.ws.send(
      JSON.stringify({
        type: 'suggestion_error',
        requestId,
        error: 'Missing required fields: requestId or fen',
      })
    );
    return;
  }

  // Validate FEN (basic check)
  if (!isValidFen(fen)) {
    client.ws.send(
      JSON.stringify({
        type: 'suggestion_error',
        requestId,
        error: 'Invalid FEN',
      })
    );
    return;
  }

  console.log(`[SuggestionHandler] Request ${requestId} from ${client.user.email}`);

  // Prepare config (standard search with MultiPV)
  const pvCount = Math.min(3, Math.max(1, multiPv || 1));
  const config = getEngineConfig({
    targetElo: targetElo || 1500,
    personality: personality || 'Default',
    multiPv: pvCount,
    contempt: contempt ?? 0,
  });

  // Add to queue
  queue.enqueue({
    requestId,
    userId: client.user.id,

    process: async (engine) => {
      // Configure engine for this request
      await engine.configure(config);

      // Run search with MultiPV (pass moves for game context)
      const rawSuggestions = await engine.search(fen, pvCount, SEARCH_NODES, moves);

      // Label suggestions
      const suggestions = labelSuggestions(rawSuggestions);

      // Position eval = best move's eval (in pawns, not centipawns)
      const positionEval = suggestions.length > 0 ? suggestions[0].evaluation / 100 : 0;

      // Mate score from best move (null if not a mate)
      const mateIn = suggestions.length > 0 ? suggestions[0].mateScore : null;

      // Win rate from best move
      const winRate = suggestions.length > 0 ? suggestions[0].winRate : 50;

      return { fen, personality: personality || 'Default', suggestions, positionEval, mateIn, winRate };
    },

    callback: (error, result) => {
      if (error) {
        console.error(`[SuggestionHandler] Error for ${requestId}:`, error.message);
        client.ws.send(
          JSON.stringify({
            type: 'suggestion_error',
            requestId,
            error: error.message || 'Engine error',
          })
        );
        return;
      }

      if (result) {
        console.log(
          `[SuggestionHandler] Sending ${result.suggestions.length} suggestions for ${requestId}`
        );

        client.ws.send(
          JSON.stringify({
            type: 'suggestion_result',
            requestId,
            fen: result.fen,
            personality: result.personality,
            positionEval: result.positionEval,
            mateIn: result.mateIn,
            winRate: result.winRate,
            suggestions: result.suggestions,
          })
        );
      }
    },
  });
}

/**
 * Basic FEN validation
 */
function isValidFen(fen: string): boolean {
  if (typeof fen !== 'string') return false;
  const parts = fen.split(' ');
  if (parts.length < 4) return false;
  // Check board has 8 ranks
  const ranks = parts[0].split('/');
  return ranks.length === 8;
}

/**
 * Handle user disconnection - cancel their pending requests
 */
export function handleUserDisconnect(userId: string): void {
  queue.cancelForUser(userId);
}

/**
 * Shutdown the engine pool
 */
export async function shutdownEnginePool(): Promise<void> {
  isLoopRunning = false;
  if (enginePool) {
    await enginePool.shutdown();
  }
}

/**
 * Get handler statistics
 */
export function getStats() {
  return {
    queue: queue.getStats(),
    pool: enginePool ? enginePool.getStats() : null,
  };
}
