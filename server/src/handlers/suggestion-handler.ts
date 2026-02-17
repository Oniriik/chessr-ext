/**
 * Suggestion Handler (New Architecture)
 *
 * Handles the new `suggestion` message type.
 * Uses FEN directly instead of replaying all moves.
 * Single independent request (not dependent on stats).
 */

import { Chess } from 'chess.js';
import { ChessEngine } from '../engine.js';
import { Logger } from '../logger.js';
import { SuggestionMove, EngineScore, Side } from '../analyze-types.js';
import type { Personality } from '../types.js';
import {
  toWhitePOV,
  computeMovetimeForElo,
  computeBlunderRisk,
  isPromotionMove,
  isWinningMateWhitePOV,
  clamp,
} from '../uci-helpers.js';
import { cpToWinPercent } from '../stats-calculator.js';

// ============================================================================
// Types
// ============================================================================

export interface SuggestionRequest {
  type: 'suggestion';
  requestId: string;
  fen: string;
  moves: string[];
  targetElo: number;
  personality: Personality;
  multiPv: number;
  contempt: number; // 0-100 (riskTaking)
}

export interface SuggestionResult {
  type: 'suggestion_result';
  requestId: string;
  fen: string;
  positionEval?: number;
  mateIn?: number;
  winRate?: number;
  suggestions: SuggestionMove[];
}

export interface SuggestionError {
  type: 'suggestion_error';
  requestId: string;
  error: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate move flags (isCheck, isCapture, capturedPiece) using chess.js.
 */
function calculateMoveFlags(fen: string, move: string): {
  isCheck: boolean;
  isCapture: boolean;
  capturedPiece?: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
} {
  try {
    const chess = new Chess(fen);
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move.length === 5 ? (move[4] as any) : undefined;

    const result = chess.move({
      from: from as any,
      to: to as any,
      promotion,
    });

    if (!result) {
      return { isCheck: false, isCapture: false };
    }

    const isCapture = result.captured !== undefined;
    const capturedPiece = result.captured as 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | undefined;
    const isCheck = chess.inCheck();

    return { isCheck, isCapture, capturedPiece };
  } catch {
    return { isCheck: false, isCapture: false };
  }
}

/**
 * Convert contempt from 0-100 to Komodo's 0-200cp scale.
 * 0 = safe play (0cp contempt)
 * 50 = neutral (100cp contempt)
 * 100 = aggressive (200cp contempt)
 */
function riskToContempt(riskTaking: number): number {
  return Math.round(riskTaking * 2);
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle suggestion request.
 *
 * @param engine - Chess engine instance
 * @param request - Suggestion request
 * @param userEmail - User email for logging
 * @returns Suggestion result or error
 */
export async function handleSuggestionRequest(
  engine: ChessEngine,
  request: SuggestionRequest,
  userEmail: string
): Promise<SuggestionResult | SuggestionError> {
  const logger = new Logger(request.requestId, userEmail);
  const startTime = Date.now();

  try {
    const {
      requestId,
      fen,
      moves,
      targetElo,
      personality,
      multiPv,
      contempt: riskTaking,
    } = request;

    // Convert riskTaking (0-100) to Komodo contempt (0-200cp)
    const contempt = riskToContempt(riskTaking);

    // Determine side to move from FEN
    const fenParts = fen.split(' ');
    const sideToMove: Side = fenParts[1] === 'b' ? 'b' : 'w';
    const plyIndex = moves.length;

    logger.info('suggestion_request', {
      fen: fen.slice(0, 50) + '...',
      movesCount: moves.length,
      targetElo,
      personality,
      multiPv,
      riskTaking,
      contempt,
      sideToMove,
    }, 'started');

    // Reset engine state (anti-contamination)
    engine.sendCommand('ucinewgame');
    await engine.waitReady();

    // Configure engine
    const movetimeMs = computeMovetimeForElo(targetElo);

    engine.sendCommand('setoption name Hash value 512');
    engine.sendCommand('setoption name UCI_LimitStrength value true');
    engine.setElo(targetElo);
    engine.setPersonality(personality);
    engine.sendCommand(`setoption name MultiPV value ${clamp(multiPv, 1, 8)}`);
    engine.sendCommand('setoption name Skill value 25');
    engine.sendCommand(`setoption name Contempt value ${contempt}`);
    await engine.waitReady();

    // Analyze position
    const result = await engine.analyze(
      fen,
      {
        moves,
        searchMode: 'time',
        moveTime: movetimeMs,
        depth: 18,
        multiPV: clamp(multiPv, 1, 8),
      },
      undefined,
      'suggestions'
    );

    const lines = result.lines || [];

    // Normalize scores to White POV
    const scored = lines.map((l, idx) => {
      const rawScore = {
        type: (l.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
        value: l.mate !== undefined ? l.mate : l.evaluation * 100,
      };
      const scoreWhite = toWhitePOV(rawScore, sideToMove);
      return { line: l, scoreWhite, multipv: idx + 1 };
    });

    const bestScoreWhiteCp = scored.length && scored[0].scoreWhite.type === 'cp' ? scored[0].scoreWhite.value : 0;

    // Build suggestions with labels
    const suggestions: SuggestionMove[] = scored.map(({ line, scoreWhite, multipv }, idx) => {
      const move = line.moves[0] ?? (idx === 0 ? result.bestMove : '');
      const pv = line.moves ?? [];
      const promo = isPromotionMove(move);

      // Calculate eval drop vs best (for blunderRisk)
      let dropCp = 0;
      if (scoreWhite.type === 'cp') {
        const cand = scoreWhite.value;
        dropCp = sideToMove === 'w' ? bestScoreWhiteCp - cand : cand - bestScoreWhiteCp;
        dropCp = Math.max(0, dropCp);
      }
      const blunderRisk = computeBlunderRisk(dropCp, targetElo);

      // Is this a winning mate?
      const isMate = isWinningMateWhitePOV(scoreWhite, sideToMove);

      // Calculate isCheck, isCapture, and capturedPiece using chess.js
      const { isCheck, isCapture, capturedPiece } = calculateMoveFlags(fen, move);

      // Label
      const label: SuggestionMove['label'] = idx === 0 ? 'Best' : blunderRisk === 'low' ? 'Safe' : 'Risky';

      return {
        index: multipv,
        move,
        score: scoreWhite,
        cpDelta: idx === 0 ? 0 : -dropCp, // 0 for best, negative for worse moves
        pv: pv.slice(0, 10),
        depth: result.depth || 0,
        seldepth: undefined,
        flags: {
          isMate,
          isCheck,
          isCapture,
          capturedPiece,
          isPromotion: promo.isPromotion,
          promotionPiece: promo.piece,
        },
        safety: {
          filtered: false,
          blunderRisk,
          mateThreat: scoreWhite.type === 'mate',
        },
        label,
      };
    });

    // Calculate position evaluation for response
    let positionEval: number | undefined;
    let mateIn: number | undefined;
    let winRate: number | undefined;

    if (scored.length > 0) {
      const bestScore = scored[0].scoreWhite;
      if (bestScore.type === 'mate') {
        mateIn = bestScore.value;
      } else {
        // Convert to side-to-move perspective
        positionEval = sideToMove === 'w' ? bestScore.value : -bestScore.value;
        winRate = cpToWinPercent(positionEval);
      }
    }

    const totalMs = Date.now() - startTime;
    logger.info('suggestion_request', {
      suggestionsCount: suggestions.length,
      positionEval,
      mateIn,
      winRate,
      totalMs: totalMs >= 1000 ? `${(totalMs / 1000).toFixed(2)}s` : `${totalMs}ms`,
    }, 'ended');

    return {
      type: 'suggestion_result',
      requestId,
      fen,
      positionEval,
      mateIn,
      winRate,
      suggestions,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('suggestion_request', userEmail, errorMsg);

    return {
      type: 'suggestion_error',
      requestId: request.requestId,
      error: errorMsg,
    };
  }
}
