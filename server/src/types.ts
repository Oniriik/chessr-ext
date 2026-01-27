// Komodo Dragon Personalities
export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';

export interface AnalyzeRequest {
  type: 'analyze';
  fen: string;
  moves: string[];  // UCI move history (e.g., ["e2e4", "e7e5", "g1f3"])
  elo: number;
  personality: Personality;
  playerColor: 'w' | 'b';  // Player's color (detected by extension)
  // Deprecated fields (kept for backwards compatibility but ignored):
  searchMode?: 'depth' | 'time';
  depth?: number;
  moveTime?: number;
  multiPV?: number;
}

export interface AuthMessage {
  type: 'auth';
  token: string;  // Supabase JWT
  version?: string;  // Client extension version
}

export type ClientMessage = AnalyzeRequest | AuthMessage;

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

export interface InfoUpdate {
  type: 'info';
  depth: number;
  evaluation: number;
  mate?: number;
}

export interface VersionInfo {
  minVersion: string;
  downloadUrl?: string;
}

export interface ReadyMessage {
  type: 'ready';
  version: VersionInfo;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface VersionErrorMessage {
  type: 'version_error';
  minVersion: string;
  downloadUrl?: string;
}

export interface AuthSuccessMessage {
  type: 'auth_success';
  user: {
    id: string;
    email: string;
  };
}

export type ServerMessage = AnalysisResult | InfoUpdate | ReadyMessage | ErrorMessage | VersionErrorMessage | AuthSuccessMessage;

// User tracking
export interface UserInfo {
  id: string;
  email: string;
  connectedAt: string;
  authenticated: boolean;
}

// Metrics
export interface MetricsResponse {
  connectedClients: number;
  authenticatedUsers: number;
  enginePool: {
    total: number;
    available: number;
    queued: number;
  };
  users: Array<{
    id: string;
    email: string;
    connectedAt: string;
    connections?: number;  // Number of active connections for this user
  }>;
  suggestionsCount: number;
  serverUptime: number;
  systemResources: {
    cpuUsage: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

// Game analysis types
export type MoveClassification = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveAnalysis {
  moveNumber: number;
  move: string;
  isPlayerMove: boolean;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
  cpl: number;
  classification: MoveClassification;
}

export interface GameAnalysisResult {
  type: 'game_analysis';
  acpl: number;
  estimatedElo: number;
  totalMoves: number;
  moveAnalysis: MoveAnalysis[];
  accuracy: number;
}
