/**
 * Analyze Handler (New Architecture)
 *
 * Handles the new `analyze` message type for move accuracy analysis.
 * Uses fenBefore/fenAfter for independent analysis (no dependency on stats).
 * Uses Komodo with targetElo (not full strength like chessr-next).
 */

import { Chess } from 'chess.js';
import { ChessEngine } from '../engine.js';
import { Logger } from '../logger.js';
import { Side, EngineScore } from '../analyze-types.js';
import {
  toWhitePOV,
  computeHashForElo,
  clamp,
  computeMaterialDelta,
} from '../uci-helpers.js';
import { classifyMove, MoveLabel, MoveContext } from '../uci-helpers-classify.js';

// ============================================================================
// Types
// ============================================================================

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface AnalyzeRequest {
  type: 'analyze_new';
  requestId: string;
  fenBefore: string;
  fenAfter: string;
  move: string;
  moves: string[];
  playerColor: 'w' | 'b';
  targetElo: number;
}

export interface AnalysisResult {
  type: 'analysis_result';
  requestId: string;
  move: string;
  classification: MoveLabel;
  cpl: number;
  accuracyImpact: number;
  weightedImpact: number;
  phase: GamePhase;
  bestMove: string;
  evalBefore: number;
  evalAfter: number;
  mateInAfter?: number;  // Mate-in value from White's POV (positive = White mates, negative = Black mates)
}

export interface AnalysisError {
  type: 'analysis_error';
  requestId: string;
  error: string;
}

// ============================================================================
// Constants
// ============================================================================

const ANALYSIS_DEPTH = 10;
const ANALYSIS_MULTIPV_BEFORE = 2; // Need best and second best for classification
const ANALYSIS_MULTIPV_AFTER = 1;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect game phase from material count.
 * Piece values: Q=9, R=5, B=3, N=3, P=1
 * Starting material = 78 (excluding kings)
 */
function detectPhase(fen: string): GamePhase {
  const board = fen.split(' ')[0];

  const pieceValues: Record<string, number> = {
    q: 9, Q: 9,
    r: 5, R: 5,
    b: 3, B: 3,
    n: 3, N: 3,
    p: 1, P: 1,
  };

  let material = 0;
  for (const char of board) {
    material += pieceValues[char] || 0;
  }

  const startingMaterial = 78;
  const ratio = material / startingMaterial;

  if (ratio > 0.85) return 'opening';
  if (ratio > 0.35) return 'middlegame';
  return 'endgame';
}

/**
 * Get phase weight multiplier.
 * Opening: mistakes less impactful (learning phase)
 * Middlegame: standard weight
 * Endgame: mistakes more impactful (precision required)
 */
function getPhaseWeight(phase: GamePhase): number {
  switch (phase) {
    case 'opening':
      return 0.7;
    case 'middlegame':
      return 1.0;
    case 'endgame':
      return 1.3;
  }
}

/**
 * Calculate accuracy impact using exponential curve.
 * Formula: cap * (1 - exp(-cpl / scale))
 * - 0 CPL = 0 impact
 * - 50 CPL = ~12 impact
 * - 150 CPL = ~25 impact
 * - 300+ CPL = ~40 (capped)
 */
function computeImpact(cpl: number): number {
  const cap = 40;
  const scale = 150;
  const impact = cap * (1 - Math.exp(-cpl / scale));
  return Math.round(impact * 10) / 10;
}

/**
 * Normalize evaluation to player's perspective.
 * Positive = good for player, Negative = bad for player
 */
function normalizeEval(evalCp: number, playerColor: 'w' | 'b'): number {
  return playerColor === 'w' ? evalCp : -evalCp;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle analyze request for move accuracy.
 *
 * @param engine - Chess engine instance
 * @param request - Analyze request
 * @param userEmail - User email for logging
 * @returns Analysis result or error
 */
export async function handleAnalyzeRequest(
  engine: ChessEngine,
  request: AnalyzeRequest,
  userEmail: string
): Promise<AnalysisResult | AnalysisError> {
  const logger = new Logger(request.requestId, userEmail);
  const startTime = Date.now();

  try {
    const {
      requestId,
      fenBefore,
      fenAfter,
      move,
      moves,
      playerColor,
      targetElo,
    } = request;

    // Determine side that played from fenBefore
    const fenParts = fenBefore.split(' ');
    const sidePlayed: Side = fenParts[1] === 'b' ? 'b' : 'w';

    logger.info('analyze_request', {
      move,
      fenBefore: fenBefore.slice(0, 50) + '...',
      movesCount: moves.length,
      playerColor,
      targetElo,
      sidePlayed,
    }, 'started');

    // Reset engine state (anti-contamination)
    engine.sendCommand('ucinewgame');
    await engine.waitReady();

    // Configure engine for analysis (full strength for accurate evaluation)
    engine.sendCommand('setoption name Hash value 512');
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.setPersonality('Default'); // Use Default personality for consistent analysis
    engine.sendCommand('setoption name MultiPV value ' + ANALYSIS_MULTIPV_BEFORE);
    await engine.waitReady();

    // 1. Analyze position BEFORE move (get best eval, second best, and best move)
    const beforeResult = await engine.analyze(
      fenBefore,
      {
        moves,
        searchMode: 'depth',
        depth: ANALYSIS_DEPTH,
        moveTime: 0, // Not used in depth mode
        multiPV: ANALYSIS_MULTIPV_BEFORE,
      },
      undefined,
      'stats'
    );

    // 2. Analyze position AFTER move (get resulting eval)
    engine.sendCommand('setoption name MultiPV value ' + ANALYSIS_MULTIPV_AFTER);
    await engine.waitReady();

    const afterResult = await engine.analyze(
      fenAfter,
      {
        moves: [...moves, move],
        searchMode: 'depth',
        depth: ANALYSIS_DEPTH,
        moveTime: 0, // Not used in depth mode
        multiPV: ANALYSIS_MULTIPV_AFTER,
      },
      undefined,
      'stats'
    );

    // Extract evaluations
    const beforeLines = beforeResult.lines || [];
    const afterLines = afterResult.lines || [];

    // Get best eval and second best from BEFORE
    const bestBefore = beforeLines[0];
    const secondBefore = beforeLines[1];
    const bestMove = bestBefore?.moves?.[0] ?? beforeResult.bestMove ?? move;

    // Get eval AFTER the move
    const evalAfterLine = afterLines[0];

    // Check if fenAfter is a terminal position (checkmate or stalemate)
    let isTerminalCheckmate = false;
    let terminalWinnerIsWhite = false;
    try {
      const chessAfter = new Chess(fenAfter);
      if (chessAfter.isCheckmate()) {
        isTerminalCheckmate = true;
        // If it's Black's turn and checkmate, White delivered the mate
        terminalWinnerIsWhite = chessAfter.turn() === 'b';
      }
    } catch {
      // Invalid FEN, continue with normal processing
    }

    // Convert to scores (White POV)
    const rawBestBefore = bestBefore ? {
      type: (bestBefore.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
      value: bestBefore.mate !== undefined ? bestBefore.mate : bestBefore.evaluation * 100,
    } : { type: 'cp' as const, value: 0 };

    const rawSecondBefore = secondBefore ? {
      type: (secondBefore.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
      value: secondBefore.mate !== undefined ? secondBefore.mate : secondBefore.evaluation * 100,
    } : undefined;

    // Handle terminal checkmate: override with mate 0 from White POV
    // Also handle NaN values from undefined evaluation
    let rawAfterPlayed: { type: 'cp' | 'mate'; value: number };
    if (evalAfterLine) {
      const rawValue = evalAfterLine.mate !== undefined
        ? evalAfterLine.mate
        : evalAfterLine.evaluation * 100;
      // Guard against NaN (when evaluation is undefined)
      rawAfterPlayed = {
        type: (evalAfterLine.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
        value: Number.isNaN(rawValue) ? 0 : rawValue,
      };
    } else {
      rawAfterPlayed = { type: 'cp', value: 0 };
    }

    // Normalize to White POV
    const bestBeforeWhite = toWhitePOV(rawBestBefore, sidePlayed);
    const secondBeforeWhite = rawSecondBefore ? toWhitePOV(rawSecondBefore, sidePlayed) : undefined;

    // After move, side to move has changed
    const sideAfter: Side = sidePlayed === 'w' ? 'b' : 'w';

    // For terminal checkmate, directly set White POV (bypass toWhitePOV which may give wrong result)
    let afterPlayedWhite: EngineScore;
    if (isTerminalCheckmate) {
      // Checkmate: mate 0 from White's perspective
      // value > 0 means White wins (White delivered checkmate)
      // value < 0 means Black wins (Black delivered checkmate)
      afterPlayedWhite = {
        type: 'mate',
        value: terminalWinnerIsWhite ? 1 : -1, // Use 1/-1 instead of 0/-0 for proper sign
        pov: 'white',
      };
    } else {
      afterPlayedWhite = toWhitePOV(rawAfterPlayed, sideAfter);
    }

    // Calculate material delta for the move
    const materialDelta = computeMaterialDelta(Chess, fenBefore, move, sidePlayed) ?? 0;

    // Classify the move
    const ctx: MoveContext = {
      plyIndex: moves.length,
      sidePlayed,
      playedMove: move,
      bestMove,
      beforeBest: bestBeforeWhite,
      beforeSecond: secondBeforeWhite,
      afterPlayed: afterPlayedWhite,
      materialDelta,
    };

    const classificationResult = classifyMove(ctx);
    const classification = classificationResult.label;

    // Calculate CPL
    let cpl = 0;
    if (bestBeforeWhite.type === 'cp' && afterPlayedWhite.type === 'cp') {
      // CPL from player's perspective
      const bestEvalPlayer = sidePlayed === 'w' ? bestBeforeWhite.value : -bestBeforeWhite.value;
      const afterEvalPlayer = sidePlayed === 'w' ? afterPlayedWhite.value : -afterPlayedWhite.value;
      cpl = Math.max(0, bestEvalPlayer - afterEvalPlayer);
    } else if (bestBeforeWhite.type === 'mate' && afterPlayedWhite.type !== 'mate') {
      // Had mate, now don't - big CPL
      cpl = 500;
    }

    // Calculate phase and weighted impact
    const phase = detectPhase(fenBefore);
    const phaseWeight = getPhaseWeight(phase);
    const accuracyImpact = computeImpact(cpl);
    const weightedImpact = Math.round(accuracyImpact * phaseWeight * 10) / 10;

    // Calculate eval values for response (in White's perspective, like suggestion scores)
    // This simplifies client-side handling - eval bar expects White POV
    // For mate: value >= 0 means White is winning (including mate 0 = checkmate delivered)
    const evalBefore = bestBeforeWhite.type === 'cp'
      ? bestBeforeWhite.value  // Already White POV
      : (bestBeforeWhite.value >= 0 ? 10000 : -10000);

    const evalAfter = afterPlayedWhite.type === 'cp'
      ? afterPlayedWhite.value  // Already White POV
      : (afterPlayedWhite.value >= 0 ? 10000 : -10000);

    // Calculate mateInAfter for proper mate display (White POV: positive = White mates)
    // This is the mate-in value from White's perspective
    let mateInAfter: number | undefined;
    if (afterPlayedWhite.type === 'mate') {
      mateInAfter = afterPlayedWhite.value; // Already in White POV (1 or -1 for checkmate, N or -N for mate-in-N)
    }

    const totalMs = Date.now() - startTime;
    logger.info('analyze_request', {
      move,
      classification,
      cpl,
      accuracyImpact,
      weightedImpact,
      phase,
      bestMove,
      playedIsBest: move === bestMove,
      // Detailed eval info for debugging
      beforeBestRaw: { type: rawBestBefore.type, value: rawBestBefore.value },
      beforeBestWhite: { type: bestBeforeWhite.type, value: bestBeforeWhite.value },
      afterPlayedRaw: { type: rawAfterPlayed.type, value: rawAfterPlayed.value },
      afterPlayedWhite: { type: afterPlayedWhite.type, value: afterPlayedWhite.value },
      sidePlayed,
      sideAfter,
      playerColor,
      evalBefore,
      evalAfter,
      lossWin: classificationResult.details.lossWin,
      isTerminalCheckmate,
      terminalWinnerIsWhite: isTerminalCheckmate ? terminalWinnerIsWhite : undefined,
      mateInAfter,
      totalMs: totalMs >= 1000 ? `${(totalMs / 1000).toFixed(2)}s` : `${totalMs}ms`,
    }, 'ended');

    return {
      type: 'analysis_result',
      requestId,
      move,
      classification,
      cpl,
      accuracyImpact,
      weightedImpact,
      phase,
      bestMove,
      evalBefore,
      evalAfter,
      mateInAfter,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('analyze_request', userEmail, errorMsg);

    return {
      type: 'analysis_error',
      requestId: request.requestId,
      error: errorMsg,
    };
  }
}
