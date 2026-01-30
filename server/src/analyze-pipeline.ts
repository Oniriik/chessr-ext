/**
 * Chess Analysis Pipeline
 *
 * Components:
 * - Accuracy Review: Analyzes moves at full engine strength
 * - Engine Reset: Clears engine state with ucinewgame
 * - Suggestions: MultiPV suggestions tuned to user's ELO
 *
 * Critical: No contamination between accuracy review and suggestions (ucinewgame between them)
 */

import { Chess } from 'chess.js';
import { ChessEngine } from './engine.js';
import { Logger } from './logger.js';
import {
  AnalyzeRequest,
  AnalyzeResultResponse,
  AnalyzeErrorResponse,
  AnalyzeStatsRequest,
  AnalyzeStatsResponse,
  AnalyzeSuggestionsRequest,
  AnalyzeSuggestionsResponse,
  AccuracyPayload,
  AccuracyPly,
  SuggestionsPayload,
  SuggestionMove,
  Side,
} from './analyze-types.js';
import type { Personality } from './types.js';
import {
  toWhitePOV,
  sideToMoveAtPly,
  lossCpForPlayer,
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
// Accuracy Review (Full Strength)
// ============================================================================

/**
 * Validate cached AccuracyPly entries from client
 * Returns only valid entries that are safe to reuse
 */
function validateCachedAccuracy(
  cachedPerPly: AccuracyPly[],
  movesUci: string[],
  logger: Logger
): Map<number, AccuracyPly> {
  const validated = new Map<number, AccuracyPly>();

  if (!Array.isArray(cachedPerPly) || cachedPerPly.length === 0) {
    return validated;
  }

  let validCount = 0;
  let invalidCount = 0;

  for (const cached of cachedPerPly) {
    try {
      // Validation 1: Required fields exist
      if (
        typeof cached.plyIndex !== 'number' ||
        typeof cached.playedMove !== 'string' ||
        !cached.evaluation?.bestAfter ||
        !cached.evaluation?.playedAfter
      ) {
        invalidCount++;
        continue;
      }

      // Validation 2: plyIndex in valid range
      if (cached.plyIndex < 0 || cached.plyIndex >= movesUci.length) {
        invalidCount++;
        continue;
      }

      // Validation 3: playedMove matches movesUci[plyIndex] (CRITICAL for preventing cross-game cache)
      if (cached.playedMove !== movesUci[cached.plyIndex]) {
        invalidCount++;
        continue;
      }

      // Validation 4: Scores are valid structures
      const { bestAfter, playedAfter } = cached.evaluation;
      if (
        (bestAfter.type !== 'cp' && bestAfter.type !== 'mate') ||
        typeof bestAfter.value !== 'number' ||
        (playedAfter.type !== 'cp' && playedAfter.type !== 'mate') ||
        typeof playedAfter.value !== 'number'
      ) {
        invalidCount++;
        continue;
      }

      // Validation 5: No duplicates (prefer first occurrence)
      if (validated.has(cached.plyIndex)) {
        invalidCount++;
        continue;
      }

      // Valid entry - add to cache
      validated.set(cached.plyIndex, cached);
      validCount++;

    } catch (err) {
      // Any error during validation -> skip entry
      invalidCount++;
      continue;
    }
  }

  if (validCount > 0 || invalidCount > 0) {
    logger.info('cache_validation', 'system', {
      validCount,
      invalidCount,
      hitRate: validCount > 0 ? validCount / (validCount + invalidCount) : 0,
    });
  }

  return validated;
}

async function runAccuracyReview(
  logger: Logger,
  engine: ChessEngine,
  params: {
    movesUci: string[];
    lastMoves: number;
    cachedPerPly: AccuracyPly[];
  }
): Promise<{ payload: AccuracyPayload; timingMs: number }> {
  const { movesUci, lastMoves, cachedPerPly } = params;
  const startTime = Date.now();

  // Calculate window
  const windowPlies = lastMoves * 2; // 10 moves = 20 plies
  const startPlyIndex = Math.max(0, movesUci.length - windowPlies);
  const prefixMoves = movesUci.slice(0, startPlyIndex);
  const windowMoves = movesUci.slice(startPlyIndex);
  const analyzedPlies = windowMoves.length;

  // Validate cached data
  const cacheMap = validateCachedAccuracy(cachedPerPly, movesUci, logger);

  logger.info('stats_start', {
    totalMoves: movesUci.length,
    lastMoves,
    startPlyIndex,
  }, 'started');

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
  let cacheHits = 0;
  let cacheMisses = 0;

  // Analyze each ply in the window
  for (let i = 0; i < windowMoves.length; i++) {
    const plyIndex = startPlyIndex + i;

    // Check cache first
    const cachedEntry = cacheMap.get(plyIndex);
    if (cachedEntry) {
      perPly.push(cachedEntry);
      cacheHits++;
      continue;  // Skip analysis for this ply
    }

    // Cache miss - perform full analysis
    cacheMisses++;
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

  logger.info('stats_start', {
    windowPlies,
    analyzedPlies,
    duration: timingMs >= 1000 ? `${(timingMs / 1000).toFixed(2)}s` : `${timingMs}ms`,
  }, 'ended');

  return { payload, timingMs };
}

// ============================================================================
// Engine Reset (Anti-Contamination)
// ============================================================================

async function runEngineReset(engine: ChessEngine): Promise<void> {
  engine.sendCommand('ucinewgame');
  await engine.waitReady();
}

// ============================================================================
// User-Mode Suggestions (MultiPV)
// ============================================================================

async function runSuggestions(
  logger: Logger,
  engine: ChessEngine,
  params: {
    movesUci: string[];
    targetElo: number;
    personality: Personality;
    multiPV: number;
    disableLimitStrength?: boolean;
  }
): Promise<{ payload: SuggestionsPayload; timingMs: number }> {
  const { movesUci, targetElo, personality, multiPV, disableLimitStrength } = params;
  const startTime = Date.now();

  // Determine if we should enable limit strength (disabled if user requests full strength and ELO >= 2000)
  const shouldLimitStrength = !(disableLimitStrength && targetElo >= 2000);

  logger.info('suggestion_start', {
    targetElo,
    personality,
    multiPV,
    limitStrength: shouldLimitStrength,
    currentPly: movesUci.length,
  }, 'started');

  // Map ELO to hash and movetime
  const sugHashMB = computeHashForElo(targetElo);
  const movetimeMs = computeMovetimeForElo(targetElo);

  // Configure engine for user mode
  engine.sendCommand(`setoption name Hash value ${sugHashMB}`);
  engine.sendCommand(`setoption name UCI_LimitStrength value ${shouldLimitStrength ? 'true' : 'false'}`);
  if (shouldLimitStrength) {
    engine.setElo(targetElo);  // Only set ELO if limit strength is enabled
  }
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

  logger.info('suggestion_start', {
    duration: timingMs >= 1000 ? `${(timingMs / 1000).toFixed(2)}s` : `${timingMs}ms`,
  }, 'ended');

  return { payload, timingMs };
}

// ============================================================================
// Decoupled Handler: Stats Only (Accuracy Review)
// ============================================================================

/**
 * Handle stats-only request (opponent's turn, background).
 * Executes engine reset + accuracy review.
 * Another reset will be done before suggestions if needed.
 */
export async function handleAnalyzeStats(
  engine: ChessEngine,
  req: AnalyzeStatsRequest,
  userEmail: string = 'system'
): Promise<AnalyzeStatsResponse | AnalyzeErrorResponse> {
  const t0 = Date.now();
  const logger = new Logger(req.requestId || '', userEmail);

  try {
    const movesUci = req.payload.movesUci ?? [];
    const lastMoves = req.payload.review?.lastMoves ?? 1;
    const cachedAccuracy = req.payload.review.cachedAccuracy ?? [];

    logger.info('stats_request', {
      type: 'analyze_stats',
      movesCount: movesUci.length,
      lastMoves,
      cachedCount: cachedAccuracy.length,
    });

    // Engine Reset (Clean State)
    await runEngineReset(engine);

    // Accuracy Review (Full Strength)
    const { payload: accuracyPayload, timingMs: reviewMs } = await runAccuracyReview(
      logger,
      engine,
      {
        movesUci,
        lastMoves,
        cachedPerPly: cachedAccuracy,
      }
    );

    const totalMs = Date.now() - t0;

    const response: AnalyzeStatsResponse = {
      type: 'analyze_stats_result',
      requestId: req.requestId || '',
      version: '1.0',
      payload: {
        accuracy: accuracyPayload,
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
        },
        timings: {
          reviewMs,
          totalMs,
        },
      },
    };

    logger.info('stats_complete', {
      reviewMs,
      totalMs,
      analyzedPlies: accuracyPayload.window.analyzedPlies,
    });

    return response;
  } catch (e: any) {
    logger.info('stats_error', {
      errorMessage: e?.message,
      errorStack: e?.stack,
    });

    const errorResponse: AnalyzeErrorResponse = {
      type: 'analyze_error',
      requestId: req.requestId || '',
      version: '1.0',
      error: {
        code: 'STATS_FAILED',
        message: e?.message ?? 'Unknown error during stats analysis',
      },
      meta: { engine: 'KomodoDragon' },
    };

    return errorResponse;
  }
}

// ============================================================================
// Decoupled Handler: Suggestions Only
// ============================================================================

/**
 * Handle suggestions-only request (player's turn, fast).
 * Executes engine reset + user-mode suggestions using cached stats.
 * Requires cached stats from a previous AnalyzeStatsRequest.
 */
export async function handleAnalyzeSuggestions(
  engine: ChessEngine,
  req: AnalyzeSuggestionsRequest,
  userEmail: string = 'system'
): Promise<AnalyzeSuggestionsResponse | AnalyzeErrorResponse> {
  const t0 = Date.now();
  const logger = new Logger(req.requestId || '', userEmail);

  try {
    const movesUci = req.payload.movesUci ?? [];
    const cachedStats = req.payload.cachedStats;
    const { targetElo, personality, multiPV, disableLimitStrength } = req.payload.user;

    // Validation: cached stats required
    if (!cachedStats?.accuracy) {
      logger.info('suggestions_missing_stats', {
        errorMessage: 'Missing cached stats',
      });

      return {
        type: 'analyze_error',
        requestId: req.requestId || '',
        version: '1.0',
        error: {
          code: 'MISSING_STATS',
          message: 'Cached stats required for suggestions-only request. Send analyze_stats first.',
        },
        meta: { engine: 'KomodoDragon' },
      };
    }

    logger.info('suggestions_request', {
      type: 'analyze_suggestions',
      movesCount: movesUci.length,
      targetElo,
      personality,
      multiPV,
      cachedStatsAvailable: true,
    });

    // Engine Reset (Anti-Contamination between accuracy review and suggestions)
    const resetStart = Date.now();
    await runEngineReset(engine);
    const resetMs = Date.now() - resetStart;

    // User-Mode Suggestions
    const { payload: suggestionsPayload, timingMs: suggestionMs } = await runSuggestions(
      logger,
      engine,
      {
        movesUci,
        targetElo,
        personality,
        multiPV,
        disableLimitStrength,
      }
    );

    const totalMs = Date.now() - t0;

    // Calculate actual limitStrength value used
    const suggestionLimitStrength = !(disableLimitStrength && targetElo >= 2000);

    const response: AnalyzeSuggestionsResponse = {
      type: 'analyze_suggestions_result',
      requestId: req.requestId || '',
      version: '1.0',
      payload: {
        suggestions: suggestionsPayload,
        accuracy: cachedStats.accuracy, // Include cached stats for convenience
      },
      meta: {
        engine: 'KomodoDragon',
        settingsUsed: {
          suggestion: {
            hashMB: suggestionsPayload.computeSettings.hashMB,
            limitStrength: suggestionLimitStrength,
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
          suggestionMs,
          totalMs,
        },
      },
    };

    logger.info('suggestions_complete', {
      resetMs,
      suggestionMs,
      totalMs,
      suggestionsCount: suggestionsPayload.suggestions.length,
    });

    return response;
  } catch (e: any) {
    logger.info('suggestions_error', {
      errorMessage: e?.message,
      errorStack: e?.stack,
    });

    const errorResponse: AnalyzeErrorResponse = {
      type: 'analyze_error',
      requestId: req.requestId || '',
      version: '1.0',
      error: {
        code: 'SUGGESTIONS_FAILED',
        message: e?.message ?? 'Unknown error during suggestions analysis',
      },
      meta: { engine: 'KomodoDragon' },
    };

    return errorResponse;
  }
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
  const logger = new Logger(req.requestId || '', userEmail);

  try {
    const movesUci = req.payload.movesUci ?? [];
    const lastMoves = req.payload.review?.lastMoves ?? 10;
    const cachedAccuracy = req.payload.review.cachedAccuracy;
    const { targetElo, personality, multiPV, disableLimitStrength } = req.payload.user;

    // Engine Reset (Clean State)
    await runEngineReset(engine);

    // Accuracy Review (Full Strength)
    const { payload: accuracyPayload, timingMs: reviewMs } = await runAccuracyReview(
      logger,
      engine,
      {
        movesUci,
        lastMoves,
        cachedPerPly: cachedAccuracy,
      }
    );

    // Engine Reset (Anti-Contamination)
    await runEngineReset(engine);

    // User-Mode Suggestions
    const { payload: suggestionsPayload, timingMs: suggestionMs } = await runSuggestions(
      logger,
      engine,
      {
        movesUci,
        targetElo,
        personality,
        multiPV,
        disableLimitStrength,
      }
    );

    const totalMs = Date.now() - t0;

    // Calculate actual limitStrength value used
    const suggestionLimitStrength = !(disableLimitStrength && targetElo >= 2000);

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
            limitStrength: suggestionLimitStrength,
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
