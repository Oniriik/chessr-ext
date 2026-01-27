/**
 * Statistics calculation functions for chess game analysis.
 *
 * Key fix: Uses RATE-based penalties instead of flat counts.
 * This ensures that accuracy metrics are normalized across game lengths.
 */

export interface GameStats {
  acpl: number;
  adjustedAcpl: number;
  estimatedElo: number;
  accuracy: number;
  movesAnalyzed: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  mateMisses: number;
}

/**
 * Calculate centipawn loss for a single move.
 *
 * CPL = max(0, evalBefore - evalAfter)
 *
 * Both evaluations must be in side-to-move perspective
 * (positive = good for the player who just moved).
 *
 * @param evalBefore - Evaluation before the move (side-to-move perspective, in cp)
 * @param evalAfter - Evaluation after the move (side-to-move perspective, in cp)
 * @returns Centipawn loss (0 if position improved, capped at 1000)
 */
export function calculateCPL(evalBefore: number, evalAfter: number): number {
  const cpl = Math.max(0, evalBefore - evalAfter);
  // Cap at 1000 to avoid mate scores inflating ACPL
  return Math.min(cpl, 1000);
}

/**
 * Classify a move based on its centipawn loss.
 *
 * Thresholds:
 * - Blunder: CPL >= 300
 * - Mistake: CPL >= 100
 * - Inaccuracy: CPL >= 50
 * - Good: CPL < 50
 *
 * @param cpl - Centipawn loss for the move
 * @returns Move classification
 */
export function classifyMove(cpl: number): 'blunder' | 'mistake' | 'inaccuracy' | 'good' {
  if (cpl >= 300) return 'blunder';
  if (cpl >= 100) return 'mistake';
  if (cpl >= 50) return 'inaccuracy';
  return 'good';
}

/**
 * Check if a move missed a forced mate opportunity.
 *
 * A mate miss occurs when:
 * - The position before had a mate advantage (mateIn > 0)
 * - The position after no longer has that mate (undefined or <= 0)
 *
 * @param mateInBefore - Mate score before move (positive = winning)
 * @param mateInAfter - Mate score after move
 * @returns True if player missed a mate opportunity
 */
export function isMatemiss(
  mateInBefore: number | undefined,
  mateInAfter: number | undefined
): boolean {
  return (
    mateInBefore !== undefined &&
    mateInBefore > 0 &&
    (mateInAfter === undefined || mateInAfter <= 0)
  );
}

/**
 * Calculate adjusted ACPL using RATE-based penalties.
 *
 * Formula: ACPL + 5*inaccRate*40 + 10*mistakeRate*40 + 20*blunderRate*40 + 40*mateRate*40
 *
 * KEY FIX: Uses per-move rates instead of flat counts.
 * This reflects the true impact on performance and normalizes across different game lengths.
 *
 * Example:
 * - 2 blunders in 10 moves: blunderRate = 0.2, penalty = 20*0.2*40 = 160
 * - 2 blunders in 40 moves: blunderRate = 0.05, penalty = 20*0.05*40 = 40
 *
 * @param acpl - Raw average centipawn loss
 * @param blunders - Number of blunders
 * @param mistakes - Number of mistakes
 * @param inaccuracies - Number of inaccuracies
 * @param mateMisses - Number of missed mates
 * @param totalMoves - Total number of moves analyzed
 * @returns Adjusted ACPL with rate-based penalties
 */
export function calculateAdjustedAcpl(
  acpl: number,
  blunders: number,
  mistakes: number,
  inaccuracies: number,
  mateMisses: number,
  totalMoves: number
): number {
  if (totalMoves === 0) return acpl;

  // Calculate per-move rates
  const blunderRate = blunders / totalMoves;
  const mistakeRate = mistakes / totalMoves;
  const inaccRate = inaccuracies / totalMoves;
  const mateRate = mateMisses / totalMoves;

  // Per-move penalties weighted by frequency
  const penalty =
    5 * inaccRate * 40 +
    10 * mistakeRate * 40 +
    20 * blunderRate * 40 +
    40 * mateRate * 40;

  return acpl + penalty;
}

/**
 * Convert ACPL to estimated ELO rating.
 *
 * Formula: clamp(2800 - 8 * ACPL, 100, 3000)
 *
 * Uses raw ACPL (not adjusted) for ELO estimation.
 *
 * @param acpl - Raw average centipawn loss
 * @returns Estimated ELO rating (100-3000)
 */
export function acplToElo(acpl: number): number {
  const elo = 2800 - 8 * acpl;
  return Math.round(Math.max(100, Math.min(3000, elo)));
}

/**
 * Convert adjusted ACPL to accuracy percentage (chess.com style).
 *
 * Formula: clamp(100 * exp(-AdjustedACPL / 40), 0, 100)
 *
 * Uses adjusted ACPL (with error penalties) for accuracy calculation.
 *
 * @param adjustedAcpl - Adjusted ACPL with penalties
 * @returns Accuracy percentage (0-100)
 */
export function acplToAccuracy(adjustedAcpl: number): number {
  const accuracy = 100 * Math.exp(-adjustedAcpl / 40);
  return Math.round(Math.max(0, Math.min(100, accuracy)));
}
