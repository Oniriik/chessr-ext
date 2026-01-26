export interface PVLine {
  moves: string[];
  evaluation: number;
  mate?: number;
}

export interface AnalysisResult {
  type: 'result';
  bestMove: string;
  ponder?: string;
  evaluation: number;
  mate?: number;
  lines: PVLine[];
  depth: number;
}

export interface InfoUpdate {
  type: 'info';
  depth: number;
  evaluation: number;
  mate?: number;
}

export interface ArrowColors {
  best: string;      // Color for best move
  second: string;    // Color for 2nd best
  other: string;     // Color for other moves
}

export interface Settings {
  enabled: boolean;
  serverUrl: string;
  targetElo: number;
  mode: 'default' | 'safe' | 'balanced' | 'aggressive' | 'positional' | 'tactical' | 'creative' | 'inhuman';
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
  language: 'fr' | 'en' | 'auto';  // UI language: auto = detect from browser
  numberOfSuggestions: 1 | 2 | 3;  // Number of suggestions to show (1-3)
}

// NOTE: DEFAULT_SETTINGS has been moved to ./defaults.ts to use environment config

export interface BoardConfig {
  boardElement: HTMLElement;
  isFlipped: boolean;
  playerColor: 'white' | 'black';
}
