/**
 * ELO-based weighted move selection
 * Makes the engine play more "human-like" by sometimes choosing suboptimal moves
 */

import { PVLine } from './types.js';

interface MoveSelectionConfig {
  // Probability distribution for selecting moves (must sum to 1)
  weights: number[];
  // Maximum evaluation loss to consider a move (in pawns)
  maxEvalLoss: number;
}

// Configuration based on ELO ranges
// Low ELOs use more lines (up to 8) for more variety in mistakes
// Even high ELOs have some chance of inaccuracies for realism
const ELO_CONFIGS: { maxElo: number; config: MoveSelectionConfig }[] = [
  {
    maxElo: 400,
    config: {
      // 8 lines - very chaotic play, often picks bad moves
      weights: [0.15, 0.18, 0.18, 0.16, 0.14, 0.10, 0.06, 0.03],
      maxEvalLoss: 5.0, // Can lose up to 5 pawns
    },
  },
  {
    maxElo: 600,
    config: {
      // 8 lines - still very inconsistent
      weights: [0.20, 0.20, 0.18, 0.15, 0.12, 0.08, 0.05, 0.02],
      maxEvalLoss: 4.0,
    },
  },
  {
    maxElo: 800,
    config: {
      // 6 lines - frequent mistakes
      weights: [0.28, 0.25, 0.20, 0.14, 0.08, 0.05],
      maxEvalLoss: 3.0,
    },
  },
  {
    maxElo: 1000,
    config: {
      // 5 lines - regular mistakes
      weights: [0.38, 0.26, 0.18, 0.12, 0.06],
      maxEvalLoss: 2.5,
    },
  },
  {
    maxElo: 1200,
    config: {
      // 5 lines - occasional mistakes
      weights: [0.48, 0.25, 0.14, 0.09, 0.04],
      maxEvalLoss: 2.0,
    },
  },
  {
    maxElo: 1500,
    config: {
      // 4 lines - some inaccuracies
      weights: [0.58, 0.24, 0.12, 0.06],
      maxEvalLoss: 1.5,
    },
  },
  {
    maxElo: 1800,
    config: {
      weights: [0.70, 0.18, 0.08, 0.04],
      maxEvalLoss: 1.0,
    },
  },
  {
    maxElo: 2000,
    config: {
      weights: [0.78, 0.14, 0.06, 0.02],
      maxEvalLoss: 0.7,
    },
  },
  {
    maxElo: 2200,
    config: {
      weights: [0.85, 0.10, 0.04, 0.01],
      maxEvalLoss: 0.5,
    },
  },
  {
    maxElo: 2500,
    config: {
      // Super GM - still occasionally inaccurate
      weights: [0.90, 0.07, 0.02, 0.01],
      maxEvalLoss: 0.35,
    },
  },
  {
    maxElo: Infinity,
    config: {
      // Engine level - rare mistakes
      weights: [0.94, 0.04, 0.015, 0.005],
      maxEvalLoss: 0.2,
    },
  },
];

function getConfigForElo(elo: number): MoveSelectionConfig {
  for (const { maxElo, config } of ELO_CONFIGS) {
    if (elo <= maxElo) {
      return config;
    }
  }
  return ELO_CONFIGS[ELO_CONFIGS.length - 1].config;
}

/**
 * Select a move from the available lines based on ELO
 * @param lines - Array of PV lines from Stockfish (sorted by quality, best first)
 * @param elo - Target ELO level
 * @returns Selected line index and whether it was a "mistake"
 */
export function selectMoveByElo(
  lines: PVLine[],
  elo: number
): { selectedIndex: number; isMistake: boolean } {
  if (lines.length === 0) {
    return { selectedIndex: 0, isMistake: false };
  }

  // Always play best move if only one option
  if (lines.length === 1) {
    return { selectedIndex: 0, isMistake: false };
  }

  const config = getConfigForElo(elo);
  const bestEval = lines[0].evaluation;

  // Filter lines that are within acceptable evaluation loss
  const acceptableLines: number[] = [];
  for (let i = 0; i < lines.length && i < config.weights.length; i++) {
    const line = lines[i];
    const evalLoss = Math.abs(bestEval - line.evaluation);

    // Don't play moves that lose too much evaluation
    // But always include at least the best move
    if (i === 0 || evalLoss <= config.maxEvalLoss) {
      acceptableLines.push(i);
    }
  }

  // If no acceptable alternatives, play best move
  if (acceptableLines.length <= 1) {
    return { selectedIndex: 0, isMistake: false };
  }

  // Calculate adjusted weights for acceptable moves
  const adjustedWeights: number[] = [];
  let totalWeight = 0;

  for (const idx of acceptableLines) {
    const weight = config.weights[idx] || 0;
    adjustedWeights.push(weight);
    totalWeight += weight;
  }

  // Normalize weights
  if (totalWeight > 0) {
    for (let i = 0; i < adjustedWeights.length; i++) {
      adjustedWeights[i] /= totalWeight;
    }
  }

  // Random selection based on weights
  const random = Math.random();
  let cumulative = 0;

  for (let i = 0; i < adjustedWeights.length; i++) {
    cumulative += adjustedWeights[i];
    if (random <= cumulative) {
      const selectedIndex = acceptableLines[i];
      return {
        selectedIndex,
        isMistake: selectedIndex > 0,
      };
    }
  }

  // Fallback to best move
  return { selectedIndex: 0, isMistake: false };
}

/**
 * Occasionally inject a "blunder" at very low ELOs
 * This makes the engine hang pieces or miss obvious tactics
 */
export function shouldBlunder(elo: number): boolean {
  if (elo > 800) return false;

  // Blunder probability based on ELO
  const blunderChance = elo <= 400 ? 0.18 : elo <= 600 ? 0.10 : 0.04;
  return Math.random() < blunderChance;
}

/**
 * Get the recommended number of lines (MultiPV) based on ELO
 * All ELOs need multiple lines for move selection variety
 */
export function getMultiPVForElo(elo: number): number {
  if (elo <= 600) return 8;
  if (elo <= 1000) return 6;
  if (elo <= 1200) return 5;
  return 4; // Even GMs use 4 lines for occasional inaccuracies
}
