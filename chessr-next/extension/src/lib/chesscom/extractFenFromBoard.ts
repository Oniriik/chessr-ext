/**
 * Extract FEN position from Chess.com board DOM
 * Specific to Chess.com puzzle pages
 */

import { logger } from '../logger';

// Mapping DOM piece classes to FEN characters
const PIECE_MAP: Record<string, string> = {
  wp: 'P', wn: 'N', wb: 'B', wr: 'R', wq: 'Q', wk: 'K',
  bp: 'p', bn: 'n', bb: 'b', br: 'r', bq: 'q', bk: 'k',
};

/**
 * Extract the current position FEN from the Chess.com board DOM
 * @returns FEN string or null if board not found
 */
export function extractFenFromBoard(): string | null {
  const board = document.querySelector('wc-chess-board');
  if (!board) return null;

  // Initialize empty 8x8 board (row 0 = rank 8, row 7 = rank 1)
  const squares: (string | null)[][] = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  // Parse each piece element
  board.querySelectorAll('.piece').forEach((el) => {
    const classes = el.className.split(' ');

    // Find piece type (wp, bk, etc.)
    const pieceClass = classes.find((c) => PIECE_MAP[c]);
    if (!pieceClass) return;

    // Find square position (square-XY where X=file 1-8, Y=rank 1-8)
    const squareClass = classes.find((c) => c.startsWith('square-'));
    if (!squareClass) return;

    const squareNum = squareClass.replace('square-', '');
    if (squareNum.length < 2) return;

    const file = parseInt(squareNum[0], 10) - 1; // 0-7 (a-h)
    const rank = parseInt(squareNum[1], 10) - 1; // 0-7 (1-8)

    if (file < 0 || file > 7 || rank < 0 || rank > 7) return;

    // Convert to array indices (row 0 = rank 8)
    squares[7 - rank][file] = PIECE_MAP[pieceClass];
  });

  // Build FEN position string
  const fenRows = squares.map((row) => {
    let fenRow = '';
    let emptyCount = 0;

    for (const sq of row) {
      if (sq) {
        if (emptyCount > 0) {
          fenRow += emptyCount;
          emptyCount = 0;
        }
        fenRow += sq;
      } else {
        emptyCount++;
      }
    }

    if (emptyCount > 0) {
      fenRow += emptyCount;
    }

    return fenRow;
  });

  // Determine whose turn it is
  const turn = detectTurnFromDOM();

  // Build complete FEN (no castling/en passant tracking for puzzles)
  return `${fenRows.join('/')} ${turn} - - 0 1`;
}

/**
 * Detect whose turn it is from the DOM
 * In puzzles, the heading says "white to move" or "black to move"
 */
function detectTurnFromDOM(): 'w' | 'b' {
  // Method 1: Learning puzzles - heading with data-cy attribute
  const heading = document.querySelector('[data-cy="to-move-section-heading"]');
  if (heading) {
    const text = heading.textContent?.toLowerCase() || '';
    logger.log(`[fen-extract] Turn detection (learning): heading="${text.trim()}"`);

    if (text.includes('white')) {
      logger.log(`[fen-extract] Detected: white's turn`);
      return 'w';
    }
    if (text.includes('black')) {
      logger.log(`[fen-extract] Detected: black's turn`);
      return 'b';
    }
  }

  // Method 2: Rated puzzles - coach feedback element with color class
  const coachFeedback = document.querySelector('.cc-coach-feedback-detail-colorToMove');
  if (coachFeedback) {
    logger.log(`[fen-extract] Turn detection (rated): classes="${coachFeedback.className}"`);

    if (coachFeedback.classList.contains('cc-coach-feedback-detail-white-to-move')) {
      logger.log(`[fen-extract] Detected: white's turn`);
      return 'w';
    }
    if (coachFeedback.classList.contains('cc-coach-feedback-detail-black-to-move')) {
      logger.log(`[fen-extract] Detected: black's turn`);
      return 'b';
    }
  }

  // Method 3: Daily puzzles - message color indicator
  const dailyIndicator = document.querySelector('.message-color-to-move-square');
  if (dailyIndicator) {
    logger.log(`[fen-extract] Turn detection (daily): classes="${dailyIndicator.className}"`);

    if (dailyIndicator.classList.contains('message-color-to-move-white')) {
      logger.log(`[fen-extract] Detected: white's turn`);
      return 'w';
    }
    if (dailyIndicator.classList.contains('message-color-to-move-black')) {
      logger.log(`[fen-extract] Detected: black's turn`);
      return 'b';
    }
  }

  // Method 4: Puzzle rush - section heading with color class
  const rushHeading = document.querySelector('.section-heading-component');
  if (rushHeading) {
    logger.log(`[fen-extract] Turn detection (rush): classes="${rushHeading.className}"`);

    if (rushHeading.classList.contains('section-heading-lightGrey')) {
      logger.log(`[fen-extract] Detected: white's turn`);
      return 'w';
    }
    if (rushHeading.classList.contains('section-heading-black')) {
      logger.log(`[fen-extract] Detected: black's turn`);
      return 'b';
    }
  }

  // Fallback: assume white's turn
  logger.log(`[fen-extract] No turn indicator found, assuming white's turn`);
  return 'w';
}

/**
 * Get the player's color from the DOM
 */
export function getPlayerColorFromDOM(): 'white' | 'black' | null {
  // Method 1: Learning puzzles - sidebar status square
  const statusSquare = document.querySelector('.sidebar-status-square-sidebar-square');
  if (statusSquare) {
    const color = statusSquare.classList.contains('sidebar-status-square-black') ? 'black' : 'white';
    logger.log(`[fen-extract] Player color from sidebar: ${color}`);
    return color;
  }

  // Method 2: Rated puzzles - detect from coach feedback color indicator
  // In rated puzzles, the player always moves first, so the "to move" color IS the player's color
  const coachFeedback = document.querySelector('.cc-coach-feedback-detail-colorToMove');
  if (coachFeedback) {
    const isWhite = coachFeedback.classList.contains('cc-coach-feedback-detail-white-to-move');
    const color = isWhite ? 'white' : 'black';
    logger.log(`[fen-extract] Player color from coach feedback: ${color}`);
    return color;
  }

  // Method 3: Daily puzzles - message color indicator
  // Player moves first, so the "to move" color IS the player's color
  const dailyIndicator = document.querySelector('.message-color-to-move-square');
  if (dailyIndicator) {
    const isWhite = dailyIndicator.classList.contains('message-color-to-move-white');
    const color = isWhite ? 'white' : 'black';
    logger.log(`[fen-extract] Player color from daily indicator: ${color}`);
    return color;
  }

  // Method 4: Puzzle rush - section heading with color class
  // Player moves first, so the "to move" color IS the player's color
  const rushHeading = document.querySelector('.section-heading-component');
  if (rushHeading) {
    const isWhite = rushHeading.classList.contains('section-heading-lightGrey');
    const color = isWhite ? 'white' : 'black';
    logger.log(`[fen-extract] Player color from rush heading: ${color}`);
    return color;
  }

  // Method 5: Fallback to board orientation
  const board = document.querySelector('wc-chess-board');
  if (board) {
    const isFlipped = board.classList.contains('flipped');
    const color = isFlipped ? 'black' : 'white';
    logger.log(`[fen-extract] Player color from board flip: ${color}`);
    return color;
  }

  return null;
}

/**
 * Check if it's currently the player's turn
 */
export function isPlayerTurn(): boolean {
  const heading = document.querySelector('[data-cy="to-move-section-heading"]');
  if (!heading) return false;

  const text = heading.textContent?.toLowerCase() || '';
  return text.includes('your') || text.includes('ton') || text.includes('tu');
}
