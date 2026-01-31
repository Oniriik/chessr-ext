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
 * Convert centipawns to win percentage (Lichess formula).
 *
 * Formula: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 *
 * This transforms Stockfish centipawn evaluations into a win probability
 * percentage (0-100%), based on empirical data from 2300-rated player games.
 *
 * @param cp - Centipawn evaluation
 * @returns Win percentage (0-100)
 */
export function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Calculate move accuracy percentage using Lichess formula.
 *
 * Formula: 103.1668 * exp(-0.04354 * winDiff) - 3.1669 + 1
 *
 * This determines how much a single move decreased winning chances.
 * The +1 is an "uncertainty bonus" due to imperfect analysis.
 *
 * @param winPercentBefore - Win percentage before the move
 * @param winPercentAfter - Win percentage after the move
 * @returns Move accuracy percentage (0-100)
 */
export function calculateMoveAccuracy(winPercentBefore: number, winPercentAfter: number): number {
  // If position improved or stayed the same, accuracy is 100%
  if (winPercentAfter >= winPercentBefore) {
    return 100;
  }

  const winDiff = winPercentBefore - winPercentAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) + -3.166924740191411;
  const accuracy = raw + 1; // uncertainty bonus

  return Math.round(Math.max(0, Math.min(100, accuracy)));
}
