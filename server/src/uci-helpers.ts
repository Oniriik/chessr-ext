/**
 * UCI Helper Functions
 *
 * Utilities for parsing UCI protocol messages and normalizing chess engine evaluations.
 * All scores are normalized to White's perspective (POV) for consistent comparison.
 */

import { EngineScore, PVLine, Side } from './analyze-types.js';

// ============================================================================
// UCI Protocol Parsing
// ============================================================================

/**
 * Parse a UCI info line into structured data.
 *
 * Example input:
 *   "info depth 18 seldepth 28 multipv 1 score cp 34 pv e2e4 e7e5 g1f3"
 *
 * Returns null if line doesn't contain a valid score.
 */
export function parseInfoLine(line: string): PVLine | null {
  if (!line.startsWith('info ') || !line.includes('score')) {
    return null;
  }

  const tokens = line.trim().split(/\s+/);
  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let scoreType: 'cp' | 'mate' | null = null;
  let scoreValue: number | null = null;
  let pv: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === 'depth') {
      depth = Number(tokens[++i]);
    } else if (token === 'seldepth') {
      seldepth = Number(tokens[++i]);
    } else if (token === 'multipv') {
      multipv = Number(tokens[++i]);
    } else if (token === 'score') {
      const st = tokens[++i] as 'cp' | 'mate';
      const sv = Number(tokens[++i]);
      if (st === 'cp' || st === 'mate') {
        scoreType = st;
        scoreValue = sv;
      }
    } else if (token === 'pv') {
      // Rest of tokens are PV moves
      pv = tokens.slice(i + 1);
      break;
    }
  }

  if (!scoreType || scoreValue === null) {
    return null;
  }

  return {
    multipv,
    depth,
    seldepth,
    score: { type: scoreType, value: scoreValue },
    pv,
  };
}

/**
 * Pick the best scoring line from multiple info lines with the same multipv index.
 * Selects the line with maximum depth.
 */
export function pickBestScoreFromInfos(infos: PVLine[], multipvIndex: number = 1): PVLine | null {
  const lines = infos.filter((x) => x.multipv === multipvIndex && x.score);
  if (!lines.length) return null;

  // Sort by depth descending, take first
  return lines.sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))[0];
}

// ============================================================================
// Score Normalization
// ============================================================================

/**
 * Invert a score (flip sign).
 * Used to convert between White POV and Black POV.
 */
export function invertScore(score: { type: 'cp' | 'mate'; value: number }): {
  type: 'cp' | 'mate';
  value: number;
} {
  return { ...score, value: -score.value };
}

/**
 * Normalize engine score to White's perspective.
 *
 * Engines typically return scores from the side-to-move's perspective.
 * This function converts all scores to White POV for consistent comparison.
 *
 * @param scoreRaw - Raw score from engine
 * @param sideToMove - Side to move in the position being evaluated
 * @returns Score normalized to White POV with explicit pov field
 */
export function toWhitePOV(
  scoreRaw: { type: 'cp' | 'mate'; value: number },
  sideToMove: Side
): EngineScore {
  const normalized = sideToMove === 'w' ? scoreRaw : invertScore(scoreRaw);
  return {
    type: normalized.type,
    value: normalized.value,
    pov: 'white',
  };
}

/**
 * Calculate which side is to move at a given ply index.
 * Assumes standard starting position (White moves first).
 *
 * @param plyIndex - Ply index (0-based, where 0 = initial position)
 * @returns 'w' if White to move, 'b' if Black to move
 */
export function sideToMoveAtPly(plyIndex: number): Side {
  return plyIndex % 2 === 0 ? 'w' : 'b';
}

// ============================================================================
// Loss Calculation
// ============================================================================

/**
 * Calculate centipawn loss for a player who just played a move.
 *
 * Loss is measured as the difference between the best possible eval
 * and the actual eval after the played move, from the player's perspective.
 *
 * @param sidePlayed - Side that played the move ('w' or 'b')
 * @param bestAfterWhiteCp - Best eval if best move played (White POV, in cp)
 * @param playedAfterWhiteCp - Eval after actual move played (White POV, in cp)
 * @returns Centipawn loss (≥0)
 */
export function lossCpForPlayer(
  sidePlayed: Side,
  bestAfterWhiteCp: number,
  playedAfterWhiteCp: number
): number {
  // For White: loss = drop in evaluation (best - played)
  // For Black: loss = increase in evaluation (played - best), since higher is worse for Black
  if (sidePlayed === 'w') {
    return Math.max(0, bestAfterWhiteCp - playedAfterWhiteCp);
  } else {
    return Math.max(0, playedAfterWhiteCp - bestAfterWhiteCp);
  }
}

// ============================================================================
// Win Percentage Conversion (Chess.com style)
// ============================================================================

/**
 * Convert centipawn score to win percentage using sigmoid function.
 *
 * @param cpWhite - Centipawn score from White's POV
 * @returns Win percentage (0-100) for White
 */
export function cpToWinPercent(cpWhite: number): number {
  const k = 0.004; // Sensitivity factor (tune if needed)
  const x = -k * cpWhite;
  const win = 1 / (1 + Math.exp(x)); // Sigmoid: 0..1 from White POV
  return win * 100; // Convert to 0..100
}

/**
 * Convert engine score to win percentage.
 * Handles both cp and mate scores.
 *
 * @param score - Engine score (normalized to White POV)
 * @returns Win percentage (0-100) for White, or null if cannot convert
 */
export function scoreToWinPercent(score: EngineScore): number | null {
  if (score.type === 'mate') {
    // Treat mate as near-certain win/loss
    // mate > 0 => White wins, mate < 0 => Black wins
    return score.value > 0 ? 99.9 : 0.1;
  }
  return cpToWinPercent(score.value);
}

/**
 * Calculate win percentage loss for a player who just played a move.
 *
 * @param sidePlayed - Side that played the move
 * @param bestScore - Best score before the move (White POV)
 * @param playedAfterScore - Score after the played move (White POV)
 * @returns Win percentage loss (always >= 0)
 */
export function lossWinForPlayer(
  sidePlayed: Side,
  bestScore: EngineScore,
  playedAfterScore: EngineScore
): number {
  const wBest = scoreToWinPercent(bestScore);
  const wPlayed = scoreToWinPercent(playedAfterScore);

  if (wBest === null || wPlayed === null) return 0;

  // For White: loss = wBest - wPlayed
  // For Black: loss = (100-wBest) - (100-wPlayed) = wPlayed - wBest
  const loss = sidePlayed === 'w' ? (wBest - wPlayed) : (wPlayed - wBest);
  return Math.max(0, loss);
}

/**
 * Calculate win percentage gap between best and second best move.
 *
 * @param sidePlayed - Side that played the move
 * @param bestScore - Best move score (White POV)
 * @param secondScore - Second best move score (White POV)
 * @returns Win percentage gap (always >= 0), or 0 if no second move
 */
export function gapWinForPlayer(
  sidePlayed: Side,
  bestScore: EngineScore,
  secondScore: EngineScore | undefined
): number {
  if (!secondScore) return 0;

  const wBest = scoreToWinPercent(bestScore);
  const wSecond = scoreToWinPercent(secondScore);

  if (wBest === null || wSecond === null) return 0;

  // Gap is how much better best is than second
  const gap = sidePlayed === 'w' ? (wBest - wSecond) : (wSecond - wBest);
  return Math.max(0, gap);
}

/**
 * Calculate swing (turning point magnitude).
 * Positive swing = position improved for the player.
 *
 * @param sidePlayed - Side that played the move
 * @param beforeScore - Score before the move (White POV)
 * @param afterScore - Score after the move (White POV)
 * @returns Swing in win percentage
 */
export function swingWinForPlayer(
  sidePlayed: Side,
  beforeScore: EngineScore,
  afterScore: EngineScore
): number {
  const before = scoreToWinPercent(beforeScore);
  const after = scoreToWinPercent(afterScore);

  if (before === null || after === null) return 0;

  // Swing for sidePlayed: positive = improvement
  const swing = sidePlayed === 'w' ? (after - before) : ((100 - after) - (100 - before));
  return swing;
}

// ============================================================================
// Advanced Move Classification
// ============================================================================

type MoveLabel = 'Brilliant' | 'Great' | 'Best' | 'Excellent' | 'Good' | 'Book' | 'Inaccuracy' | 'Mistake' | 'Blunder';

/**
 * Get base classification label from win percentage loss.
 *
 * Thresholds (Chess.com style):
 * - Best: 0-0.2% loss
 * - Excellent: 0.2-1% loss
 * - Good: 1-3% loss
 * - Inaccuracy: 3-8% loss
 * - Mistake: 8-20% loss
 * - Blunder: >20% loss
 */
export function baseLabelFromLossWin(lossWin: number, playedIsBest: boolean): MoveLabel {
  if (playedIsBest || lossWin <= 0.2) return 'Best';
  if (lossWin <= 1.0) return 'Excellent';
  if (lossWin <= 3.0) return 'Good';
  if (lossWin <= 8.0) return 'Inaccuracy';
  if (lossWin <= 20.0) return 'Mistake';
  return 'Blunder';
}

/**
 * Classify a move based on centipawn loss (fallback when win% not available).
 *
 * @deprecated Use baseLabelFromLossWin with win% for better accuracy
 */
export function classifyByCpLoss(lossCp: number): MoveLabel {
  if (lossCp <= 10) return 'Best';
  if (lossCp <= 30) return 'Excellent';
  if (lossCp <= 80) return 'Good';
  if (lossCp <= 180) return 'Inaccuracy';
  if (lossCp <= 400) return 'Mistake';
  return 'Blunder';
}

/**
 * Calculate accuracy score (0-100) from centipawn loss.
 *
 * Uses simple linear scaling: accuracy = 100 - (lossCp / K)
 * K = 10 means 10cp loss = -1 accuracy point
 *
 * @param lossCp - Centipawn loss
 * @returns Accuracy score (0-100)
 */
export function accuracyFromCpLoss(lossCp: number): number {
  const K = 10; // Calibration factor
  return clamp(100 - lossCp / K, 0, 100);
}

// ============================================================================
// ELO Mapping Helpers
// ============================================================================

/**
 * Map user's ELO to appropriate hash table size.
 * Lower ELO = smaller hash (more "human-like" play).
 */
export function computeHashForElo(elo: number): number {
  if (elo <= 800) return 32;
  if (elo <= 1800) return 64;
  return 128;
}

/**
 * Map user's ELO to appropriate search time (ms).
 * Lower ELO = less search time.
 */
export function computeMovetimeForElo(elo: number): number {
  if (elo <= 800) return 60;
  if (elo <= 1200) return 100;
  if (elo <= 1600) return 150;
  if (elo <= 2000) return 220;
  return 320;
}

/**
 * Get blunder risk thresholds (in cp) based on ELO.
 * Lower ELO has higher tolerance (larger thresholds).
 */
export function blunderRiskThresholds(elo: number): { low: number; medium: number } {
  if (elo <= 800) return { low: 80, medium: 200 };
  if (elo <= 1600) return { low: 60, medium: 150 };
  return { low: 40, medium: 120 };
}

/**
 * Compute blunder risk category based on eval drop vs best candidate.
 *
 * @param dropCp - Centipawn drop compared to best move
 * @param elo - User's target ELO
 * @returns Risk category
 */
export function computeBlunderRisk(dropCp: number, elo: number): 'low' | 'medium' | 'high' {
  const { low, medium } = blunderRiskThresholds(elo);
  if (dropCp < low) return 'low';
  if (dropCp < medium) return 'medium';
  return 'high';
}

// ============================================================================
// Move Detail Helpers
// ============================================================================

/**
 * Check if a UCI move is a promotion.
 * Promotions are 5 characters: e.g., "e7e8q"
 */
export function isPromotionMove(move: string): {
  isPromotion: boolean;
  piece?: 'q' | 'r' | 'b' | 'n';
} {
  if (move.length === 5) {
    const piece = move[4] as any;
    if (piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n') {
      return { isPromotion: true, piece };
    }
  }
  return { isPromotion: false };
}

/**
 * Check if a score represents a winning mate for the side to move.
 *
 * @param scoreWhite - Score normalized to White POV
 * @param sideToMove - Side to move in this position
 * @returns True if sideToMove has a winning mate
 */
export function isWinningMateWhitePOV(scoreWhite: EngineScore, sideToMove: Side): boolean {
  if (scoreWhite.type !== 'mate') return false;

  // Positive mate value = White wins, negative = Black wins
  if (sideToMove === 'w') {
    return scoreWhite.value > 0;
  } else {
    return scoreWhite.value < 0;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clamp a number between min and max bounds.
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Round a number to specified decimal places.
 */
export function round(n: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// ============================================================================
// Material Calculation (for sacrifice detection)
// ============================================================================

const PIECE_VALUE: Record<string, number> = {
  p: 1,  // Pawn
  n: 3,  // Knight
  b: 3,  // Bishop
  r: 5,  // Rook
  q: 9,  // Queen
  k: 0,  // King
};

/**
 * Calculate total material value for a specific color.
 *
 * @param chess - Chess.js instance
 * @param color - Color to calculate material for
 * @returns Total material value
 */
export function materialScoreForColor(chess: any, color: 'w' | 'b'): number {
  const board = chess.board(); // 8x8 array
  let sum = 0;

  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.color === color) {
        sum += PIECE_VALUE[piece.type] ?? 0;
      }
    }
  }

  return sum;
}

/**
 * Compute material delta for a side after playing a move.
 * Negative value indicates sacrifice (gave material).
 *
 * @param fenBefore - FEN before the move
 * @param uciMove - Move in UCI format (e.g., "e2e4" or "e7e8q")
 * @param sidePlayed - Side that played the move
 * @returns Material delta (negative = sacrifice), or null if move invalid
 */
export function computeMaterialDelta(
  Chess: any,
  fenBefore: string,
  uciMove: string,
  sidePlayed: Side
): number | null {
  try {
    const chess = new Chess(fenBefore);
    const before = materialScoreForColor(chess, sidePlayed);

    const from = uciMove.slice(0, 2);
    const to = uciMove.slice(2, 4);
    const promotion = uciMove.length === 5 ? (uciMove[4] as any) : undefined;

    const move = chess.move(promotion ? { from, to, promotion } : { from, to });
    if (!move) return null;

    const after = materialScoreForColor(chess, sidePlayed);
    return after - before;
  } catch {
    return null;
  }
}
