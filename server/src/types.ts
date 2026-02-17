// Import new analyze types
import type {
  AnalyzeRequest,
  AnalyzeResultResponse,
  AnalyzeErrorResponse,
  AnalyzeStatsRequest,
  AnalyzeStatsResponse,
  AnalyzeSuggestionsRequest,
  AnalyzeSuggestionsResponse,
} from './analyze-types.js';

// Komodo Dragon Personalities
export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';

// Re-export AnalyzeRequest from analyze-types.ts
export type { AnalyzeRequest, AnalyzeStatsRequest, AnalyzeSuggestionsRequest };

export interface AuthMessage {
  type: 'auth';
  token: string;  // Supabase JWT
  version?: string;  // Client extension version
}

// Import new handlers types
import type { SuggestionRequest } from './handlers/suggestion-handler.js';
import type { AnalyzeRequest as NewAnalyzeRequest } from './handlers/analyze-handler.js';

export type ClientMessage = AnalyzeRequest | AnalyzeStatsRequest | AnalyzeSuggestionsRequest | AuthMessage | SuggestionRequest | NewAnalyzeRequest;

export interface PVLine {
  moves: string[];
  evaluation: number;
  mate?: number;
}

export interface AnalysisResult {
  type: 'result';
  requestId?: string;  // Internal request ID for log correlation
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

export type ServerMessage =
  | AnalyzeResultResponse       // Full analysis response (legacy/combined)
  | AnalyzeStatsResponse        // Stats-only response (accuracy review)
  | AnalyzeSuggestionsResponse  // Suggestions-only response
  | AnalyzeErrorResponse        // Analysis error response
  | InfoUpdate
  | ReadyMessage
  | ErrorMessage
  | VersionErrorMessage
  | AuthSuccessMessage;

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
