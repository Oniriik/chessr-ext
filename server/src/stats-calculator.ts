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

/**
 * Calculate per-color accuracy using Lila's dual-weighted system.
 * This is the CORRECT implementation matching lila/modules/analyse/src/main/AccuracyPercent.scala:79-114
 *
 * IMPORTANT: Unlike the previous implementation, this function takes RAW centipawn
 * evaluations in White POV and recalculates per-move accuracy during aggregation
 * with proper color perspective. This matches how Lichess does it.
 *
 * @param cpsWhitePov - Array of centipawn evaluations in White POV (positive = good for white)
 * @param startColor - Which color made the first move ('w' for standard games)
 * @param onlyColor - Optional: calculate only this color (performance optimization)
 * @param initialCp - Optional: centipawn eval of position before first move (default: 0 for starting position)
 * @returns Object with white and/or black accuracies, or undefined if insufficient data
 */
export function calculateGameAccuracyByColor(
  cpsWhitePov: number[],
  startColor: 'w' | 'b' = 'w',
  onlyColor?: 'w' | 'b',
  initialCp: number = 0
): { white?: number; black?: number } | undefined {
  if (cpsWhitePov.length < 2) {
    return undefined;
  }

  // Import math utilities
  const { standardDeviation, harmonicMean, weightedMean, clamp } = require('./math-utils.js');

  // Prepend initial position evaluation and convert to win percentages
  // Use provided initialCp (position before first analyzed move) or 0 for standard starting position
  const allWinPercents = [cpToWinPercent(initialCp), ...cpsWhitePov.map(cp => cpToWinPercent(cp))];

  // Calculate adaptive window size: floor(n / 10), clamped [2, 8]
  // This matches: val windowSize = (cps.size / 10).atLeast(2).atMost(8)
  const windowSize = clamp(Math.floor(cpsWhitePov.length / 10), 2, 8);

  // Create windows with padding (lila line 84-87)
  // List.fill(windowSize.atMost(allWinPercentValues.size) - 2)(allWinPercentValues.take(windowSize))
  //   ::: allWinPercentValues.sliding(windowSize).toList
  const paddingCount = Math.max(0, Math.min(windowSize, allWinPercents.length) - 2);
  const firstWindow = allWinPercents.slice(0, Math.min(windowSize, allWinPercents.length));
  const paddedWindows: number[][] = Array(paddingCount).fill(firstWindow);

  // Create sliding windows
  const slidingWindows: number[][] = [];
  for (let i = 0; i + windowSize <= allWinPercents.length; i++) {
    slidingWindows.push(allWinPercents.slice(i, i + windowSize));
  }

  const windows = [...paddedWindows, ...slidingWindows];

  // Calculate volatility weights per window (lila line 88)
  // windows.map { xs => Maths.standardDeviation(xs).orZero.atLeast(0.5).atMost(12) }
  const weights = windows.map(window => {
    const stdDev = standardDeviation(window);
    return clamp(stdDev, 0.5, 12);
  });

  // Calculate weighted accuracies with proper color perspective (lila lines 89-98)
  // allWinPercents.sliding(2).zip(weights).zipWithIndex.collect { case ((List(prev, next), weight), i) =>
  //   val color = Color.fromWhite((i % 2 == 0) == startColor.white)
  //   val accuracy = AccuracyPercent.fromWinPercents(color.fold(prev, next), color.fold(next, prev)).value
  //   ((accuracy, weight), color)
  // }
  const weightedAccuracies: { accuracy: number; weight: number; color: 'w' | 'b' }[] = [];

  for (let i = 0; i + 1 < allWinPercents.length; i++) {
    const prev = allWinPercents[i];
    const next = allWinPercents[i + 1];
    const weight = weights[i];

    // Determine which color made this move
    // In Scala: Color.fromWhite((i % 2 == 0) == startColor.white)
    // If startColor is white: move 0 is white, move 1 is black, etc.
    // If startColor is black: move 0 is black, move 1 is white, etc.
    const isWhiteMove = (i % 2 === 0) === (startColor === 'w');
    const color: 'w' | 'b' = isWhiteMove ? 'w' : 'b';

    // Calculate accuracy with proper perspective
    // In Scala: fromWinPercents(color.fold(prev, next), color.fold(next, prev))
    // color.fold(ifWhite, ifBlack) means: if white, use first arg; if black, use second arg
    // For White: before = prev, after = next (white wants high win%)
    // For Black: before = next, after = prev (black wants low win%, so we invert)
    const winPercentBefore = isWhiteMove ? prev : next;
    const winPercentAfter = isWhiteMove ? next : prev;
    const accuracy = calculateMoveAccuracy(winPercentBefore, winPercentAfter);

    weightedAccuracies.push({ accuracy, weight, color });
  }

  // Calculate accuracy for a specific color (lila lines 105-112)
  const calculateForColor = (color: 'w' | 'b'): number | undefined => {
    const colorData = weightedAccuracies.filter(wa => wa.color === color);
    if (colorData.length === 0) return undefined;

    const colorAccuracies = colorData.map(wa => wa.accuracy);
    const colorWeights = colorData.map(wa => wa.weight);

    // Weighted mean (lila line 106-108)
    const wMean = weightedMean(colorAccuracies, colorWeights);

    // Harmonic mean (lila lines 109-111)
    const hMean = harmonicMean(colorAccuracies);

    // Average of both means (lila line 112)
    return Math.round((wMean + hMean) / 2);
  };

  // Performance optimization: only calculate requested color
  if (onlyColor) {
    return {
      white: onlyColor === 'w' ? calculateForColor('w') : undefined,
      black: onlyColor === 'b' ? calculateForColor('b') : undefined
    };
  }

  // Calculate both colors
  return {
    white: calculateForColor('w'),
    black: calculateForColor('b')
  };
}

/**
 * Calculate game-level accuracy using Lila's dual-weighted system.
 * Returns overall accuracy for all moves combined.
 *
 * This is the CORRECT implementation matching Lichess's algorithm.
 * It takes raw centipawn evaluations in White POV and calculates
 * per-move accuracy with proper perspective during aggregation.
 *
 * @param cpsWhitePov - Array of centipawn evaluations in White POV
 * @param startColor - Which color made the first move ('w' for standard games)
 * @param initialCp - Optional: centipawn eval of position before first move (default: 0 for starting position)
 * @returns Game-level accuracy (0-100), or undefined if insufficient data
 */
export function calculateGameAccuracyLila(
  cpsWhitePov: number[],
  startColor: 'w' | 'b' = 'w',
  initialCp: number = 0
): number | undefined {
  // Delegate to the by-color function and combine results
  const result = calculateGameAccuracyByColor(cpsWhitePov, startColor, undefined, initialCp);
  if (!result) return undefined;

  // Calculate overall as average of both colors (weighted by move count)
  const { standardDeviation, harmonicMean, weightedMean, clamp } = require('./math-utils.js');

  // Prepend initial position and convert to win percentages
  const allWinPercents = [cpToWinPercent(initialCp), ...cpsWhitePov.map(cp => cpToWinPercent(cp))];

  // Calculate all move accuracies (same logic as in calculateGameAccuracyByColor)
  const windowSize = clamp(Math.floor(cpsWhitePov.length / 10), 2, 8);

  const paddingCount = Math.max(0, Math.min(windowSize, allWinPercents.length) - 2);
  const firstWindow = allWinPercents.slice(0, Math.min(windowSize, allWinPercents.length));
  const paddedWindows: number[][] = Array(paddingCount).fill(firstWindow);

  const slidingWindows: number[][] = [];
  for (let i = 0; i + windowSize <= allWinPercents.length; i++) {
    slidingWindows.push(allWinPercents.slice(i, i + windowSize));
  }

  const windows = [...paddedWindows, ...slidingWindows];
  const weights = windows.map(window => clamp(standardDeviation(window), 0.5, 12));

  const allAccuracies: number[] = [];
  const allWeights: number[] = [];

  for (let i = 0; i + 1 < allWinPercents.length; i++) {
    const prev = allWinPercents[i];
    const next = allWinPercents[i + 1];
    const weight = weights[i];

    const isWhiteMove = (i % 2 === 0) === (startColor === 'w');
    const winPercentBefore = isWhiteMove ? prev : next;
    const winPercentAfter = isWhiteMove ? next : prev;
    const accuracy = calculateMoveAccuracy(winPercentBefore, winPercentAfter);

    allAccuracies.push(accuracy);
    allWeights.push(weight);
  }

  if (allAccuracies.length === 0) return undefined;

  const wMean = weightedMean(allAccuracies, allWeights);
  const hMean = harmonicMean(allAccuracies);

  return Math.round((wMean + hMean) / 2);
}
