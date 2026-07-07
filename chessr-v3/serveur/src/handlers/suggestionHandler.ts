/**
 * suggestionHandler — WS → BullMQ suggestion queue.
 *
 * Thin producer: validates input, builds the Komodo config, supersedes any
 * prior pending job from the same user, enqueues, awaits result, sends the
 * response (or error) back on the WebSocket.
 */

import { getEngineConfig, SEARCH_NODES } from '../engine/KomodoConfig.js';
import { getSuggestionConfig as getStockfishSuggestionConfig } from '../engine/StockfishConfig.js';
import { getRodentConfig } from '../engine/RodentConfig.js';
import {
  enqueueSuggestion,
  removePendingSuggestionsForUser,
  type SuggestionJobData,
} from '../queue/suggestionQueue.js';
import { insertUserActivity } from '../lib/analyticsRepo.js';
import { loadTrackStart, loadTrackEnd } from '../lib/engineLoad.js';
// NOTE: per-request logStart/logEnd removed from this handler. The extension
// drives a single `[suggestion] source=wasm|server` line via
// suggestion_log_start/end (see content.tsx). Logging here too would
// duplicate the entry. Engine-side timing breakdown is available via the
// `[Queues]` snapshot if needed.

export interface SuggestionMessage {
  type: 'suggestion_request';
  requestId: string;
  fen: string;
  /** Engine binary to run server-side. Defaults to 'komodo' for backward
   *  compat with older extension builds. */
  engine?: 'komodo' | 'stockfish' | 'rodent';
  moves?: string[];
  targetElo?: number;
  /** Rodent-only — alias for targetElo (extension sends this name). */
  eloTarget?: number;
  /** Rodent-only — 0..100 → EvalBlur. */
  imprecision?: number;
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
    requestId, fen, engine, moves, targetElo, eloTarget, imprecision,
    personality, multiPv, contempt, variety, puzzleMode, limitStrength,
    armageddon, searchMode, searchNodes, searchDepth, searchMovetime,
  } = message;
  const engineType: 'komodo' | 'stockfish' | 'rodent' =
    engine === 'stockfish' ? 'stockfish'
    : engine === 'rodent' ? 'rodent'
    : 'komodo';

  if (!requestId || !fen) {
    send({ type: 'suggestion_error', requestId, error: 'Missing requestId or fen' });
    return;
  }
  if (!isValidFen(fen)) {
    send({ type: 'suggestion_error', requestId, error: 'Invalid FEN' });
    return;
  }

  // Rodent uses `eloTarget` field; Komodo/Stockfish use `targetElo`. Tolerate
  // either since older clients only send one.
  const effectiveElo = (engineType === 'rodent' ? (eloTarget ?? targetElo) : targetElo) || 1500;
  const effectiveMultiPv = multiPv || 1;
  const effectiveLimit = limitStrength;

  const pvCount = Math.min(3, Math.max(1, effectiveMultiPv));
  // Build engine-specific UCI config. Each engine has a different knob set
  // (Komodo has Personality/Variety/Armageddon; Stockfish is minimal; Rodent
  // has PersonalityFile/EvalBlur) so we route to a dedicated builder.
  const config = engineType === 'stockfish'
    ? getStockfishSuggestionConfig({
        targetElo: effectiveElo,
        multiPv: pvCount,
        limitStrength: effectiveLimit,
        puzzleMode: !!puzzleMode,
      })
    : engineType === 'rodent'
      ? getRodentConfig({
          targetElo: effectiveElo,
          personality: personality || 'default',
          multiPv: pvCount,
          imprecision,
          limitStrength: effectiveLimit,
        })
      : getEngineConfig({
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
    // Rodent IV is an order of magnitude slower than Komodo/Stockfish per
    // ply — a depth-20 Rodent search blows the 30s EngineManager timeout
    // every time (the queue's historical failure #1). Cap it where it
    // completes reliably.
    const maxDepth = engineType === 'rodent' ? 14 : puzzleMode ? 30 : 20;
    const maxMovetime = engineType === 'rodent' ? 10_000 : puzzleMode ? 5000 : 3000;
    if (searchMode === 'depth' && searchDepth) {
      searchOptions.depth = Math.max(1, Math.min(maxDepth, searchDepth));
    } else if (searchMode === 'movetime' && searchMovetime) {
      searchOptions.movetime = Math.max(500, Math.min(maxMovetime, searchMovetime));
    } else {
      searchOptions.nodes = Math.max(100_000, Math.min(5_000_000, searchNodes || SEARCH_NODES));
    }
  } else if (engineType === 'rodent') {
    // Rodent IV + UCI_LimitStrength caps internal NPS to a few thousand to
    // simulate the target Elo. Sending an external nodes/movetime budget
    // would either cut the search short or wait too long. Leave searchOptions
    // empty — EngineManager will send bare `go`, and Rodent's internal
    // skill-based time manager decides when to stop (typically 5-15s at
    // Elo 1500-2200, well within the 30s engine timeout).
    // NB: when LimitStrength is OFF (Force Depth), we fall into the first
    // branch above and honor the user's depth/nodes/movetime settings.
  } else {
    searchOptions.nodes = SEARCH_NODES;
  }

  loadTrackStart(engineType, userId);
  const loadT0 = Date.now();

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
      engineType,
    });

    loadTrackEnd(engineType, Date.now() - loadT0);
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

    // Analytics — server-side path only. WASM-path suggestions don't
    // reach this handler; the extension must log those via a separate
    // server endpoint once that's wired in.
    insertUserActivity({
      userId,
      eventType: 'suggestion',
      engine: engineType,
      source: 'server',
    }).catch((err) => console.warn('[suggestion] analytics log failed:', err));
  } catch (err) {
    loadTrackEnd(engineType, null);
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'suggestion_error', requestId, error: msg });
  }
}

export async function handleUserDisconnectSuggestion(userId: string): Promise<void> {
  try { await removePendingSuggestionsForUser(userId); } catch { /* ignore */ }
}
