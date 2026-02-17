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
  if (s.flags?.isMate && s.score?.type === 'mate') {
    badges.push(`Mate ${Math.abs(s.score.value)}`);
  }
  if (s.flags?.isCheck) badges.push('Check');

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

    return {
      analyzedPlies: plies,
      overallStats: stats,
      serverOverall: newAccuracy.overall,  // Store server's overall accuracy (player-only)
      initialCp: newAccuracy.window.initialCp,  // Store initial position eval for accurate recalculation
    };
  }

  // Merge new plies (skip duplicates)
  // Keep the earliest initialCp (from the first analysis window) for accurate game-level calculation
  const updated: AccuracyCache = {
    analyzedPlies: new Map(cache.analyzedPlies),
    overallStats: { ...cache.overallStats },
    serverOverall: newAccuracy.overall,  // Update with latest server overall (player-only)
    initialCp: cache.initialCp ?? newAccuracy.window.initialCp,  // Keep first initialCp
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
 * Convert centipawn evaluation to win percentage using Lichess formula.
 */
function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Convert engine score to centipawn.
 * For mate scores, use a capped value to avoid extreme win% swings.
 *
 * Using ±10000 creates artificial volatility when transitioning from
 * "clearly winning" (+800cp) to "mate in N" - the practical outcome
 * is the same but the numbers swing wildly.
 *
 * We use ±1500cp as the cap, which corresponds to ~99% win probability.
 * This matches how positions are already "won" at high material advantages.
 */
const MATE_CP_CAP = 1500;

function scoreToCp(score: { type: 'cp' | 'mate'; value: number }): number {
  if (score.type === 'mate') {
    return score.value > 0 ? MATE_CP_CAP : -MATE_CP_CAP;
  }
  // Also cap regular centipawn scores to avoid extreme values
  return Math.max(-MATE_CP_CAP, Math.min(MATE_CP_CAP, score.value));
}

/**
 * Calculate move accuracy from win percentages using Lichess formula.
 */
function calculateMoveAccuracyFromWinPercent(winPercentBefore: number, winPercentAfter: number): number {
  if (winPercentAfter >= winPercentBefore) {
    return 100;
  }
  const winDiff = winPercentBefore - winPercentAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411;
  const accuracy = raw + 1; // uncertainty bonus
  return Math.max(0, Math.min(100, accuracy));
}

/**
 * Calculate population standard deviation.
 */
function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Clamp a value to a range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate overall accuracy using Lila's dual-weighted algorithm.
 *
 * This is the CORRECT implementation matching lila/modules/analyse/src/main/AccuracyPercent.scala
 *
 * The algorithm:
 * 1. Takes centipawn evaluations in White POV
 * 2. Creates sliding windows for volatility calculation
 * 3. For each move, calculates accuracy with proper color perspective
 * 4. Returns (weightedMean + harmonicMean) / 2 for the target color(s)
 *
 * IMPORTANT: This function requires CONTIGUOUS plies. If there are gaps in allPlies,
 * the calculation will be incorrect because eval transitions would span multiple moves.
 *
 * @param allPlies - All plies sorted by plyIndex (MUST be contiguous for correct calculation)
 * @param targetPlies - Plies to include in accuracy calculation (can be filtered subset)
 * @param initialCp - Optional: centipawn eval of position before first analyzed move (default: 0)
 */
function calculateLilaAccuracy(allPlies: AccuracyPly[], targetPlies: AccuracyPly[], initialCp: number = 0): number {
  if (allPlies.length === 0 || targetPlies.length === 0) {
    return 100;
  }

  if (allPlies.length === 1) {
    // Single move: just return its accuracy (already calculated correctly on server)
    return targetPlies[0]?.accuracy ?? 100;
  }

  // Check for gaps in the ply sequence (critical for correct calculation)
  const startPlyIndex = allPlies[0].plyIndex;
  const endPlyIndex = allPlies[allPlies.length - 1].plyIndex;
  const expectedLength = endPlyIndex - startPlyIndex + 1;

  if (allPlies.length !== expectedLength) {
    // Gap detected - fall back to simple average of per-ply accuracies (server-calculated)
    const targetAccuracies = targetPlies.map(p => p.accuracy);
    return targetAccuracies.reduce((sum, a) => sum + a, 0) / targetAccuracies.length;
  }

  // Extract centipawn evaluations in White POV from all plies
  const cpsWhitePov = allPlies.map(p => scoreToCp(p.evaluation.playedAfter));

  // Prepend initial position evaluation and convert to win percentages
  // Use provided initialCp (position before first analyzed move) or 0 for standard starting position
  const allWinPercents = [cpToWinPercent(initialCp), ...cpsWhitePov.map(cp => cpToWinPercent(cp))];

  // Calculate adaptive window size: floor(n / 10), clamped [2, 8]
  const windowSize = clamp(Math.floor(cpsWhitePov.length / 10), 2, 8);

  // Create windows with padding (lila's algorithm)
  const paddingCount = Math.max(0, Math.min(windowSize, allWinPercents.length) - 2);
  const firstWindow = allWinPercents.slice(0, Math.min(windowSize, allWinPercents.length));
  const windows: number[][] = [];

  // Add padded windows
  for (let i = 0; i < paddingCount; i++) {
    windows.push(firstWindow);
  }

  // Add sliding windows
  for (let i = 0; i + windowSize <= allWinPercents.length; i++) {
    windows.push(allWinPercents.slice(i, i + windowSize));
  }

  // Calculate volatility weights (clamped [0.5, 12])
  const weights = windows.map(window => clamp(standardDeviation(window), 0.5, 12));

  // Calculate weighted accuracies with proper color perspective (matching Lichess exactly)
  const weightedAccuracies: { accuracy: number; weight: number; plyIndex: number }[] = [];

  for (let i = 0; i + 1 < allWinPercents.length; i++) {
    const prev = allWinPercents[i];
    const next = allWinPercents[i + 1];
    const weight = weights[i];
    // Use actual ply index from array (not calculated) to handle arbitrary start positions
    const plyIndex = allPlies[i].plyIndex;

    // Determine which color made this move based on actual ply index
    const isWhiteMove = plyIndex % 2 === 0;

    // Calculate accuracy with proper perspective (matching Lichess's color.fold)
    // For White: before = prev, after = next (white wants high win%)
    // For Black: before = next, after = prev (black wants low win%, so we invert)
    const winPercentBefore = isWhiteMove ? prev : next;
    const winPercentAfter = isWhiteMove ? next : prev;
    const accuracy = calculateMoveAccuracyFromWinPercent(winPercentBefore, winPercentAfter);

    weightedAccuracies.push({ accuracy, weight, plyIndex });
  }

  // Filter to target plies only
  const targetPlyIndices = new Set(targetPlies.map(p => p.plyIndex));
  const filteredData = weightedAccuracies.filter(wa => targetPlyIndices.has(wa.plyIndex));

  if (filteredData.length === 0) {
    return 100;
  }

  const accuracies = filteredData.map(d => d.accuracy);
  const filteredWeights = filteredData.map(d => d.weight);

  // Calculate volatility-weighted mean
  const sumOfProducts = accuracies.reduce((sum, acc, i) => sum + acc * filteredWeights[i], 0);
  const sumOfWeights = filteredWeights.reduce((sum, w) => sum + w, 0);
  const weightedMean = sumOfProducts / sumOfWeights;

  // Calculate harmonic mean (replace 0 with 0.01 to avoid division by zero)
  const safeAccuracies = accuracies.map(a => a === 0 ? 0.01 : a);
  const sumOfReciprocals = safeAccuracies.reduce((sum, a) => sum + 1 / a, 0);
  const harmonicMean = accuracies.length / sumOfReciprocals;

  return (weightedMean + harmonicMean) / 2;
}

/**
 * Build comprehensive AccuracyPayload from cache
 * Uses lila's dual-weighted algorithm for overall accuracy calculation
 * @param cache - The accumulated accuracy cache
 * @param playerColor - Optional: filter to show only moves from this color (player-only stats)
 */
export function buildAccuracyFromCache(
  cache: AccuracyCache,
  playerColor?: Side
): AccuracyPayload {
  // Get all plies sorted by plyIndex (needed for window calculation)
  const allPlies = Array.from(cache.analyzedPlies.values()).sort((a, b) => a.plyIndex - b.plyIndex);

  // Filter by player color if specified
  const targetPlies = playerColor
    ? allPlies.filter(ply => ply.side === playerColor)
    : allPlies;

  const totalPlies = targetPlies.length;

  // Calculate overall accuracy using lila's algorithm on the ENTIRE cache
  // Always recalculate from all accumulated plies (serverOverall only covers last window)
  // Use initialCp from cache if available (for partial game analysis accuracy)
  const totalAccuracy = calculateLilaAccuracy(allPlies, targetPlies, cache.initialCp ?? 0);

  const startPlyIndex = targetPlies.length > 0 ? targetPlies[0].plyIndex : 0;
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

  targetPlies.forEach(ply => {
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
    perPly: targetPlies,
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
