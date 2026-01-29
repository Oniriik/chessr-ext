/**
 * Dual-Phase Chess Analysis Pipeline
 *
 * Phase A: Accuracy Review - Analyzes last 10 moves at full engine strength
 * Phase B: Reset - Clears engine state with ucinewgame
 * Phase C: User-Mode Suggestions - MultiPV suggestions tuned to user's ELO
 *
 * Critical: No contamination between phases (ucinewgame between A and C)
 */

import { Chess } from 'chess.js';
import { ChessEngine } from './engine.js';
import { Logger } from './logger.js';
import {
  AnalyzeRequest,
  AnalyzeResultResponse,
  AnalyzeErrorResponse,
  AccuracyPayload,
  AccuracyPly,
  SuggestionsPayload,
  SuggestionMove,
  EngineScore,
  PVLine,
  Side,
} from './analyze-types.js';
import type { Personality } from './types.js';
import {
  parseInfoLine,
  pickBestScoreFromInfos,
  toWhitePOV,
  sideToMoveAtPly,
  lossCpForPlayer,
  classifyByCpLoss,
  accuracyFromCpLoss,
  computeHashForElo,
  computeMovetimeForElo,
  computeBlunderRisk,
  isPromotionMove,
  isWinningMateWhitePOV,
  clamp,
  round,
  lossWinForPlayer,
  computeMaterialDelta,
} from './uci-helpers.js';
import { classifyMove, type MoveContext } from './uci-helpers-classify.js';

// ============================================================================
// Chess.js Integration
// ============================================================================

/**
 * Calculate move flags (isCheck, isCapture, capturedPiece) using chess.js.
 *
 * @param fen - FEN of position before the move
 * @param move - UCI move string (e.g., "e2e4" or "e7e8q")
 * @returns Object with isCheck, isCapture, and capturedPiece (if any)
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

    // Make the move
    const result = chess.move({
      from: from as any,
      to: to as any,
      promotion,
    });

    if (!result) {
      // Invalid move, return defaults
      return { isCheck: false, isCapture: false };
    }

    // Use chess.js result for accurate capture detection
    // This correctly handles all cases including en passant
    const isCapture = result.captured !== undefined;
    const capturedPiece = result.captured as 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | undefined;

    // Check if opponent is in check after the move
    const isCheck = chess.inCheck();

    return { isCheck, isCapture, capturedPiece };
  } catch (err) {
    // Fallback on error
    return { isCheck: false, isCapture: false };
  }
}

/**
 * Build FEN from moves.
 * Assumes standard starting position.
 */
function buildFenFromMoves(moves: string[]): string {
  if (moves.length === 0) {
    return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }

  try {
    const chess = new Chess();
    for (const move of moves) {
      const from = move.slice(0, 2);
      const to = move.slice(2, 4);
      const promotion = move.length === 5 ? (move[4] as any) : undefined;

      chess.move({
        from: from as any,
        to: to as any,
        promotion,
      });
    }
    return chess.fen();
  } catch {
    // Fallback to startpos if moves invalid
    return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }
}

// ============================================================================
// UCI Command Helpers
// ============================================================================

/**
 * Run analysis on a position using the engine's built-in analyze method.
 * This is a wrapper that returns the raw multiPV lines for our pipeline.
 *
 * @param engine - Chess engine instance
 * @param fen - Position FEN
 * @param moves - Move history for position command
 * @param searchMode - 'time' or 'depth'
 * @param timeMs - Movetime in ms (for 'time' mode)
 * @param depth - Depth (for 'depth' mode)
 * @param multiPV - Number of PV lines
 * @returns Analysis result with lines
 */
async function analyzePosition(
  engine: ChessEngine,
  fen: string,
  moves: string[],
  searchMode: 'time' | 'depth',
  timeMs: number,
  depth: number,
  multiPV: number
): Promise<{ lines: any[]; bestMove: string }> {
  const result = await engine.analyze(fen, {
    moves,
    searchMode,
    depth,
    moveTime: timeMs,
    multiPV,
  });

  return {
    lines: result.lines || [],
    bestMove: result.bestMove,
  };
}

// ============================================================================
// Phase A: Accuracy Review (Full Strength)
// ============================================================================

async function phaseA_AccuracyReview(
  engine: ChessEngine,
  movesUci: string[],
  lastMoves: number,
  logger: Logger,
  userEmail: string
): Promise<{ payload: AccuracyPayload; timingMs: number }> {
  const startTime = Date.now();

  // Calculate window
  const windowPlies = lastMoves * 2; // 10 moves = 20 plies
  const startPlyIndex = Math.max(0, movesUci.length - windowPlies);
  const prefixMoves = movesUci.slice(0, startPlyIndex);
  const windowMoves = movesUci.slice(startPlyIndex);
  const analyzedPlies = windowMoves.length;

  logger.info('stats_start', userEmail, {
    totalMoves: movesUci.length,
    lastMoves,
    windowPlies,
    analyzedPlies,
    startPlyIndex,
  });

  // Configure engine for full strength
  const reviewHashMB = 256;
  const movetimePerEval = 80;

  engine.sendCommand(`setoption name Hash value ${reviewHashMB}`);
  engine.sendCommand('setoption name MultiPV value 2'); // MultiPV=2 for gap calculation
  engine.setElo(3500);  // Set to max strength (updates tracked value)
  engine.setPersonality('Default');  // Force Default personality for stats
  engine.sendCommand('setoption name Skill value 25'); // Max skill for Komodo
  await engine.waitReady();

  const perPly: AccuracyPly[] = [];

  // Analyze each ply in the window
  for (let i = 0; i < windowMoves.length; i++) {
    const plyIndex = startPlyIndex + i;
    const sidePlayed: Side = sideToMoveAtPly(plyIndex);
    const moveNumber = Math.floor(plyIndex / 2) + 1;
    const playedMove = windowMoves[i];

    const beforeMoves = prefixMoves.concat(windowMoves.slice(0, i));
    const sideToMoveBefore = sideToMoveAtPly(plyIndex);
    const sideToMoveAfter = sideToMoveAtPly(plyIndex + 1);

    // A1: Analyze position BEFORE move (MultiPV=2 for gap calculation)
    const fenBefore = buildFenFromMoves(beforeMoves);
    const bestResult = await analyzePosition(engine, fenBefore, beforeMoves, 'time', movetimePerEval, 18, 2);
    const bestMove = bestResult.bestMove;

    // Extract best and second best scores from result
    const bestLine = bestResult.lines[0];
    const secondLine = bestResult.lines[1]; // For gap calculation

    const bestAfterRaw = bestLine
      ? {
          type: (bestLine.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
          value: bestLine.mate !== undefined ? bestLine.mate : bestLine.evaluation * 100,
        }
      : { type: 'cp' as const, value: 0 };
    const bestAfterWhite = toWhitePOV(bestAfterRaw, sideToMoveBefore);

    // Second best score (for uniqueness detection)
    const secondAfterRaw = secondLine
      ? {
          type: (secondLine.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
          value: secondLine.mate !== undefined ? secondLine.mate : secondLine.evaluation * 100,
        }
      : undefined;
    const secondAfterWhite = secondAfterRaw ? toWhitePOV(secondAfterRaw, sideToMoveBefore) : undefined;
    const secondBestMove = secondLine?.moves?.[0];

    // A2: Analyze position AFTER played move
    const afterMoves = beforeMoves.concat([playedMove]);
    const fenAfter = buildFenFromMoves(afterMoves);
    const playedResult = await analyzePosition(engine, fenAfter, afterMoves, 'time', movetimePerEval, 18, 1);

    const playedLine = playedResult.lines[0];
    const playedAfterRaw = playedLine
      ? {
          type: (playedLine.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
          value: playedLine.mate !== undefined ? playedLine.mate : playedLine.evaluation * 100,
        }
      : { type: 'cp' as const, value: 0 };
    const playedAfterWhite = toWhitePOV(playedAfterRaw, sideToMoveAfter);

    // A3: Calculate material delta for sacrifice detection
    const materialDelta = computeMaterialDelta(Chess, fenBefore, playedMove, sidePlayed);

    // A4: Classify move using advanced system (Brilliant/Great/Best/etc)
    const moveContext: MoveContext = {
      plyIndex,
      sidePlayed,
      playedMove,
      bestMove,
      beforeBest: bestAfterWhite,
      beforeSecond: secondAfterWhite,
      afterPlayed: playedAfterWhite,
      isBook: false, // TODO: Add opening book detection
      materialDelta: materialDelta ?? undefined,
    };

    const classificationResult = classifyMove(moveContext);
    const classification = classificationResult.label;
    const { lossWin, gapWin, swingWin } = classificationResult.details;

    // Calculate cp loss for backwards compatibility
    const lossCp = bestAfterWhite.type === 'cp' && playedAfterWhite.type === 'cp'
      ? lossCpForPlayer(sidePlayed, bestAfterWhite.value, playedAfterWhite.value)
      : 0;

    // Calculate accuracy from win% loss (better than cp)
    const accuracy = Math.max(0, Math.min(100, Math.round(100 - lossWin * 5)));

    // Flags for special situations
    const flags: AccuracyPly['flags'] = {};
    if (bestAfterWhite.type === 'mate' && playedAfterWhite.type !== 'mate') {
      const bestWinMate = isWinningMateWhitePOV(bestAfterWhite, sideToMoveBefore);
      if (bestWinMate) {
        flags.isMateMiss = true;
      }
    }

    perPly.push({
      plyIndex,
      moveNumber,
      side: sidePlayed,
      playedMove,
      bestMove,
      evaluation: {
        bestAfter: bestAfterWhite,
        playedAfter: playedAfterWhite,
      },
      loss: {
        cp: lossCp,
        winPercent: lossWin,
      },
      accuracy,
      classification,
      extras: {
        gapWin,
        gapCp: secondAfterWhite ? Math.abs(bestAfterWhite.value - secondAfterWhite.value) : undefined,
        swingWin,
        materialDelta: materialDelta ?? undefined,
        secondBestMove,
      },
      flags,
    });
  }

  // Calculate summary with new classification system
  const summary = perPly.reduce(
    (acc, p) => {
      if (p.classification === 'Brilliant') acc.brilliant++;
      else if (p.classification === 'Great') acc.great++;
      else if (p.classification === 'Best') acc.best++;
      else if (p.classification === 'Excellent') acc.excellent++;
      else if (p.classification === 'Good') acc.good++;
      else if (p.classification === 'Book') acc.book++;
      else if (p.classification === 'Inaccuracy') acc.inaccuracies++;
      else if (p.classification === 'Mistake') acc.mistakes++;
      else if (p.classification === 'Blunder') acc.blunders++;
      return acc;
    },
    {
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      good: 0,
      book: 0,
      inaccuracies: 0,
      mistakes: 0,
      blunders: 0,
    }
  );

  const overall = perPly.length ? Math.round(perPly.reduce((sum, p) => sum + p.accuracy, 0) / perPly.length) : 100;

  const payload: AccuracyPayload = {
    method: 'win_percent_loss', // Using win% for better accuracy
    window: {
      lastMoves,
      lastPlies: windowPlies,
      analyzedPlies,
      startPlyIndex,
    },
    overall,
    summary,
    perPly,
  };

  const timingMs = Date.now() - startTime;
  return { payload, timingMs };
}

// ============================================================================
// Phase B: Reset (Anti-Contamination)
// ============================================================================

async function phaseB_Reset(engine: ChessEngine, logger: Logger, userEmail: string): Promise<void> {
  logger.info('reset_before', userEmail, {
    phase: 'B',
    action: 'ucinewgame',
    reason: 'Prevent contamination between Phase A and Phase C',
  });

  engine.sendCommand('ucinewgame');
  await engine.waitReady();

  logger.info('reset_after', userEmail, {
    phase: 'B',
    status: 'clean',
    message: 'Engine state cleared, ready for Phase C',
  });
}

// ============================================================================
// Phase C: User-Mode Suggestions (MultiPV)
// ============================================================================

async function phaseC_UserModeSuggestions(
  engine: ChessEngine,
  movesUci: string[],
  targetElo: number,
  personality: Personality,
  multiPV: number,
  logger: Logger,
  userEmail: string
): Promise<{ payload: SuggestionsPayload; timingMs: number }> {
  const startTime = Date.now();

  logger.info('suggestion_start', userEmail, {
    targetElo,
    personality,
    multiPV,
    currentPly: movesUci.length,
  });

  // Map ELO to hash and movetime
  const sugHashMB = computeHashForElo(targetElo);
  const movetimeMs = computeMovetimeForElo(targetElo);

  // Configure engine for user mode
  engine.sendCommand(`setoption name Hash value ${sugHashMB}`);
  engine.sendCommand('setoption name UCI_LimitStrength value true');
  engine.setElo(targetElo);  // Use setElo() to update tracked value
  engine.setPersonality(personality);  // Use setPersonality() to update tracked value
  engine.sendCommand(`setoption name MultiPV value ${clamp(multiPV, 1, 8)}`);
  await engine.waitReady();

  // Optional warmup - skipped for simplicity since analyze() does its own warmup
  const warmupEnabled = false; // Disable for now, analyze() handles warmup internally
  const warmupNodes = 200;
  const warmupLastPlies = Math.min(movesUci.length, 20);

  // Main analysis on current position
  const currentFen = buildFenFromMoves(movesUci);
  const sugResult = await analyzePosition(
    engine,
    currentFen,
    movesUci,
    'time',
    movetimeMs,
    18,
    clamp(multiPV, 1, 8)
  );

  // Extract lines from result
  const lines = sugResult.lines || [];

  // Normalize scores to White POV
  const plyIndexNow = movesUci.length;
  const sideToMoveNow: Side = sideToMoveAtPly(plyIndexNow);

  // Convert engine result format to our format
  const scored = lines.map((l, idx) => {
    const rawScore = {
      type: (l.mate !== undefined ? 'mate' : 'cp') as 'cp' | 'mate',
      value: l.mate !== undefined ? l.mate : l.evaluation * 100,
    };
    const scoreWhite = toWhitePOV(rawScore, sideToMoveNow);
    return { line: l, scoreWhite, multipv: idx + 1 };
  });

  const bestScoreWhiteCp = scored.length && scored[0].scoreWhite.type === 'cp' ? scored[0].scoreWhite.value : 0;

  // Build suggestions with all details
  const suggestions: SuggestionMove[] = scored.map(({ line, scoreWhite, multipv }, idx) => {
    const move = line.moves[0] ?? (idx === 0 ? sugResult.bestMove : '');
    const pv = line.moves ?? [];
    const promo = isPromotionMove(move);

    // Calculate eval drop vs best (for blunderRisk)
    let dropCp = 0;
    if (scoreWhite.type === 'cp') {
      const cand = scoreWhite.value;
      dropCp = sideToMoveNow === 'w' ? bestScoreWhiteCp - cand : cand - bestScoreWhiteCp;
      dropCp = Math.max(0, dropCp);
    }
    const blunderRisk = computeBlunderRisk(dropCp, targetElo);

    // Is this a winning mate?
    const isMate = isWinningMateWhitePOV(scoreWhite, sideToMoveNow);

    // Calculate isCheck, isCapture, and capturedPiece using chess.js
    const { isCheck, isCapture, capturedPiece } = calculateMoveFlags(currentFen, move);

    // Label
    const label: SuggestionMove['label'] = idx === 0 ? 'Best' : blunderRisk === 'low' ? 'Safe' : 'Risky';

    return {
      index: multipv,
      move,
      score: scoreWhite,
      pv: pv.slice(0, 10),
      depth: undefined, // Engine result doesn't include depth in this format
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

  const chosenIndex = suggestions.length ? 0 : -1;

  const payload: SuggestionsPayload = {
    context: {
      fen: currentFen,
      sideToMove: sideToMoveNow,
      plyIndex: plyIndexNow,
    },
    userSettings: {
      targetElo,
      personality,
      multiPV: clamp(multiPV, 1, 8),
    },
    computeSettings: {
      hashMB: sugHashMB,
      movetimeMs,
      warmup: {
        enabled: warmupEnabled,
        nodes: warmupNodes,
        lastPlies: warmupLastPlies,
      },
    },
    suggestions,
    chosenIndex,
  };

  const timingMs = Date.now() - startTime;
  return { payload, timingMs };
}

// ============================================================================
// Main Pipeline Entry Point
// ============================================================================

export async function handleAnalyze(
  engine: ChessEngine,
  req: AnalyzeRequest,
  userEmail: string = 'system'
): Promise<AnalyzeResultResponse | AnalyzeErrorResponse> {
  const t0 = Date.now();
  const logger = new Logger(req.requestId || '');

  try {
    const movesUci = req.payload.movesUci ?? [];
    const lastMoves = req.payload.review?.lastMoves ?? 10;
    const { targetElo, personality, multiPV } = req.payload.user;

    // Phase A: Accuracy Review (Full Strength)
    const { payload: accuracyPayload, timingMs: reviewMs } = await phaseA_AccuracyReview(
      engine,
      movesUci,
      lastMoves,
      logger,
      userEmail
    );

    // Phase B: Reset (Anti-Contamination)
    await phaseB_Reset(engine, logger, userEmail);

    // Phase C: User-Mode Suggestions
    const { payload: suggestionsPayload, timingMs: suggestionMs } = await phaseC_UserModeSuggestions(
      engine,
      movesUci,
      targetElo,
      personality,
      multiPV,
      logger,
      userEmail
    );

    const totalMs = Date.now() - t0;

    const response: AnalyzeResultResponse = {
      type: 'analyze_result',
      requestId: req.requestId || '',
      version: '1.0',
      payload: {
        accuracy: accuracyPayload,
        suggestions: suggestionsPayload,
      },
      meta: {
        engine: 'KomodoDragon',
        settingsUsed: {
          review: {
            hashMB: 256,
            limitStrength: false,
            multiPV: 1,
            movetimeMsPerEval: 80,
            analyzedPlies: accuracyPayload.window.analyzedPlies,
          },
          suggestion: {
            hashMB: suggestionsPayload.computeSettings.hashMB,
            limitStrength: true,
            targetElo,
            personality,
            multiPV: clamp(multiPV, 1, 8),
            movetimeMs: suggestionsPayload.computeSettings.movetimeMs,
            warmupNodes: suggestionsPayload.computeSettings.warmup.enabled
              ? suggestionsPayload.computeSettings.warmup.nodes
              : undefined,
          },
        },
        timings: {
          reviewMs,
          suggestionMs,
          totalMs,
        },
      },
    };

    return response;
  } catch (e: any) {
    const errorResponse: AnalyzeErrorResponse = {
      type: 'analyze_error',
      requestId: req.requestId || '',
      version: '1.0',
      error: {
        code: 'ANALYZE_FAILED',
        message: e?.message ?? 'Unknown error',
      },
      meta: { engine: 'KomodoDragon' },
    };

    return errorResponse;
  }
}
