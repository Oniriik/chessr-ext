/**
 * moveAnalysis — Pure functions for move classification and accuracy scoring.
 * Ported from serveur/src/handlers/analysisHandler.ts (Chess.com calibrated).
 */

import type { AnalysisResult } from './analysisEngine';

/** Structural interface: both the WASM AnalysisEngine and the
 *  ServerAnalysisEngine fallback implement this subset. */
export interface AnalysisBackend {
  analyze(fen: string): Promise<AnalysisResult>;
}

export type MoveClassification = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveAnalysisResult {
  classification: MoveClassification;
  caps2: number;
  diff: number;
  wpDiff: number;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
}

/**
 * Win probability using Chess.com's calibrated sigmoid.
 * Input: eval in pawns. Output: 0-100%.
 */
export function winProb(evalPawns: number): number {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Classify move based on win probability % loss.
 * Thresholds match Chess.com's Expected Points model.
 */
export function classifyMove(bestEval: number, afterEval: number): MoveClassification {
  const wpBefore = winProb(bestEval);
  const wpAfter = winProb(afterEval);
  const wpDiff = Math.max(0, wpBefore - wpAfter);
  if (wpDiff <= 0.001) return 'best';
  if (wpDiff <= 2) return 'excellent';
  if (wpDiff <= 5) return 'good';
  if (wpDiff <= 10) return 'inaccuracy';
  if (wpDiff <= 20) return 'mistake';
  return 'blunder';
}

/**
 * CAPS2 score calibrated to Chess.com via regression.
 * Input: pawn diff (>= 0), absolute eval before move.
 * Output: 0-100.
 */
export function computeCAPS2(diff: number, absEval: number): number {
  if (diff <= 0) return 100;
  const raw = 100 * (1 - 0.50 * Math.pow(diff, 0.95) * (1 + 0.005 * Math.pow(absEval, 2.25)));
  return Math.max(0, Math.min(100, raw));
}

/**
 * Analyze the player's last move by running two engine searches.
 *
 * Evaluation perspective:
 *  - Stockfish UCI outputs from side-to-move perspective.
 *  - fenBefore: player to move → eval is already player POV.
 *  - fenAfter: opponent to move → must negate for player POV.
 */
export async function analyzeLastMove(
  fenBefore: string,
  fenAfter: string,
  engine: AnalysisBackend,
): Promise<MoveAnalysisResult> {
  const before = await engine.analyze(fenBefore);
  const bestEvalPlayerPov = before.evaluation / 100;

  const after = await engine.analyze(fenAfter);
  const evalAfterPlayerPov = -after.evaluation / 100;

  const diff = Math.max(0, bestEvalPlayerPov - evalAfterPlayerPov);
  const wpDiff = Math.max(0, winProb(bestEvalPlayerPov) - winProb(evalAfterPlayerPov));
  const absEval = Math.abs(bestEvalPlayerPov);
  const caps2 = computeCAPS2(diff, absEval);
  const classification = classifyMove(bestEvalPlayerPov, evalAfterPlayerPov);

  return {
    classification,
    caps2: Math.round(caps2 * 10) / 10,
    diff: Math.round(diff * 100) / 100,
    wpDiff: Math.round(wpDiff * 100) / 100,
    evalBefore: Math.round(bestEvalPlayerPov * 100) / 100,
    evalAfter: Math.round(evalAfterPlayerPov * 100) / 100,
    bestMove: before.bestMove,
  };
}
