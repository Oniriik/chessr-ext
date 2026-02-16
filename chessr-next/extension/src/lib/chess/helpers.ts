import { Chess, PieceSymbol } from 'chess.js';
import type { CapturedPieces, ChessState } from './types';

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

/**
 * Calculate captured pieces from move history
 */
export function calculateCapturedPieces(chess: Chess): CapturedPieces {
  const history = chess.history({ verbose: true });
  const captured: CapturedPieces = { white: [], black: [] };

  for (const move of history) {
    if (move.captured) {
      if (move.color === 'w') {
        captured.white.push(move.captured);
      } else {
        captured.black.push(move.captured);
      }
    }
  }

  return captured;
}

/**
 * Calculate material balance (positive = white ahead)
 */
export function calculateMaterialBalance(captured: CapturedPieces): number {
  const whiteCaptures = captured.white.reduce((sum, p) => sum + PIECE_VALUES[p], 0);
  const blackCaptures = captured.black.reduce((sum, p) => sum + PIECE_VALUES[p], 0);
  return whiteCaptures - blackCaptures;
}

/**
 * Get complete chess state from a Chess instance
 */
export function getChessState(chess: Chess | null): ChessState | null {
  if (!chess) return null;

  const capturedPieces = calculateCapturedPieces(chess);

  return {
    fen: chess.fen(),
    isCheck: chess.isCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    isDraw: chess.isDraw(),
    isGameOver: chess.isGameOver(),
    turn: chess.turn(),
    moveNumber: Math.ceil(chess.history().length / 2),
    legalMoves: chess.moves({ verbose: true }),
    capturedPieces,
    materialBalance: calculateMaterialBalance(capturedPieces),
  };
}

/**
 * Replay moves on a new Chess instance and return it
 * Returns null if any move fails
 */
export function replayMoves(moves: string[]): Chess | null {
  const chess = new Chess();

  for (const san of moves) {
    try {
      const result = chess.move(san);
      if (!result) {
        console.warn('[chess] Invalid move:', san);
        return null;
      }
    } catch (error) {
      console.warn('[chess] Failed to apply move:', san, error);
      return null;
    }
  }

  return chess;
}
