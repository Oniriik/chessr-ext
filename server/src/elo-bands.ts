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
}

export function getEloBand(elo: number): EloBand {
  // nodesMain: reference evaluation depth
  let nodesMain: number;
  if (elo < 800) nodesMain = 45_000;
  else if (elo < 1100) nodesMain = 110_000;
  else if (elo < 1400) nodesMain = 275_000;
  else if (elo < 1700) nodesMain = 700_000;
  else if (elo < 2000) nodesMain = 1_500_000;
  else nodesMain = 4_000_000;

  // nodesCand: quick eval for candidates = max(5000, floor(nodesMain/40))
  const nodesCand = Math.max(5_000, Math.floor(nodesMain / 40));

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
  if (elo < 800) cplThresholds = { inaccuracy: 120, mistake: 250, blunder: 500 };
  else if (elo < 1100) cplThresholds = { inaccuracy: 90, mistake: 200, blunder: 400 };
  else if (elo < 1400) cplThresholds = { inaccuracy: 70, mistake: 150, blunder: 300 };
  else if (elo < 1700) cplThresholds = { inaccuracy: 50, mistake: 120, blunder: 250 };
  else if (elo < 2000) cplThresholds = { inaccuracy: 30, mistake: 90, blunder: 180 };
  else cplThresholds = { inaccuracy: 20, mistake: 60, blunder: 120 };

  return { nodesMain, nodesCand, windowCp, tempCp, cplThresholds };
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
  playerColor: 'w' | 'b',
  sideToMove: 'w' | 'b'
): number {
  return playerColor === sideToMove ? evalCp : -evalCp;
}

/**
 * Convert mate score to centipawns equivalent
 * @param mate - Moves to mate (positive = winning, negative = losing)
 * @returns Centipawn equivalent
 */
export function mateToCp(mate: number): number {
  return Math.sign(mate) * (100000 - Math.abs(mate) * 1000);
}
