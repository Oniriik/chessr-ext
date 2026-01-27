/**
 * Evaluation helper functions for consistent handling of engine evaluations.
 *
 * Key principles:
 * - All evaluations normalized to side-to-move perspective
 * - Mate scores converted to comparable centipawns
 * - Consistent handling across stats and suggestions
 */

/**
 * Convert mate-in-N to comparable centipawns.
 *
 * Formula: sign * (100000 - abs(mateIn) * 1000)
 *
 * Examples:
 * - Mate in 1:  99000 cp (very good - quick mate)
 * - Mate in 10: 90000 cp (good but slower)
 * - Mated in 5: -95000 cp (very bad)
 *
 * @param mateIn - Mate in N moves (positive = winning, negative = losing)
 * @returns Centipawns equivalent
 */
export function mateToCp(mateIn: number): number {
  const sign = mateIn > 0 ? 1 : -1;
  return sign * (100000 - Math.abs(mateIn) * 1000);
}

/**
 * Normalize evaluation to side-to-move perspective.
 *
 * UCI engine returns eval from white's perspective (UCI standard).
 * For CPL calculations, we need side-to-move perspective where
 * positive = good for the player to move.
 *
 * @param evalCp - Evaluation in centipawns from white's perspective
 * @param isWhiteToMove - True if white to move
 * @returns Centipawns from side-to-move perspective (positive = good)
 */
export function normalizeEval(evalCp: number, isWhiteToMove: boolean): number {
  return isWhiteToMove ? evalCp : -evalCp;
}

/**
 * Get comparable centipawns from any evaluation (mate or cp).
 *
 * Combines mate conversion and perspective normalization into a single function.
 * Always returns evaluation from side-to-move perspective.
 *
 * @param evaluation - Engine evaluation in pawns, from white's POV
 * @param mate - Mate score if applicable (positive = mating, negative = being mated)
 * @param isWhiteToMove - True if white to move
 * @returns Comparable centipawns in side-to-move perspective
 */
export function getComparableCp(
  evaluation: number,
  mate: number | undefined,
  isWhiteToMove: boolean
): number {
  // First, convert to centipawns (white's POV)
  const cpWhitePov = mate !== undefined
    ? mateToCp(mate)
    : Math.round(evaluation * 100);

  // Then normalize to side-to-move perspective
  return normalizeEval(cpWhitePov, isWhiteToMove);
}
