/**
 * suggestionHandler — Komodo suggestion requests via WebSocket.
 *
 * Adapted from chessr-next/serveur/src/handlers/suggestionHandler.ts. Key
 * differences:
 *   - No premium gate / crack detection (engines are free for all in v3)
 *   - No client object — takes userId + sendFn directly (ws.ts provides these)
 *   - Uses v3 wsLog (logStart/logEnd) instead of utils/logger
 */

import { EnginePool } from '../engine/EnginePool.js';
import { getEngineConfig, SEARCH_NODES } from '../engine/KomodoConfig.js';
import { labelSuggestions } from '../engine/MoveLabeler.js';
import { SuggestionQueue } from '../queue/SuggestionQueue.js';
import { logStart, logEnd } from '../lib/wsLog.js';

export interface SuggestionMessage {
  type: 'suggestion_request';
  requestId: string;
  fen: string;
  moves?: string[];
  targetElo?: number;
  personality?: string;
  multiPv?: number;
  contempt?: number;
  variety?: number;
  puzzleMode?: boolean;
  limitStrength?: boolean;
  armageddon?: 'off' | 'white' | 'black';
  searchMode?: 'nodes' | 'depth' | 'movetime';
  searchNodes?: number;
  searchDepth?: number;
  searchMovetime?: number;
}

type SendFn = (data: unknown) => void;

let enginePool: EnginePool | null = null;
const queue = new SuggestionQueue();
let isLoopRunning = false;

export async function initEnginePool(maxInstances = 2): Promise<void> {
  enginePool = new EnginePool(maxInstances);
  await enginePool.init();
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
      const engine = await enginePool?.acquire();
      if (!engine) {
        request.callback(new Error('Engine pool unavailable'));
        queue.markDone(request.userId);
        setTimeout(processNext, 100);
        return;
      }
      try {
        if (!queue.isRequestValid(request.requestId, request.userId)) {
          enginePool?.release(engine);
          queue.markDone(request.userId);
          setTimeout(processNext, 0);
          return;
        }
        const result = await request.process(engine);
        if (queue.isRequestValid(request.requestId, request.userId)) {
          request.callback(null, result);
        }
      } finally {
        enginePool?.release(engine);
      }
    } catch (error) {
      console.error(`[SuggestionHandler] Error processing ${request.requestId}:`, error);
      request.callback(error instanceof Error ? error : new Error(String(error)));
    } finally {
      queue.markDone(request.userId);
    }
    setTimeout(processNext, 0);
  };

  processNext();
}

function isValidFen(fen: string): boolean {
  if (typeof fen !== 'string') return false;
  const parts = fen.split(' ');
  if (parts.length < 4) return false;
  return parts[0].split('/').length === 8;
}

export function handleSuggestionRequest(
  message: SuggestionMessage,
  userId: string,
  send: SendFn,
): void {
  const {
    requestId, fen, moves, targetElo, personality, multiPv,
    contempt, variety, puzzleMode, limitStrength, armageddon,
    searchMode, searchNodes, searchDepth, searchMovetime,
  } = message;

  if (!requestId || !fen) {
    send({ type: 'suggestion_error', requestId, error: 'Missing requestId or fen' });
    return;
  }
  if (!isValidFen(fen)) {
    send({ type: 'suggestion_error', requestId, error: 'Invalid FEN' });
    return;
  }

  const effectiveElo = targetElo || 1500;
  const effectiveMultiPv = multiPv || 1;
  const effectiveLimitStrength = limitStrength;

  logStart(userId, requestId, 'suggestion',
    `mode=${puzzleMode ? 'puzzle' : 'game'}, elo=${effectiveElo}, pv=${effectiveMultiPv}`);

  const pvCount = Math.min(3, Math.max(1, effectiveMultiPv));
  const config = getEngineConfig({
    targetElo: effectiveElo,
    personality: personality || 'Default',
    multiPv: pvCount,
    contempt,
    variety,
    limitStrength: effectiveLimitStrength,
    armageddon,
    puzzleMode,
  });

  queue.enqueue({
    requestId,
    userId,
    process: async (engine) => {
      await engine.configure(config);
      const searchOptions: { nodes?: number; depth?: number; movetime?: number; moves?: string[] } = { moves };
      if (effectiveLimitStrength === false && searchMode) {
        const maxDepth = puzzleMode ? 30 : 20;
        const maxMovetime = puzzleMode ? 5000 : 3000;
        if (searchMode === 'depth' && searchDepth) {
          searchOptions.depth = Math.max(1, Math.min(maxDepth, searchDepth));
        } else if (searchMode === 'movetime' && searchMovetime) {
          searchOptions.movetime = Math.max(500, Math.min(maxMovetime, searchMovetime));
        } else {
          searchOptions.nodes = Math.max(100_000, Math.min(5_000_000, searchNodes || SEARCH_NODES));
        }
      } else {
        searchOptions.nodes = SEARCH_NODES;
      }
      const rawSuggestions = await engine.search(fen, pvCount, searchOptions);
      const suggestions = labelSuggestions(rawSuggestions);
      const positionEval = suggestions.length > 0 ? suggestions[0].evaluation / 100 : 0;
      const mateIn = suggestions.length > 0 ? suggestions[0].mateScore : null;
      const winRate = suggestions.length > 0 ? suggestions[0].winRate : 50;
      const maxDepth = suggestions.length > 0 ? Math.max(...suggestions.map((s) => s.depth)) : 0;
      return {
        fen,
        personality: personality || 'Default',
        suggestions,
        positionEval,
        mateIn,
        winRate,
        puzzleMode: !!puzzleMode,
        maxDepth,
      };
    },
    callback: (error, result) => {
      if (error) {
        logEnd(userId, requestId, 'suggestion', `fail:${error.message || 'engine error'}`);
        send({ type: 'suggestion_error', requestId, error: error.message || 'Engine error' });
        return;
      }
      if (result) {
        logEnd(userId, requestId, 'suggestion',
          `${result.suggestions.length} suggestions, eval=${result.positionEval}, depth=${result.maxDepth}`);
        send({
          type: 'suggestion_response',
          requestId,
          fen: result.fen,
          personality: result.personality,
          positionEval: result.positionEval,
          mateIn: result.mateIn,
          winRate: result.winRate,
          suggestions: result.suggestions,
          puzzleMode: result.puzzleMode,
        });
      }
    },
  });
}

export function handleUserDisconnectSuggestion(userId: string): void {
  queue.cancelForUser(userId);
}

export async function shutdownEnginePool(): Promise<void> {
  isLoopRunning = false;
  if (enginePool) await enginePool.shutdown();
}
