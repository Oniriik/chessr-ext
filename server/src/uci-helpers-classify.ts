/**
 * Advanced move classification with Brilliant/Great upgrades.
 *
 * This module implements Chess.com-style move classification with:
 * - Base classification by win% loss
 * - Great upgrade for turning points or unique moves
 * - Brilliant upgrade for correct sacrifices
 */

import { Side, EngineScore } from './analyze-types.js';
import {
  scoreToWinPercent,
  lossWinForPlayer,
  gapWinForPlayer,
  swingWinForPlayer,
  baseLabelFromLossWin,
  isWinningMateWhitePOV,
} from './uci-helpers.js';

export type MoveLabel = 'Brilliant' | 'Great' | 'Best' | 'Excellent' | 'Good' | 'Book' | 'Inaccuracy' | 'Mistake' | 'Blunder';

export interface MoveContext {
  plyIndex: number;
  sidePlayed: Side;              // Side that played this move
  playedMove: string;
  bestMove: string;

  // Full strength evaluations (White POV)
  beforeBest: EngineScore;       // Best move eval BEFORE (from multipv1)
  beforeSecond?: EngineScore;    // Second best eval BEFORE (from multipv2)
  afterPlayed: EngineScore;      // Eval AFTER played move (full strength)

  // Optional book flag
  isBook?: boolean;

  // Computed material delta (negative = sacrifice)
  materialDelta?: number;
}

export interface ClassificationResult {
  label: MoveLabel;
  details: {
    lossWin: number;
    gapWin: number;
    swingWin: number;
    playedIsBest: boolean;
    materialDelta?: number;
  };
}

/**
 * Classify a move using Chess.com-style advanced classification.
 *
 * Classification flow:
 * 1. Check for mate overrides (missed mate = Blunder)
 * 2. Get base label from win% loss
 * 3. Override with Book if applicable
 * 4. Upgrade to Great if turning point or unique move
 * 5. Upgrade to Brilliant if sacrifice + winning
 */
export function classifyMove(ctx: MoveContext): ClassificationResult {
  const playedIsBest = ctx.playedMove === ctx.bestMove;

  // ============================================================================
  // Priority 1: Mate overrides (missed mate = Blunder)
  // ============================================================================

  if (ctx.beforeBest.type === 'mate') {
    const bestMateForSide =
      (ctx.beforeBest.value > 0 && ctx.sidePlayed === 'w') ||
      (ctx.beforeBest.value < 0 && ctx.sidePlayed === 'b');

    const playedMateForSide =
      (ctx.afterPlayed.type === 'mate') &&
      ((ctx.afterPlayed.value > 0 && ctx.sidePlayed === 'w') ||
       (ctx.afterPlayed.value < 0 && ctx.sidePlayed === 'b'));

    if (bestMateForSide && !playedMateForSide) {
      return {
        label: 'Blunder',
        details: {
          lossWin: 100,
          gapWin: 0,
          swingWin: 0,
          playedIsBest: false,
          materialDelta: ctx.materialDelta,
        },
      };
    }
  }

  // ============================================================================
  // Calculate metrics
  // ============================================================================

  const lossWin = lossWinForPlayer(ctx.sidePlayed, ctx.beforeBest, ctx.afterPlayed);
  const gapWin = gapWinForPlayer(ctx.sidePlayed, ctx.beforeBest, ctx.beforeSecond);
  const swingWin = swingWinForPlayer(ctx.sidePlayed, ctx.beforeBest, ctx.afterPlayed);

  // ============================================================================
  // Base classification by win% loss
  // ============================================================================

  let label = baseLabelFromLossWin(lossWin, playedIsBest);

  // ============================================================================
  // Priority 2: Book override (if not error)
  // ============================================================================

  if (ctx.isBook && label !== 'Blunder' && label !== 'Mistake') {
    label = 'Book';
  }

  // ============================================================================
  // Upgrade 1: Great (turning point OR unique move)
  // ============================================================================

  // Great conditions:
  // - Base label must be Best or Excellent (very good move)
  // - AND either:
  //   - Turning point: swing >= 15%
  //   - Unique move: gap >= 8% (much better than second best)

  if ((label === 'Best' || label === 'Excellent') && (swingWin >= 15 || gapWin >= 8)) {
    label = 'Great';
  }

  // ============================================================================
  // Upgrade 2: Brilliant (correct sacrifice)
  // ============================================================================

  // Brilliant conditions:
  // - Base label must be Best (optimal move)
  // - Sacrifice: materialDelta < 0 (gave material)
  // - Still winning: afterWin >= 60% for the player
  // - Non-trivial: gap >= 6% (not obvious)

  const matDelta = ctx.materialDelta ?? 0;
  const afterWin = scoreToWinPercent(ctx.afterPlayed) ?? 50;

  // Check if still winning for the player
  const isStillGood = ctx.sidePlayed === 'w' ? afterWin >= 60 : (100 - afterWin) >= 60;

  if (label === 'Best' && matDelta < 0 && isStillGood && gapWin >= 6) {
    label = 'Brilliant';
  }

  // ============================================================================
  // Return result
  // ============================================================================

  return {
    label,
    details: {
      lossWin: Math.round(lossWin * 100) / 100, // Round to 2 decimals
      gapWin: Math.round(gapWin * 100) / 100,
      swingWin: Math.round(swingWin * 100) / 100,
      playedIsBest,
      materialDelta: matDelta,
    },
  };
}
