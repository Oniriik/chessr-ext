export interface AnalyzeRequest {
  type: 'analyze';
  fen: string;
  searchMode: 'depth' | 'time';
  depth: number;
  moveTime: number;  // milliseconds
  elo: number;
  mode: 'safe' | 'balanced' | 'aggressive' | 'blitz' | 'positional' | 'tactical';
  multiPV: number;
}

export interface AuthMessage {
  type: 'auth';
  token: string;  // Supabase JWT
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

export interface AuthSuccessMessage {
  type: 'auth_success';
  user: {
    id: string;
    email: string;
  };
}

export type ServerMessage = AnalysisResult | InfoUpdate | ReadyMessage | ErrorMessage | AuthSuccessMessage;

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
  stockfishPool: {
    total: number;
    available: number;
    queued: number;
  };
  users: Array<{
    id: string;
    email: string;
    connectedAt: string;
  }>;
}
