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
// Calibrated to match real chess.com accuracy levels
// Real 1400 player: ~75-80% accuracy, real 1800: ~85% accuracy
const ELO_CONFIGS: { maxElo: number; config: MoveSelectionConfig }[] = [
  {
    maxElo: 400,
    config: {
      // Beginner - very chaotic, often picks terrible moves
      weights: [0.08, 0.12, 0.16, 0.18, 0.16, 0.14, 0.10, 0.06],
      maxEvalLoss: 6.0,
    },
  },
  {
    maxElo: 600,
    config: {
      // Novice - still very inconsistent
      weights: [0.10, 0.14, 0.18, 0.18, 0.16, 0.12, 0.08, 0.04],
      maxEvalLoss: 5.0,
    },
  },
  {
    maxElo: 800,
    config: {
      // Casual - frequent mistakes
      weights: [0.14, 0.18, 0.22, 0.18, 0.14, 0.10, 0.04],
      maxEvalLoss: 4.0,
    },
  },
  {
    maxElo: 1000,
    config: {
      // Beginner club - regular mistakes
      weights: [0.18, 0.22, 0.22, 0.18, 0.12, 0.08],
      maxEvalLoss: 3.5,
    },
  },
  {
    maxElo: 1200,
    config: {
      // Club player - common inaccuracies
      weights: [0.24, 0.24, 0.20, 0.16, 0.10, 0.06],
      maxEvalLoss: 3.0,
    },
  },
  {
    maxElo: 1400,
    config: {
      // Intermediate - ~70-75% accuracy target
      weights: [0.30, 0.26, 0.20, 0.14, 0.07, 0.03],
      maxEvalLoss: 2.5,
    },
  },
  {
    maxElo: 1600,
    config: {
      // Advanced club - ~73-78% accuracy target
      weights: [0.35, 0.26, 0.18, 0.13, 0.08],
      maxEvalLoss: 2.5,
    },
  },
  {
    maxElo: 1800,
    config: {
      // Strong club - ~78-82% accuracy target
      weights: [0.45, 0.25, 0.15, 0.10, 0.05],
      maxEvalLoss: 2.0,
    },
  },
  {
    maxElo: 2000,
    config: {
      // Expert - ~83-87% accuracy target
      weights: [0.60, 0.22, 0.10, 0.05, 0.03],
      maxEvalLoss: 1.2,
    },
  },
  {
    maxElo: 2200,
    config: {
      // Master - ~87-90% accuracy target
      weights: [0.70, 0.18, 0.08, 0.04],
      maxEvalLoss: 0.8,
    },
  },
  {
    maxElo: 2400,
    config: {
      // IM level - ~90-93% accuracy target
      weights: [0.78, 0.14, 0.05, 0.03],
      maxEvalLoss: 0.5,
    },
  },
  {
    maxElo: 2600,
    config: {
      // GM level - ~93-95% accuracy target
      weights: [0.85, 0.10, 0.03, 0.02],
      maxEvalLoss: 0.35,
    },
  },
  {
    maxElo: Infinity,
    config: {
      // Super GM / Engine - ~95%+ accuracy
      weights: [0.92, 0.05, 0.02, 0.01],
      maxEvalLoss: 0.25,
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
 * @param lines - Array of PV lines from engine (sorted by quality, best first)
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

  // Detect "brilliant" moves - eval advantage that lower ELOs would miss
  // If best move is significantly better than 2nd best, lower ELOs should miss it more often
  const evalGap = lines.length > 1 ? Math.abs(bestEval - lines[1].evaluation) : 0;
  const isBrilliantMove = evalGap > 1.0 && !lines[0].mate; // >1.0 pawn advantage = tactical shot

  // Lower ELOs miss brilliant/tactical moves very often
  if (isBrilliantMove && elo < 2200) {
    const missBrilliantChance =
      elo < 1000 ? 0.97 :
      elo < 1200 ? 0.94 :
      elo < 1400 ? 0.90 :
      elo < 1600 ? 0.85 :
      elo < 1800 ? 0.60 :
      elo < 2000 ? 0.45 :
      0.25;

    if (Math.random() < missBrilliantChance) {
      // Skip the brilliant move, pick from remaining lines
      const remainingLines = lines.slice(1);
      if (remainingLines.length > 0) {
        const subSelection = selectMoveByElo(remainingLines, elo + 200);
        return {
          selectedIndex: subSelection.selectedIndex + 1,
          isMistake: true,
        };
      }
    }
  }

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
 * Occasionally inject a "blunder" at lower ELOs
 * This makes the engine hang pieces or miss obvious tactics
 */
export function shouldBlunder(elo: number): boolean {
  if (elo > 1400) return false;

  // Blunder probability based on ELO - extended to 1400
  if (elo <= 400) return Math.random() < 0.20;
  if (elo <= 600) return Math.random() < 0.15;
  if (elo <= 800) return Math.random() < 0.10;
  if (elo <= 1000) return Math.random() < 0.06;
  if (elo <= 1200) return Math.random() < 0.04;
  if (elo <= 1400) return Math.random() < 0.02;
  return false;
}

/**
 * Get the recommended number of lines (MultiPV) based on ELO
 * Lower ELOs need more lines for move selection variety
 */
export function getMultiPVForElo(elo: number): number {
  if (elo <= 600) return 8;
  if (elo <= 1000) return 6;
  if (elo <= 1400) return 6;
  if (elo <= 1800) return 5;
  return 4;
}
