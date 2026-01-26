export interface AnalyzeRequest {
  type: 'analyze';
  fen: string;
  moves: string[];  // UCI move history (e.g., ["e2e4", "e7e5", "g1f3"])
  searchMode: 'depth' | 'time';
  depth: number;
  moveTime: number;  // milliseconds
  elo: number;
  mode: 'default' | 'safe' | 'balanced' | 'aggressive' | 'positional' | 'tactical' | 'creative' | 'inhuman';
  multiPV: number;
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
