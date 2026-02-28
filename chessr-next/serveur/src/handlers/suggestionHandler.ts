/**
 * suggestionHandler - WebSocket message handler for suggestion requests
 */

import type { WebSocket } from 'ws';
import { EnginePool } from '../engine/EnginePool.js';
import { getEngineConfig, SEARCH_NODES } from '../engine/KomodoConfig.js';
import { labelSuggestions } from '../engine/MoveLabeler.js';
import { SuggestionQueue } from '../queue/SuggestionQueue.js';
import { logStart, logEnd, logError } from '../utils/logger.js';
import { logActivity } from '../utils/activityLogger.js';

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
  contempt?: number; // Ambition (-100 to 100), maps to Komodo Contempt
  variety?: number; // Move variety (0-10), maps to Komodo Variety
  puzzleMode?: boolean; // True for puzzle suggestions (max power, no ELO limit)
  limitStrength?: boolean; // Whether to limit engine strength (default true)
  armageddon?: 'off' | 'white' | 'black'; // Armageddon mode
  searchMode?: 'nodes' | 'depth' | 'movetime'; // Search control mode
  searchNodes?: number; // Custom node limit (100k-5M, only when limitStrength=false)
  searchDepth?: number; // Custom depth limit (1-30, only when limitStrength=false)
  searchMovetime?: number; // Custom movetime in ms (500-5000, only when limitStrength=false)
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
  const { requestId, fen, moves, targetElo, personality, multiPv, contempt, variety, puzzleMode, limitStrength, armageddon, searchMode, searchNodes, searchDepth, searchMovetime } = message;

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

  const modeLabel = puzzleMode ? 'puzzle' : 'game';
  logStart({
    requestId,
    email: client.user.email,
    type: 'suggestion',
    params: `mode=${modeLabel}, elo=${targetElo || 1500}, pv=${multiPv || 1}${contempt !== undefined ? `, ambition=${contempt}` : ''}${variety ? `, variety=${variety}` : ''}${limitStrength === false && searchMode === 'nodes' && searchNodes ? `, nodes=${searchNodes}` : ''}${limitStrength === false && searchMode === 'depth' && searchDepth ? `, depth=${searchDepth}` : ''}${limitStrength === false && searchMode === 'movetime' && searchMovetime ? `, movetime=${searchMovetime}ms` : ''}`,
  });

  // Prepare config (standard search with MultiPV)
  const pvCount = Math.min(3, Math.max(1, multiPv || 1));
  const config = getEngineConfig({
    targetElo: targetElo || 1500,
    personality: personality || 'Default',
    multiPv: pvCount,
    contempt: contempt,
    variety: variety,
    limitStrength: limitStrength,
    armageddon: armageddon,
    puzzleMode: puzzleMode,
  });

  // Add to queue
  queue.enqueue({
    requestId,
    userId: client.user.id,

    process: async (engine) => {
      // Configure engine for this request
      await engine.configure(config);

      // Build search options based on mode
      const searchOptions: { nodes?: number; depth?: number; movetime?: number; moves?: string[] } = { moves };
      if (limitStrength === false && searchMode) {
        if (searchMode === 'depth' && searchDepth) {
          searchOptions.depth = Math.max(1, Math.min(30, searchDepth));
        } else if (searchMode === 'movetime' && searchMovetime) {
          searchOptions.movetime = Math.max(500, Math.min(5000, searchMovetime));
        } else {
          searchOptions.nodes = Math.max(100_000, Math.min(5_000_000, searchNodes || SEARCH_NODES));
        }
      } else {
        searchOptions.nodes = SEARCH_NODES;
      }
      const rawSuggestions = await engine.search(fen, pvCount, searchOptions);

      // Label suggestions
      const suggestions = labelSuggestions(rawSuggestions);

      // Position eval = best move's eval (in pawns, not centipawns)
      const positionEval = suggestions.length > 0 ? suggestions[0].evaluation / 100 : 0;

      // Mate score from best move (null if not a mate)
      const mateIn = suggestions.length > 0 ? suggestions[0].mateScore : null;

      // Win rate from best move
      const winRate = suggestions.length > 0 ? suggestions[0].winRate : 50;

      // Max depth reached across all suggestions
      const maxDepth = suggestions.length > 0 ? Math.max(...suggestions.map(s => s.depth)) : 0;

      return { fen, personality: personality || 'Default', suggestions, positionEval, mateIn, winRate, puzzleMode: !!puzzleMode, maxDepth };
    },

    callback: (error, result) => {
      // Guard: client may have disconnected while request was queued
      if (client.ws.readyState !== 1) return;

      if (error) {
        logError({
          requestId,
          email: client.user.email,
          type: 'suggestion',
          error: error.message || 'Engine error',
        });
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
        logEnd({
          requestId,
          email: client.user.email,
          type: 'suggestion',
          result: `${result.suggestions.length} suggestions, eval=${result.positionEval}, depth=${result.maxDepth}`,
        });

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
            puzzleMode: result.puzzleMode,
          })
        );

        // Log activity for admin dashboard metrics
        logActivity(client.user.id, 'suggestion');
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
