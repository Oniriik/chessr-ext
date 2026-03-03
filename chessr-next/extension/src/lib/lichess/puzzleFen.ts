/**
 * Lichess puzzle FEN extraction & detection utilities
 * Supports training/streak (move list replay) and storm (DOM piece parsing)
 */

import { Chess } from 'chess.js';
import { logger } from '../logger';

// Piece class name to FEN character mapping
const PIECE_MAP: Record<string, Record<string, string>> = {
  white: { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' },
  black: { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' },
};

/**
 * Extract FEN - tries move list replay first (training/streak),
 * falls back to DOM piece parsing (storm)
 */
export function extractFenFromBoard(): string | null {
  return extractFenFromMoveList() ?? extractFenFromPieces();
}

/**
 * Extract FEN by replaying the move list from .puzzle__moves (training/streak)
 */
function extractFenFromMoveList(): string | null {
  const movesContainer = document.querySelector('.puzzle__moves .tview2');
  if (!movesContainer) return null;

  const moveElements = movesContainer.querySelectorAll('move');
  if (moveElements.length === 0) return null;

  // Collect SAN moves up to and including the active move (current board position)
  const moves: string[] = [];
  for (const el of moveElements) {
    const raw = el.textContent?.trim();
    if (!raw) continue;
    // Strip Lichess annotations (✓, ✗, ?, !, etc.) appended after the SAN move
    const san = raw.replace(/[✓✗?!]+$/, '').trim();
    if (!san) continue;
    moves.push(san);
    if (el.classList.contains('active')) break;
  }

  if (moves.length === 0) return null;

  try {
    const chess = new Chess();
    for (const san of moves) {
      const result = chess.move(san);
      if (!result) {
        logger.log(`[lichess-puzzle] Invalid move: ${san}, moves so far: ${moves.join(' ')}`);
        return null;
      }
    }
    const fen = chess.fen();
    logger.log(`[lichess-puzzle] FEN from move replay (${moves.length} moves): ${fen}`);
    return fen;
  } catch (e) {
    logger.log(`[lichess-puzzle] Error replaying moves: ${e}`);
    return null;
  }
}

/**
 * Parse transform: translate(Xpx, Ypx) to coordinates
 */
function parseTranslate(style: string): { x: number; y: number } | null {
  const match = style.match(/translate\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/);
  if (!match) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

/**
 * Extract FEN by parsing piece positions from cg-board DOM (storm)
 */
function extractFenFromPieces(): string | null {
  const board = document.querySelector('cg-board') as HTMLElement | null;
  if (!board) return null;

  const container = board.closest('cg-container') as HTMLElement | null;
  if (!container) return null;

  const boardWidth = container.clientWidth;
  if (boardWidth === 0) return null;
  const squareSize = boardWidth / 8;

  const cgWrap = board.closest('.cg-wrap');
  const flipped = cgWrap?.classList.contains('orientation-black') ?? false;

  // Initialize empty 8x8 board (index 0 = rank 8, index 7 = rank 1)
  const squares: (string | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));

  board.querySelectorAll('piece:not(.ghost)').forEach((el) => {
    const classes = el.className.split(/\s+/);
    let color: string | null = null;
    let pieceType: string | null = null;

    for (const cls of classes) {
      if (cls === 'white' || cls === 'black') color = cls;
      if (PIECE_MAP.white[cls]) pieceType = cls;
    }

    if (!color || !pieceType) return;

    const fenChar = PIECE_MAP[color][pieceType];
    if (!fenChar) return;

    const style = (el as HTMLElement).style.cssText || (el as HTMLElement).getAttribute('style') || '';
    const coords = parseTranslate(style);
    if (!coords) return;

    let file = Math.round(coords.x / squareSize);
    let row = Math.round(coords.y / squareSize);

    if (flipped) {
      file = 7 - file;
      row = 7 - row;
    }

    if (file < 0 || file > 7 || row < 0 || row > 7) return;

    squares[row][file] = fenChar;
  });

  // Build FEN position string
  const fenRows = squares.map((row) => {
    let fenRow = '';
    let emptyCount = 0;
    for (const sq of row) {
      if (sq) {
        if (emptyCount > 0) { fenRow += emptyCount; emptyCount = 0; }
        fenRow += sq;
      } else {
        emptyCount++;
      }
    }
    if (emptyCount > 0) fenRow += emptyCount;
    return fenRow;
  });

  // Turn = player's color (it's always the player's turn in storm)
  const turn = flipped ? 'b' : 'w';

  // Infer castling from king/rook starting positions
  const castling = inferCastlingRights(squares);

  const fen = `${fenRows.join('/')} ${turn} ${castling} - 0 1`;
  logger.log(`[lichess-puzzle] FEN from DOM pieces: ${fen}`);
  return fen;
}

/**
 * Infer castling rights based on king/rook positions on starting squares
 */
function inferCastlingRights(squares: (string | null)[][]): string {
  let rights = '';
  // White king on e1 (row 7, file 4)
  if (squares[7][4] === 'K') {
    if (squares[7][7] === 'R') rights += 'K';
    if (squares[7][0] === 'R') rights += 'Q';
  }
  // Black king on e8 (row 0, file 4)
  if (squares[0][4] === 'k') {
    if (squares[0][7] === 'r') rights += 'k';
    if (squares[0][0] === 'r') rights += 'q';
  }
  return rights || '-';
}

/**
 * Get the player's color from the board orientation
 * Works for both training/streak (.puzzle__board) and storm (.puz-board)
 */
export function getPlayerColorFromDOM(): 'white' | 'black' | null {
  const cgWrap = document.querySelector('.puzzle__board .cg-wrap, .puz-board .cg-wrap');
  if (!cgWrap) return null;
  if (cgWrap.classList.contains('orientation-black')) return 'black';
  if (cgWrap.classList.contains('orientation-white')) return 'white';
  return null;
}

/**
 * Detect if a puzzle is currently active
 * Training/streak: active unless completed (.after)
 * Storm: active when in play mode
 */
export function detectPuzzleStarted(): boolean {
  // Training/streak
  const feedback = document.querySelector('.puzzle__feedback');
  if (feedback) {
    return !feedback.classList.contains('after');
  }
  // Storm/Racer: active when in play mode
  return !!document.querySelector('.storm--play, .racer--play');
}

/**
 * Detect if the puzzle has been solved/failed or the storm/racer has ended
 */
export function detectPuzzleSolved(): boolean {
  // Training/streak
  const feedback = document.querySelector('.puzzle__feedback');
  if (feedback) {
    return feedback.classList.contains('after');
  }
  // Storm/Racer: ended
  return !!document.querySelector('.storm--end, .racer--end');
}
