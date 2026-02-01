/**
 * Type definitions for the chess analysis pipeline.
 *
 * This module defines types for:
 * - Accuracy review: Analyzes moves at full strength
 * - User-mode suggestions: MultiPV suggestions tuned to user's ELO
 *
 * All evaluations are normalized to White POV for consistency.
 */

import { Personality } from './types.js';

export type Side = 'w' | 'b';

// ============================================================================
// Request Types
// ============================================================================

export interface AnalyzeRequest {
  type: 'analyze';
  requestId?: string;
  payload: {
    movesUci: string[];          // Plies in UCI format: ["e2e4", "e7e5", ...]
    fen?: string;                 // Optional (can be derived from movesUci)
    sideToMove?: Side;            // Optional (can be derived from movesUci)
    playerColor?: 'w' | 'b';     // Player's color (for calculating only their accuracy)
    review: {
      lastMoves: number;          // Number of full moves to analyze (default: 10)
      cachedAccuracy: AccuracyPly[];  // Cached analysis from previous requests (can be empty [])
    };
    user: {
      targetElo: number;          // User's target ELO (500-2500)
      personality: Personality;   // Komodo personality
      multiPV: number;            // Number of suggestion lines (1-8)
      disableLimitStrength?: boolean;  // Disable UCI_LimitStrength for full-strength suggestions (optional, only available at 2000+ ELO)
      opponentElo?: number;       // Opponent's ELO for contempt calculation (optional)
    };
  };
}

/**
 * Stats-only request: Compute accuracy review on opponent's turn.
 * Executed in background while player is thinking.
 */
export interface AnalyzeStatsRequest {
  type: 'analyze_stats';
  requestId?: string;
  payload: {
    movesUci: string[];          // Plies in UCI format: ["e2e4", "e7e5", ...]
    playerColor?: 'w' | 'b';     // Player's color (for calculating only their accuracy)
    review: {
      lastMoves: number;          // Number of full moves to analyze (default: 1)
      cachedAccuracy: AccuracyPly[];  // Cached analysis from previous requests (can be empty [])
    };
  };
}

/**
 * Suggestions-only request: Compute user-mode suggestions on player's turn.
 * Requires cached stats from a previous AnalyzeStatsRequest.
 */
export interface AnalyzeSuggestionsRequest {
  type: 'analyze_suggestions';
  requestId?: string;
  payload: {
    movesUci: string[];          // Plies in UCI format: ["e2e4", "e7e5", ...]
    cachedStats: {
      accuracy: AccuracyPayload;      // Cached accuracy analysis from stats request
      reviewTimingMs: number;         // Timing info from stats request (for logging)
    };
    user: {
      targetElo: number;          // User's target ELO (500-2500)
      personality: Personality;   // Komodo personality
      multiPV: number;            // Number of suggestion lines (1-8)
      disableLimitStrength?: boolean;  // Disable UCI_LimitStrength for full-strength suggestions (optional, only available at 2000+ ELO)
      opponentElo?: number;       // Opponent's ELO for contempt calculation (optional)
    };
  };
}

// ============================================================================
// Score Types
// ============================================================================

/**
 * Engine score normalized to White's perspective.
 * - type: 'cp' for centipawns, 'mate' for forced mate
 * - value: Positive = good for White, negative = good for Black
 * - pov: Always 'white' to indicate normalization
 */
export interface EngineScore {
  type: 'cp' | 'mate';
  value: number;       // cp: centipawns (e.g., 34), mate: +/-N moves to mate
  pov: 'white';        // Explicit indicator that score is from White's POV
}

// ============================================================================
// Accuracy Types (Review)
// ============================================================================

export interface AccuracyPly {
  plyIndex: number;           // Global ply index in game (0-based)
  moveNumber: number;         // Move number (1..N)
  side: Side;                 // Side that played this move

  playedMove: string;         // UCI format: "e2e4"
  bestMove: string;           // Best move at full strength: "d2d4"

  // Evaluations after each move (normalized to White POV)
  evaluation: {
    bestAfter: EngineScore;   // Eval if best move played
    playedAfter: EngineScore; // Eval after actual move
  };

  // Loss measurement
  loss: {
    cp?: number;              // Centipawn loss
    winPercent?: number;      // Win percent loss (primary metric)
  };

  // Advanced metrics for classification
  extras?: {
    gapWin?: number;          // Gap between best and second best (win%)
    gapCp?: number;           // Gap between best and second best (cp)
    swingWin?: number;        // Turning point magnitude (win%)
    materialDelta?: number;   // Material change (negative = sacrifice)
    secondBestMove?: string;  // Second best move (for uniqueness detection)
  };

  accuracy: number;           // Move accuracy (0-100)
  classification: 'Brilliant' | 'Great' | 'Best' | 'Excellent' | 'Good' | 'Book' | 'Inaccuracy' | 'Mistake' | 'Blunder';

  // Optional details
  pv?: {
    best?: string[];          // PV for best move
    played?: string[];        // PV after played move
  };

  flags?: {
    isMateMiss?: boolean;           // True if missed a winning mate
    allowsImmediateMate?: boolean;  // True if allows opponent's mate
  };
}

export interface AccuracyPayload {
  method: 'cp_loss' | 'win_percent_loss';

  window: {
    lastMoves: number;        // Number of full moves analyzed (e.g., 10)
    lastPlies: number;        // Max plies in window (e.g., 20)
    analyzedPlies: number;    // Actual plies analyzed (≤ lastPlies if game short)
    startPlyIndex: number;    // Global ply index where window starts
    initialCp?: number;       // Centipawn eval of position BEFORE first analyzed move (White POV)
  };

  overall: number;            // Overall accuracy (0-100)
  playerAccuracy?: number;    // Player's accuracy (0-100), calculated for their color only

  summary: {
    brilliant: number;        // Count of brilliant moves (sacrifice + winning)
    great: number;            // Count of great moves (turning point or unique)
    best: number;             // Count of best moves (0-0.2% win loss)
    excellent: number;        // Count of excellent moves (0.2-1% win loss)
    good: number;             // Count of good moves (1-3% win loss)
    book: number;             // Count of book moves
    inaccuracies: number;     // Count of inaccuracies (3-8% win loss)
    mistakes: number;         // Count of mistakes (8-20% win loss)
    blunders: number;         // Count of blunders (>20% win loss)
  };

  perPly: AccuracyPly[];      // Detailed analysis per ply
}

// ============================================================================
// Suggestion Types (User Mode)
// ============================================================================

export interface SuggestionMove {
  index: number;              // MultiPV rank (1..N)

  move: string;               // UCI format: "e2e4" or promotion "e7e8q"

  score: EngineScore;         // Score for this line (White POV)

  pv: string[];               // Principal variation (UCI moves)

  depth?: number;             // Search depth
  seldepth?: number;          // Selective search depth

  flags: {
    isMate: boolean;                  // True if this leads to mate
    isCheck?: boolean;                // True if gives check (from chess.js)
    isCapture?: boolean;              // True if captures (from chess.js)
    capturedPiece?: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';  // Piece that will be captured
    isPromotion?: boolean;            // True if pawn promotion
    promotionPiece?: 'q' | 'r' | 'b' | 'n';  // Promotion piece
  };

  safety: {
    filtered: boolean;                      // True if passed through filter
    blunderRisk: 'low' | 'medium' | 'high'; // Risk assessment vs best
    mateThreat: boolean;                    // True if PV contains mate threats
  };

  label?: 'Best' | 'Safe' | 'Risky' | 'Human' | 'Alt';  // UI-friendly label
}

export interface SuggestionsPayload {
  context: {
    fen: string;              // Current position FEN
    sideToMove: Side;         // Side to move
    plyIndex: number;         // Current ply index (movesUci.length)
  };

  userSettings: {
    targetElo: number;        // User's target ELO (500-2500)
    personality: string;      // Komodo personality
    multiPV: number;          // Number of lines (1-8)
  };

  computeSettings: {
    hashMB: number;           // Hash table size (MB)
    movetimeMs: number;       // Search time (ms)
    warmup: {
      enabled: boolean;       // Whether warmup was performed
      nodes: number;          // Warmup nodes (e.g., 200)
      lastPlies: number;      // Plies used for warmup (e.g., 20)
    };
  };

  suggestions: SuggestionMove[];  // Ordered by MultiPV rank

  chosenIndex: number;        // Index of recommended move (0-based)
}

// ============================================================================
// Metadata Types
// ============================================================================

export interface ReviewSettingsUsed {
  hashMB: number;                   // Hash size for review (e.g., 256)
  limitStrength: false;             // Always false for review
  multiPV: 1;                       // Always 1 for review
  movetimeMsPerEval: number;        // Time per position (e.g., 80)
  analyzedPlies: number;            // Actual number of plies analyzed
}

export interface SuggestionSettingsUsed {
  hashMB: number;                   // Hash size for suggestion
  limitStrength: boolean;           // Whether UCI_LimitStrength is enabled
  targetElo: number;                // User's target ELO
  personality: string;              // Komodo personality
  multiPV: number;                  // Number of lines
  movetimeMs: number;               // Search time per position
  warmupNodes?: number;             // Warmup nodes (if enabled)
}

// ============================================================================
// Response Types
// ============================================================================

export interface AnalyzeResultResponse {
  type: 'analyze_result';
  requestId: string;

  payload: {
    accuracy: AccuracyPayload;
    suggestions: SuggestionsPayload;
  };

  meta: {
    engine: 'KomodoDragon';
    engineVersion?: string;

    settingsUsed: {
      review: ReviewSettingsUsed;
      suggestion: SuggestionSettingsUsed;
    };

    timings: {
      reviewMs: number;         // Time spent on accuracy review
      suggestionMs: number;     // Time spent on suggestions
      totalMs: number;          // Total time
    };
  };
}

export interface AnalyzeErrorResponse {
  type: 'analyze_error';
  requestId: string;

  error: {
    code: string;               // Error code (e.g., "ANALYZE_FAILED")
    message: string;            // Human-readable error message
  };

  meta?: {
    engine: 'KomodoDragon';
  };
}

/**
 * Stats-only response.
 * Contains accuracy analysis without suggestions.
 * Reset is done before suggestions, not after stats.
 */
export interface AnalyzeStatsResponse {
  type: 'analyze_stats_result';
  requestId: string;

  payload: {
    accuracy: AccuracyPayload;
  };

  meta: {
    engine: 'KomodoDragon';
    engineVersion?: string;

    settingsUsed: {
      review: ReviewSettingsUsed;
    };

    timings: {
      reviewMs: number;         // Time spent on accuracy review
      totalMs: number;          // Total time (reviewMs only)
    };
  };
}

/**
 * Suggestions-only response.
 * Contains user-mode suggestions with cached accuracy for convenience.
 */
export interface AnalyzeSuggestionsResponse {
  type: 'analyze_suggestions_result';
  requestId: string;

  payload: {
    suggestions: SuggestionsPayload;
    accuracy?: AccuracyPayload;  // Cached stats included for convenience
  };

  meta: {
    engine: 'KomodoDragon';
    engineVersion?: string;

    settingsUsed: {
      suggestion: SuggestionSettingsUsed;
    };

    timings: {
      suggestionMs: number;     // Time spent on suggestions
      totalMs: number;          // Total time (suggestionMs only)
    };
  };
}

// ============================================================================
// Internal Types (used during pipeline processing)
// ============================================================================

/**
 * Internal representation of a UCI info line (parsed from engine output).
 */
export interface PVLine {
  multipv: number;
  depth?: number;
  seldepth?: number;
  score: { type: 'cp' | 'mate'; value: number };  // Raw score (not normalized)
  pv: string[];
}

/**
 * Result of parsing a `go` command (bestmove + info lines).
 */
export interface GoResult {
  bestmove: string;
  infoLines: PVLine[];
  lastScore?: { type: 'cp' | 'mate'; value: number; depth?: number; seldepth?: number };
}
