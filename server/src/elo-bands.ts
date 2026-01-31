/**
 * ELO Band Configuration for Move Selection Algorithm
 *
 * Parameters are calibrated per ELO range to provide "human-like" move suggestions:
 * - nodesMain: Search depth for reference evaluation (higher ELO = more nodes)
 * - nodesCand: Quick evaluation nodes for candidate moves
 * - windowCp: Acceptance window in centipawns (lower ELO = wider window)
 * - tempCp: Temperature for weighted selection (lower ELO = more variance)
 * - cplThresholds: Move classification thresholds (ELO-dependent)
 */

export interface EloBand {
  nodesMain: number;
  nodesCand: number;
  windowCp: number;
  tempCp: number;
  cplThresholds: {
    inaccuracy: number;
    mistake: number;
    blunder: number;
  };
  // Quality bucket thresholds (lossCp from best move)
  qualityLossCp: {
    excellent: number;
    good: number;
    ok: number;
    inaccuracy: number;
  };
  // Target distribution for quality sampling (must sum to 1.0)
  qualityTargets: {
    excellent: number;
    good: number;
    ok: number;
    inaccuracy: number;
  };
}

export function getEloBand(elo: number): EloBand {
  // nodesMain: reference evaluation depth (optimized ~30% reduction)
  let nodesMain: number;
  if (elo < 800) nodesMain = 30_000;
  else if (elo < 1100) nodesMain = 75_000;
  else if (elo < 1400) nodesMain = 180_000;
  else if (elo < 1700) nodesMain = 450_000;
  else if (elo < 2000) nodesMain = 1_000_000;
  else nodesMain = 2_500_000;

  // nodesCand: quick eval for candidates = max(3000, floor(nodesMain/50))
  const nodesCand = Math.max(3_000, Math.floor(nodesMain / 50));

  // windowCp: acceptance window (centipawns)
  let windowCp: number;
  if (elo < 800) windowCp = 120;
  else if (elo < 1100) windowCp = 90;
  else if (elo < 1400) windowCp = 70;
  else if (elo < 1700) windowCp = 50;
  else if (elo < 2000) windowCp = 35;
  else windowCp = 20;

  // tempCp: temperature for weighted selection
  let tempCp: number;
  if (elo < 800) tempCp = 60;
  else if (elo < 1400) tempCp = 40;
  else if (elo < 2000) tempCp = 25;
  else tempCp = 15;

  // cplThresholds: move classification thresholds
  let cplThresholds: { inaccuracy: number; mistake: number; blunder: number };
  if (elo < 800)
    cplThresholds = { inaccuracy: 120, mistake: 250, blunder: 500 };
  else if (elo < 1100)
    cplThresholds = { inaccuracy: 90, mistake: 200, blunder: 400 };
  else if (elo < 1400)
    cplThresholds = { inaccuracy: 70, mistake: 150, blunder: 300 };
  else if (elo < 1700)
    cplThresholds = { inaccuracy: 50, mistake: 120, blunder: 250 };
  else if (elo < 2000)
    cplThresholds = { inaccuracy: 30, mistake: 90, blunder: 180 };
  else cplThresholds = { inaccuracy: 20, mistake: 60, blunder: 120 };

  // qualityLossCp: thresholds for move quality buckets (lossCp from best)
  let qualityLossCp: {
    excellent: number;
    good: number;
    ok: number;
    inaccuracy: number;
  };
  if (elo < 800)
    qualityLossCp = { excellent: 25, good: 60, ok: 110, inaccuracy: 200 };
  else if (elo < 1100)
    qualityLossCp = { excellent: 20, good: 50, ok: 90, inaccuracy: 160 };
  else if (elo < 1400)
    qualityLossCp = { excellent: 18, good: 40, ok: 75, inaccuracy: 130 };
  else if (elo < 1700)
    qualityLossCp = { excellent: 15, good: 35, ok: 65, inaccuracy: 110 };
  else if (elo < 2000)
    qualityLossCp = { excellent: 12, good: 30, ok: 55, inaccuracy: 95 };
  else qualityLossCp = { excellent: 10, good: 24, ok: 45, inaccuracy: 80 };

  // qualityTargets: target distribution for quality sampling (sum = 1.0)
  let qualityTargets: {
    excellent: number;
    good: number;
    ok: number;
    inaccuracy: number;
  };
  if (elo < 800)
    qualityTargets = { excellent: 0.08, good: 0.3, ok: 0.42, inaccuracy: 0.2 };
  else if (elo < 1100)
    qualityTargets = {
      excellent: 0.12,
      good: 0.35,
      ok: 0.38,
      inaccuracy: 0.15,
    };
  else if (elo < 1400)
    qualityTargets = {
      excellent: 0.16,
      good: 0.44,
      ok: 0.32,
      inaccuracy: 0.08,
    };
  else if (elo < 1700)
    qualityTargets = {
      excellent: 0.22,
      good: 0.48,
      ok: 0.26,
      inaccuracy: 0.04,
    };
  else if (elo < 2000)
    qualityTargets = { excellent: 0.26, good: 0.52, ok: 0.2, inaccuracy: 0.02 };
  else
    qualityTargets = {
      excellent: 0.32,
      good: 0.52,
      ok: 0.15,
      inaccuracy: 0.01,
    };

  return {
    nodesMain,
    nodesCand,
    windowCp,
    tempCp,
    cplThresholds,
    qualityLossCp,
    qualityTargets,
  };
}

/**
 * Convert centipawns to player perspective
 * @param evalCp - Evaluation in centipawns from engine (side-to-move perspective)
 * @param playerColor - The player's color ('w' or 'b')
 * @param sideToMove - The side to move in the analyzed position
 * @returns Evaluation from player's perspective (positive = good for player)
 */
export function toPlayerPov(
  evalCp: number,
  playerColor: "w" | "b",
  sideToMove: "w" | "b",
): number {
  return playerColor === sideToMove ? evalCp : -evalCp;
}
