/**
 * Helper functions for the feedback system.
 * Based on the specification document for post-move feedback and analysis.
 */

import {
  Side,
  BadgeLabel,
  EngineScore,
  SuggestionMove,
  AccuracyPayload,
  AccuracyPly,
  AccuracyCache,
  Snapshot,
  MoveFeedback,
  ChessrState,
  AnalyzeResultResponse,
} from './feedback-types';

// ============================================================================
// Hashing & Anti-Stale
// ============================================================================

/**
 * Simple non-crypto hash for position identification
 */
export function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Compute hash for FEN + recent moves to identify position
 */
export function computeFenHash(fen: string, movesUciTail: string[] = []): string {
  return stableHash(fen + '|' + movesUciTail.join(' '));
}

// ============================================================================
// Suggestion Selection
// ============================================================================

/**
 * Pick the default selected suggestion index from payload
 */
export function pickDefaultSelectedIndex(
  chosenIndex: number,
  suggestionsLength: number
): number {
  const idx = chosenIndex ?? 0;
  const max = suggestionsLength - 1;
  return Math.max(0, Math.min(idx, max));
}

// ============================================================================
// Promotion UX
// ============================================================================

const PROMO_NAME: Record<string, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
};

/**
 * Format suggestion title with human-readable promotion text
 */
export function formatSuggestionTitle(s: SuggestionMove): string {
  if (s.flags?.isPromotion && s.flags.promotionPiece) {
    const pieceName = PROMO_NAME[s.flags.promotionPiece] ?? s.flags.promotionPiece.toUpperCase();
    return `Promote to ${pieceName} (${s.label})`;
  }
  return `${s.label}: ${s.move}`;
}

// ============================================================================
// Badges
// ============================================================================

/**
 * Build list of badge strings for UI display
 */
export function buildBadges(s: SuggestionMove): string[] {
  const badges: string[] = [];

  // Main label
  if (s.label) {
    badges.push(s.label);
  }

  // Risk badge (only if different from main label to avoid duplication)
  if (s.safety?.blunderRisk) {
    const mainLabel = s.label;

    if (s.safety.blunderRisk === 'high' && mainLabel !== 'Risky') {
      badges.push('⚠ Risky');
    } else if (s.safety.blunderRisk === 'medium') {
      badges.push('Medium risk');
    } else if (s.safety.blunderRisk === 'low' && mainLabel !== 'Safe') {
      badges.push('Safe');
    }
  }

  // Sub-badges
  if (s.flags?.isMate) badges.push('# Mate');
  if (s.flags?.isCheck) badges.push('+ Check');

  // Capture badge with piece symbol if available
  if (s.flags?.isCapture) {
    if (s.flags.capturedPiece) {
      const pieceSymbols: Record<string, string> = {
        p: '♟', // Pawn
        n: '♞', // Knight
        b: '♝', // Bishop
        r: '♜', // Rook
        q: '♛', // Queen
        k: '♚', // King (rare but possible)
      };
      const symbol = pieceSymbols[s.flags.capturedPiece] || '';
      badges.push(`x ${symbol}`);
    } else {
      badges.push('x Capture');
    }
  }

  if (s.flags?.isPromotion && s.flags.promotionPiece) {
    badges.push(`♛ Promo ${s.flags.promotionPiece.toUpperCase()}`);
  }

  return badges;
}

// ============================================================================
// Move Matching
// ============================================================================

/**
 * Find index of played move in suggestions array
 */
export function findSuggestionMatchIndex(
  suggestions: SuggestionMove[],
  playedMoveUci: string
): number {
  return suggestions.findIndex(s => s.move === playedMoveUci);
}

// ============================================================================
// Score Delta Calculation
// ============================================================================

/**
 * Convert score to centipawns if possible, null for mate scores
 */
export function scoreToCpIfPossible(score: EngineScore): number | null {
  if (score.type !== 'cp') return null;
  return score.value;
}

/**
 * Calculate centipawn loss vs best move (always >= 0)
 * Scores are in White POV, so we flip for black's perspective
 */
export function computeDeltaCpVsBest(
  bestScore: EngineScore,
  pickedScore: EngineScore,
  sideToMoveAtSuggestionTime: Side
): number | null {
  const bestCp = scoreToCpIfPossible(bestScore);
  const pickCp = scoreToCpIfPossible(pickedScore);

  if (bestCp === null || pickCp === null) return null;

  // POV white: higher is better for white, lower is better for black
  let delta = 0;
  if (sideToMoveAtSuggestionTime === 'w') {
    delta = bestCp - pickCp;
  } else {
    delta = pickCp - bestCp;
  }

  return Math.max(0, Math.round(delta));
}

// ============================================================================
// Move Feedback
// ============================================================================

/**
 * Build complete feedback object after a move is played
 */
export function buildMoveFeedback(
  snapshot: Snapshot,
  playedMoveUci: string
): MoveFeedback {
  const { suggestions, sideToMove } = snapshot;
  const matchIndex = findSuggestionMatchIndex(suggestions, playedMoveUci);

  if (matchIndex !== -1) {
    // Move was suggested
    const picked = suggestions[matchIndex];
    const best = suggestions[0];
    const deltaCp = computeDeltaCpVsBest(best.score, picked.score, sideToMove);

    const rankTxt = `#${picked.index}`;
    const deltaTxt = deltaCp !== null ? ` — −${deltaCp} cp vs Best` : '';
    const msg = `✅ Played ${picked.label} ${rankTxt}${deltaTxt}`;

    return {
      playedMoveUci,
      wasSuggested: true,
      matchIndex,
      label: picked.label || 'Alt',
      deltaCpVsBest: deltaCp ?? undefined,
      message: msg,
      pvToAutoExpand: picked.pv,
    };
  }

  // Move not suggested
  return {
    playedMoveUci,
    wasSuggested: false,
    matchIndex: -1,
    label: '?',
    message: '? Not in top suggestions',
  };
}

/**
 * Apply post-move UI effects (auto-expand PV, etc.)
 */
export function applyPostMoveUiEffects(
  state: ChessrState,
  feedback: MoveFeedback
): ChessrState {
  const next: ChessrState = {
    ...state,
    status: 'MOVE_PLAYED',
    lastFeedback: feedback,
  };

  // Auto-expand PV if move was suggested
  if (feedback.wasSuggested && feedback.matchIndex !== -1) {
    next.expandedPvSuggestionIndex = feedback.matchIndex;
  } else {
    next.expandedPvSuggestionIndex = undefined;
  }

  return next;
}

// ============================================================================
// Accuracy Accumulation
// ============================================================================

/**
 * Merge new accuracy results into accumulated cache.
 * Deduplicates by plyIndex - only adds new plies not already analyzed.
 */
/**
 * Map classification label to stats key.
 * Classifications are PascalCase ('Best') but stats keys are lowercase ('best').
 */
function classificationToStatsKey(
  classification: AccuracyPly['classification']
): keyof AccuracyCache['overallStats'] {
  const mapping: Record<AccuracyPly['classification'], keyof AccuracyCache['overallStats']> = {
    'Brilliant': 'brilliant',
    'Great': 'great',
    'Best': 'best',
    'Excellent': 'excellent',
    'Good': 'good',
    'Book': 'book',
    'Inaccuracy': 'inaccuracies',
    'Mistake': 'mistakes',
    'Blunder': 'blunders',
  };
  return mapping[classification];
}

export function mergeAccuracyIntoCache(
  cache: AccuracyCache | undefined,
  newAccuracy: AccuracyPayload
): AccuracyCache {
  // Initialize cache if first analysis
  if (!cache) {
    const stats = {
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      good: 0,
      book: 0,
      inaccuracies: 0,
      mistakes: 0,
      blunders: 0,
    };

    const plies = new Map<number, AccuracyPly>();

    // Add all plies from new result
    newAccuracy.perPly.forEach(ply => {
      plies.set(ply.plyIndex, ply);
      const key = classificationToStatsKey(ply.classification);
      stats[key]++;
    });

    return { analyzedPlies: plies, overallStats: stats };
  }

  // Merge new plies (skip duplicates)
  const updated = {
    analyzedPlies: new Map(cache.analyzedPlies),
    overallStats: { ...cache.overallStats },
  };

  newAccuracy.perPly.forEach(ply => {
    if (!updated.analyzedPlies.has(ply.plyIndex)) {
      updated.analyzedPlies.set(ply.plyIndex, ply);
      const key = classificationToStatsKey(ply.classification);
      updated.overallStats[key]++;
    }
  });

  return updated;
}

/**
 * Build comprehensive AccuracyPayload from cache
 * Recalculates overall accuracy from all accumulated plies
 * @param cache - The accumulated accuracy cache
 * @param playerColor - Optional: filter to show only moves from this color (player-only stats)
 */
export function buildAccuracyFromCache(
  cache: AccuracyCache,
  playerColor?: Side
): AccuracyPayload {
  let plies = Array.from(cache.analyzedPlies.values()).sort((a, b) => a.plyIndex - b.plyIndex);

  // Filter by player color if specified (show only player's moves)
  if (playerColor) {
    plies = plies.filter(ply => ply.side === playerColor);
  }

  const totalPlies = plies.length;
  const totalAccuracy = totalPlies > 0
    ? plies.reduce((sum, p) => sum + p.accuracy, 0) / totalPlies
    : 100;

  const startPlyIndex = plies.length > 0 ? plies[0].plyIndex : 0;
  const analyzedPlies = totalPlies;

  // Recalculate summary stats for filtered plies only
  const summary = {
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    book: 0,
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
  };

  plies.forEach(ply => {
    const key = classificationToStatsKey(ply.classification);
    summary[key]++;
  });

  return {
    method: 'win_percent_loss', // Using win% for better accuracy
    window: {
      lastMoves: Math.ceil(analyzedPlies / 2),
      lastPlies: analyzedPlies,
      analyzedPlies,
      startPlyIndex,
    },
    overall: Math.round(totalAccuracy),
    summary,
    perPly: plies,
  };
}

// ============================================================================
// Accuracy Trend
// ============================================================================

/**
 * Compute trend direction between two accuracy payloads
 */
export function computeAccuracyTrend(
  prev?: AccuracyPayload,
  next?: AccuracyPayload
): 'up' | 'down' | 'flat' | 'none' {
  if (!prev || !next) return 'none';
  if (next.overall > prev.overall) return 'up';
  if (next.overall < prev.overall) return 'down';
  return 'flat';
}

// ============================================================================
// State Machine Handlers
// ============================================================================

/**
 * Handle analyze_result response from server
 */
export function onAnalyzeResult(
  state: ChessrState,
  result: AnalyzeResultResponse,
  currentFen: string,
  currentMovesUci: string[]
): ChessrState {
  // Anti-stale: check if response matches current position
  const fenHash = computeFenHash(currentFen, currentMovesUci.slice(-8));
  const plyIndex = currentMovesUci.length;
  const resPly = result.payload.suggestions.context.plyIndex;

  // Strict check: ply index must match
  if (resPly !== plyIndex) {
    console.warn('[Feedback] Stale response ignored', {
      expected: plyIndex,
      received: resPly,
    });
    return { ...state }; // Ignore stale
  }

  // Merge new accuracy data into cache
  const updatedCache = mergeAccuracyIntoCache(state.accuracyCache, result.payload.accuracy);
  const comprehensiveAccuracy = buildAccuracyFromCache(updatedCache);

  console.log('[Feedback] Accuracy cache updated', {
    newPlies: result.payload.accuracy.perPly.length,
    totalCached: updatedCache.analyzedPlies.size,
    overall: comprehensiveAccuracy.overall,
    stats: updatedCache.overallStats,
  });

  // Build snapshot with comprehensive accuracy
  const snapshot: Snapshot = {
    requestId: result.requestId,
    fenHash,
    plyIndex,
    sideToMove: result.payload.suggestions.context.sideToMove,
    chosenIndex: result.payload.suggestions.chosenIndex,
    suggestions: result.payload.suggestions.suggestions,
    accuracy: comprehensiveAccuracy, // Use comprehensive accuracy from cache
    receivedAt: Date.now(),
  };

  const selected = pickDefaultSelectedIndex(
    result.payload.suggestions.chosenIndex,
    result.payload.suggestions.suggestions.length
  );

  return {
    ...state,
    status: 'SHOWING',
    activeSnapshot: snapshot,
    selectedSuggestionIndex: selected,
    previousAccuracy: state.activeSnapshot?.accuracy, // For trend
    accuracyCache: updatedCache, // Save updated cache
  };
}

/**
 * Handle player move detected
 */
export function onPlayerMoveDetected(
  state: ChessrState,
  playedMoveUci: string
): ChessrState {
  const snap = state.activeSnapshot;
  if (!snap) return state;

  // Only meaningful if we were showing suggestions
  if (state.status !== 'SHOWING') return state;

  const feedback = buildMoveFeedback(snap, playedMoveUci);
  return applyPostMoveUiEffects(state, feedback);
}

// ============================================================================
// Chess.js Integration Helpers
// ============================================================================

/**
 * Convert UCI move to chess.js move object
 */
export function uciToMoveObject(uci: string) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length === 5 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

/**
 * Convert chess.js move object to UCI
 */
export function moveObjToUci(m: { from: string; to: string; promotion?: string }): string {
  return m.promotion ? `${m.from}${m.to}${m.promotion}` : `${m.from}${m.to}`;
}
