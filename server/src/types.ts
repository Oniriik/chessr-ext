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

export type ClientMessage = AnalyzeRequest;

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

export interface ReadyMessage {
  type: 'ready';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage = AnalysisResult | InfoUpdate | ReadyMessage | ErrorMessage;
