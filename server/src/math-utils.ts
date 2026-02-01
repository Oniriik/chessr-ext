/**
 * Mathematical utility functions for statistical calculations.
 *
 * Based on Lichess (lila) accuracy calculation algorithms.
 */

/**
 * Cap for centipawn values when calculating accuracy.
 *
 * Using ±10000 for mate scores creates artificial volatility when transitioning
 * from "clearly winning" (+800cp) to "mate in N" - the practical outcome
 * is the same but the numbers swing wildly, distorting accuracy.
 *
 * ±1500cp corresponds to ~99% win probability, matching positions that are
 * already "won" at high material advantages.
 */
export const MATE_CP_CAP = 1500;

/**
 * Convert a centipawn value, capping extreme values to avoid distortion.
 */
export function capCentipawns(cp: number): number {
  return Math.min(Math.max(cp, -MATE_CP_CAP), MATE_CP_CAP);
}

/**
 * Convert mate score to capped centipawns.
 * Mate-in-N becomes ±MATE_CP_CAP regardless of N.
 */
export function mateToCappedCp(mateValue: number): number {
  return mateValue > 0 ? MATE_CP_CAP : -MATE_CP_CAP;
}

/**
 * Calculate population standard deviation.
 *
 * Formula: sqrt(Σ(xi - mean)² / n)
 *
 * Note: This is population stddev (divide by n), not sample stddev (divide by n-1).
 *
 * @param values - Array of numbers
 * @returns Standard deviation, or 0 if array is empty or has one element
 */
export function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;

  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Calculate harmonic mean.
 *
 * Formula: n / Σ(1 / xi)
 *
 * The harmonic mean penalizes outliers more than the arithmetic mean.
 * This is useful for accuracy calculation where bad moves should hurt more.
 *
 * To avoid division by zero, values of 0 are replaced with 0.01.
 *
 * @param values - Array of numbers (all must be positive)
 * @returns Harmonic mean, or 0 if array is empty
 */
export function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0;

  // Replace 0 with 0.01 to avoid division by zero
  const safeValues = values.map(x => x === 0 ? 0.01 : x);

  const sumOfReciprocals = safeValues.reduce((sum, x) => sum + 1 / x, 0);

  return values.length / sumOfReciprocals;
}

/**
 * Calculate weighted mean.
 *
 * Formula: Σ(wi * xi) / Σ(wi)
 *
 * @param values - Array of values
 * @param weights - Array of weights (must have same length as values)
 * @returns Weighted mean, or 0 if arrays are empty or mismatched
 */
export function weightedMean(values: number[], weights: number[]): number {
  if (values.length === 0 || weights.length === 0) return 0;
  if (values.length !== weights.length) {
    throw new Error(`values and weights must have same length (got ${values.length} and ${weights.length})`);
  }

  const sumOfProducts = values.reduce((sum, value, i) => sum + value * weights[i], 0);
  const sumOfWeights = weights.reduce((sum, w) => sum + w, 0);

  if (sumOfWeights === 0) return 0;

  return sumOfProducts / sumOfWeights;
}

/**
 * Clamp a value to a range [min, max].
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
