export interface PVLine {
  moves: string[];
  evaluation: number;
  mate?: number;
}

export interface AnalysisResult {
  type: 'result';
  requestId?: string;      // Request ID to match request/response
  bestMove: string;
  ponder?: string;
  evaluation: number;
  mate?: number;
  lines: PVLine[];
  depth: number;
  // Timing info (ms)
  timing?: {
    warmup: number;
    analysis: number;
    total: number;
  };
  // Player performance estimate (calculated during warmup)
  playerPerformance?: {
    acpl: number;           // Average centipawn loss
    estimatedElo: number;   // Estimated ELO based on ACPL
    accuracy: number;       // Accuracy percentage (0-100)
    movesAnalyzed: number;  // Number of player moves analyzed
  };
}

export interface ArrowColors {
  best: string;      // Color for best move
  second: string;    // Color for 2nd best
  other: string;     // Color for other moves
}

// Komodo Dragon Personalities
export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';

export interface Settings {
  enabled: boolean;
  serverUrl: string;
  userElo: number;  // User's base ELO (detected or manual)
  targetElo: number;  // Target ELO for engine (userElo + 150)
  opponentElo: number;  // Opponent's ELO for contempt calculation
  autoDetectTargetElo: boolean;  // Auto-detect target ELO from page
  autoDetectOpponentElo: boolean;  // Auto-detect opponent ELO from page
  personality: Personality;
  searchMode: 'depth' | 'time';
  depth: number;
  moveTime: number;  // in milliseconds
  multiPV: number;
  showArrows: boolean;
  showEvalBar: boolean;
  blunderThreshold: number;
  selectedOpening: string;  // Opening key or empty
  useDifferentArrowColors: boolean;  // true = different colors per arrow, false = single color
  arrowColors: ArrowColors;
  singleArrowColor: string;  // Used when useDifferentArrowColors is false
  language: 'fr' | 'en' | 'es' | 'ru' | 'de' | 'pt' | 'hi' | 'auto';  // UI language: auto = detect from browser
  numberOfSuggestions: 1 | 2 | 3;  // Number of suggestions to show (1-3)
  disableLimitStrength: boolean;          // Disable UCI_LimitStrength for full-strength suggestions (only available when targetElo >= 2000)

  // Feedback & Analysis Display Options
  showSuggestions: boolean;               // Display suggestion cards (#1, #2, #3) in sidebar
  showRollingAccuracy: boolean;           // Display accuracy widget for last 10 moves
  showQualityLabels: boolean;             // Display Best/Safe/Risky quality labels on suggestions
  showEffectLabels: boolean;              // Display mate/check/capture/promo effect labels on suggestions
  showPromotionAsText: boolean;           // Display "Promote to Knight" instead of "e7e8n"
}

// NOTE: DEFAULT_SETTINGS has been moved to ./defaults.ts to use environment config

export interface BoardConfig {
  boardElement: HTMLElement;
  isFlipped: boolean;
  playerColor: 'white' | 'black';
}
