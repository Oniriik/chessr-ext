/**
 * suggestionHandler — WS → BullMQ suggestion queue.
 *
 * Thin producer: validates input, builds the Komodo config, supersedes any
 * prior pending job from the same user, enqueues, awaits result, sends the
 * response (or error) back on the WebSocket.
 */

import { getEngineConfig, SEARCH_NODES } from '../engine/KomodoConfig.js';
import {
  enqueueSuggestion,
  removePendingSuggestionsForUser,
  type SuggestionJobData,
} from '../queue/suggestionQueue.js';
// NOTE: per-request logStart/logEnd removed from this handler. The extension
// drives a single `[suggestion] source=wasm|server` line via
// suggestion_log_start/end (see content.tsx). Logging here too would
// duplicate the entry. Engine-side timing breakdown is available via the
// `[Queues]` snapshot if needed.

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

function isValidFen(fen: string): boolean {
  if (typeof fen !== 'string') return false;
  const parts = fen.split(' ');
  if (parts.length < 4) return false;
  return parts[0].split('/').length === 8;
}

export async function handleSuggestionRequest(
  message: SuggestionMessage,
  userId: string,
  send: SendFn,
): Promise<void> {
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
  const effectiveLimit = limitStrength;

  const pvCount = Math.min(3, Math.max(1, effectiveMultiPv));
  const config = getEngineConfig({
    targetElo: effectiveElo,
    personality: personality || 'Default',
    multiPv: pvCount,
    contempt,
    variety,
    limitStrength: effectiveLimit,
    armageddon,
    puzzleMode,
  });

  const searchOptions: SuggestionJobData['searchOptions'] = { moves };
  if (effectiveLimit === false && searchMode) {
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

  // Supersede: drop any previously-queued (not yet running) request from
  // this user. An older request already in 'active' state will finish but
  // its result will be ignored by the handler (requestId check) — the
  // engine pool is small (2–4 instances) so the overlap is brief.
  try { await removePendingSuggestionsForUser(userId); } catch { /* ignore */ }

  try {
    const result = await enqueueSuggestion({
      requestId,
      userId,
      fen,
      pvCount,
      config,
      searchOptions,
      personality: personality || 'Default',
      puzzleMode: !!puzzleMode,
    });

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'suggestion_error', requestId, error: msg });
  }
}

export async function handleUserDisconnectSuggestion(userId: string): Promise<void> {
  try { await removePendingSuggestionsForUser(userId); } catch { /* ignore */ }
}
