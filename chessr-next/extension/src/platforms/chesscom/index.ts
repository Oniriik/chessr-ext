import { Platform } from '../types';
import { detectRoute } from './routes';
import { getMountPoints } from './mounts';

/**
 * Detects if a game has started by checking for the move list element
 */
export function detectGameStarted(): boolean {
  const moveList = document.querySelector(
    '.play-controller-moves, .move-list, [class*="vertical-move-list"]'
  );
  return moveList !== null;
}

/**
 * Detects the player's color based on board orientation and clock position
 */
export function detectPlayerColor(): 'white' | 'black' | null {
  const board = document.querySelector('wc-chess-board, chess-board, .chessboard');
  if (!board) return null;

  // Method 1: Check if board is flipped
  const isFlipped =
    board.classList.contains('flipped') ||
    board.closest('.flipped') !== null ||
    (board as HTMLElement).getAttribute('flipped') === 'true';

  if (isFlipped) return 'black';

  // Method 2: Check bottom clock color
  const bottomClock = document.querySelector('.clock-bottom');
  if (bottomClock) {
    if (bottomClock.classList.contains('clock-black')) return 'black';
    if (bottomClock.classList.contains('clock-white')) return 'white';
  }

  return 'white'; // Default to white if board is not flipped
}

/**
 * Detects whose turn it is based on the active clock
 */
export function detectCurrentTurn(): 'white' | 'black' {
  // Check which clock is active
  const whiteClock = document.querySelector('.clock-white');
  const blackClock = document.querySelector('.clock-black');

  if (whiteClock?.classList.contains('clock-player-turn')) return 'white';
  if (blackClock?.classList.contains('clock-player-turn')) return 'black';

  // Fallback: count moves to determine turn
  const moveList = document.querySelector(
    '.play-controller-moves, .move-list, [class*="vertical-move-list"]'
  );
  if (moveList) {
    const moves = moveList.querySelectorAll('.main-line-ply');
    return moves.length % 2 === 0 ? 'white' : 'black';
  }

  return 'white'; // Default
}

export const chesscom: Platform = {
  id: 'chesscom',
  name: 'Chess.com',
  hostname: /^(www\.)?chess\.com$/,
  detectRoute,
  getMountPoints,
};
