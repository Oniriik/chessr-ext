/**
 * Type definitions for the dual-phase chess analysis feedback system.
 *
 * These types match the server's analyze-types.ts for compatibility.
 */

import { Personality } from '../../shared/types';

export type Side = 'w' | 'b';
export type BadgeLabel = 'Best' | 'Safe' | 'Risky' | 'Human' | 'Alt';

// ============================================================================
// Score Types
// ============================================================================

/**
 * Engine score normalized to White's perspective.
 */
export interface EngineScore {
  type: 'cp' | 'mate';
  value: number;       // cp: centipawns, mate: +/-N moves to mate
  pov: 'white';        // Always white POV
}

// ============================================================================
// Suggestion Types
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
    isCheck?: boolean;                // True if gives check
    isCapture?: boolean;              // True if captures
    capturedPiece?: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';  // Piece that will be captured
    isPromotion?: boolean;            // True if pawn promotion
    promotionPiece?: 'q' | 'r' | 'b' | 'n';  // Promotion piece
  };

  safety: {
    filtered: boolean;                      // True if passed through filter
    blunderRisk: 'low' | 'medium' | 'high'; // Risk assessment vs best
    mateThreat: boolean;                    // True if PV contains mate threats
  };

  label?: BadgeLabel;  // UI-friendly label
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
// Accuracy Types
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
  };

  overall: number;            // Overall accuracy (0-100)

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
// Response Types
// ============================================================================

export interface AnalyzeResultResponse {
  type: 'analyze_result';
  requestId: string;
  version: '1.0';

  payload: {
    accuracy: AccuracyPayload;
    suggestions: SuggestionsPayload;
  };

  meta: {
    engine: 'KomodoDragon';
    engineVersion?: string;

    settingsUsed: {
      review: {
        hashMB: number;
        limitStrength: false;
        multiPV: 1;
        movetimeMsPerEval: number;
        analyzedPlies: number;
      };
      suggestion: {
        hashMB: number;
        limitStrength: true;
        targetElo: number;
        personality: string;
        multiPV: number;
        movetimeMs: number;
        warmupNodes?: number;
      };
    };

    timings: {
      reviewMs: number;         // Time spent on review phase
      suggestionMs: number;     // Time spent on suggestion phase
      totalMs: number;          // Total time
    };
  };
}

export interface AnalyzeErrorResponse {
  type: 'analyze_error';
  requestId: string;
  version: '1.0';

  error: {
    code: string;               // Error code (e.g., "ANALYZE_FAILED")
    message: string;            // Human-readable error message
  };

  meta?: {
    engine: 'KomodoDragon';
  };
}

// ============================================================================
// State Management Types
// ============================================================================

/**
 * Snapshot of analysis result for a specific position
 */
export interface Snapshot {
  requestId: string;
  fenHash: string;     // Hash of fen or (fen + moves tail)
  plyIndex: number;
  sideToMove: Side;
  chosenIndex: number;
  suggestions: SuggestionMove[];
  accuracy: AccuracyPayload;
  receivedAt: number;
}

/**
 * Feedback after a move is played
 */
export interface MoveFeedback {
  playedMoveUci: string;
  wasSuggested: boolean;
  matchIndex: number;       // Index in suggestions array (-1 if not found)
  label: BadgeLabel | '?';
  deltaCpVsBest?: number;   // Centipawn loss vs best
  message: string;          // UI string (e.g., "✅ Played Best #1")
  pvToAutoExpand?: string[]; // PV to show if followed
}

/**
 * Extension state machine for feedback system
 */
export type ChessrStatus = 'IDLE' | 'REQUESTING' | 'SHOWING' | 'MOVE_PLAYED';

/**
 * Accumulated accuracy cache for incremental analysis
 * The server analyzes only the last N moves (fast), but the extension
 * accumulates all analyzed plies to show comprehensive stats.
 */
export interface AccuracyCache {
  analyzedPlies: Map<number, AccuracyPly>;  // plyIndex → accuracy data
  overallStats: {
    brilliant: number;
    great: number;
    best: number;
    excellent: number;
    good: number;
    book: number;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
  };
}

export interface ChessrState {
  status: ChessrStatus;
  activeSnapshot?: Snapshot;
  lastFeedback?: MoveFeedback;

  // UI state
  selectedSuggestionIndex?: number;    // Highlight (chosen or user-selected)
  expandedPvSuggestionIndex?: number;  // Auto-expand after following

  // Previous accuracy for trend calculation
  previousAccuracy?: AccuracyPayload;

  // Accumulated analysis cache (incremental stats)
  accuracyCache?: AccuracyCache;

  // Player color for filtering accuracy stats (show only player's moves)
  playerColor?: Side;
}
