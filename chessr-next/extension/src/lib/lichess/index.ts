/**
 * Lichess DOM detection utilities
 * Adapted from old extension lichess-adapter.ts
 */

// Selectors
const MOVE_LIST_SELECTOR = 'rm6, .moves';
const MOVE_SELECTOR = 'kwdb';
const BOARD_SELECTOR = 'cg-board';

/**
 * Detects if a game has started by checking for moves
 */
export function detectGameStarted(): boolean {
  const moveList = document.querySelector(MOVE_LIST_SELECTOR);
  if (!moveList) return false;
  return moveList.querySelectorAll(MOVE_SELECTOR).length > 0;
}

/**
 * Detects the player's color from board orientation
 */
export function detectPlayerColor(): 'white' | 'black' | null {
  // Method 1: cg-wrap orientation class (most reliable)
  const cgWrap = document.querySelector('.cg-wrap');
  if (cgWrap) {
    if (cgWrap.classList.contains('orientation-black')) return 'black';
    if (cgWrap.classList.contains('orientation-white')) return 'white';
  }

  // Method 2: URL color indicator (/gameId/black or /gameId/white)
  const pathParts = window.location.pathname.split('/');
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart === 'black') return 'black';
  if (lastPart === 'white') return 'white';

  // Default to white
  return 'white';
}

/**
 * Detects whose turn it is
 */
export function detectCurrentTurn(): 'white' | 'black' {
  // Method 1: Count moves (most reliable)
  const moveList = document.querySelector(MOVE_LIST_SELECTOR);
  if (moveList) {
    const moves = moveList.querySelectorAll(MOVE_SELECTOR);
    if (moves.length > 0) {
      // Odd number = black's turn, even = white's turn
      return moves.length % 2 === 0 ? 'white' : 'black';
    }
  }

  // Method 2: Running clock
  const runningClock = document.querySelector('.rclock.running');
  if (runningClock) {
    if (runningClock.classList.contains('rclock-white')) return 'white';
    if (runningClock.classList.contains('rclock-black')) return 'black';
  }

  // Method 3: Correspondence turn indicator
  const turnText = document.querySelector('.rclock-turn__text');
  if (turnText) {
    const parentClock = turnText.closest('.rclock');
    if (parentClock) {
      const isBottom = parentClock.classList.contains('rclock-bottom');
      const playerColor = detectPlayerColor();
      return isBottom
        ? (playerColor === 'white' ? 'white' : 'black')
        : (playerColor === 'white' ? 'black' : 'white');
    }
  }

  return 'white';
}

export interface RatingInfo {
  playerRating: number | null;
  opponentRating: number | null;
}

/**
 * Detects player and opponent ratings from DOM
 */
export function detectRatings(): RatingInfo {
  const playersContainer = document.querySelector('.game__meta__players');
  if (!playersContainer) {
    return { playerRating: null, opponentRating: null };
  }

  const whiteRatingEl = playersContainer.querySelector('.player.is.white .rating');
  const blackRatingEl = playersContainer.querySelector('.player.is.black .rating');

  const whiteRating = whiteRatingEl?.textContent?.trim().replace(/[()?\s]/g, '');
  const blackRating = blackRatingEl?.textContent?.trim().replace(/[()?\s]/g, '');

  const playerColor = detectPlayerColor();

  if (playerColor === 'white') {
    return {
      playerRating: whiteRating ? parseInt(whiteRating, 10) : null,
      opponentRating: blackRating ? parseInt(blackRating, 10) : null,
    };
  } else {
    return {
      playerRating: blackRating ? parseInt(blackRating, 10) : null,
      opponentRating: whiteRating ? parseInt(whiteRating, 10) : null,
    };
  }
}

/**
 * Get move list element
 */
export function getMoveListElement(): Element | null {
  return document.querySelector(MOVE_LIST_SELECTOR);
}

/**
 * Get move selector for observation
 */
export function getMoveSelector(): string {
  return MOVE_SELECTOR;
}

/**
 * Extract SAN moves from move list
 */
export function extractMovesFromDOM(): string[] {
  const moveList = document.querySelector(MOVE_LIST_SELECTOR);
  if (!moveList) return [];

  const moveElements = moveList.querySelectorAll(MOVE_SELECTOR);
  const moves: string[] = [];

  for (const el of moveElements) {
    const san = el.textContent?.trim();
    if (san) {
      moves.push(san);
    }
  }

  return moves;
}

/**
 * Get board element
 */
export function getBoardElement(): HTMLElement | null {
  return document.querySelector(BOARD_SELECTOR);
}

/**
 * Check if current page is a game page
 */
export function isGamePage(): boolean {
  const path = window.location.pathname;

  // Exclude non-game pages
  const excluded = [
    '/analysis', '/editor', '/study', '/training', '/broadcast',
    '/tv', '/games', '/player', '/team', '/forum', '/blog', '/learn',
    '/practice', '/coach', '/streamer', '/video', '/opening', '/paste',
    '/patron', '/tournament', '/swiss', '/simul', '/@/',
  ];

  if (excluded.some(p => path.startsWith(p))) return false;

  // Match game URLs: /{8-char-gameId} with optional player ID or color
  return /^\/[a-zA-Z0-9]{8}([a-zA-Z0-9]{4})?(\/?(black|white)?)?$/.test(path);
}
