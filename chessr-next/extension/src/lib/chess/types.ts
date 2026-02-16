import type { Move, Square, PieceSymbol, Color } from 'chess.js';

export interface CapturedPieces {
  white: PieceSymbol[]; // Pieces captured BY white (black pieces)
  black: PieceSymbol[]; // Pieces captured BY black (white pieces)
}

export interface ChessState {
  fen: string;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  turn: Color;
  moveNumber: number;
  legalMoves: Move[];
  capturedPieces: CapturedPieces;
  materialBalance: number; // Positive = white ahead, negative = black ahead
}

export type { Move, Square, PieceSymbol, Color };
