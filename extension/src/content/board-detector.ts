import { BoardConfig } from '../shared/types';

// Priority order: prefer the actual board element (wc-chess-board) over containers
const BOARD_SELECTORS = [
  'wc-chess-board',  // Chess.com web component - highest priority
  'chess-board',
  '#board-single',
  '#board-play-computer',
  '#board-vs-personalities',
  '.chessboard',
];

export function detectBoard(): BoardConfig | null {
  // [BoardDetector] detectBoard() called');
  for (const selector of BOARD_SELECTORS) {
    const board = document.querySelector(selector);
    if (board) {
      // [BoardDetector] Board found with selector:', selector);
      // Wait for clock to have color class before returning
      const playerColor = detectPlayerColor();
      // [BoardDetector] Player color detected:', playerColor);
      if (playerColor === null) {
        // Clock not ready yet, return null to retry
        // [BoardDetector] Clock not ready, will retry...');
        return null;
      }
      return parseBoard(board as HTMLElement, playerColor);
    }
  }
  // [BoardDetector] No board found');
  return null;
}

function parseBoard(board: HTMLElement, playerColor: 'white' | 'black'): BoardConfig {
  const isFlipped = playerColor === 'black';

  return {
    boardElement: board,
    isFlipped,
    playerColor,
  };
}

function detectPlayerColor(): 'white' | 'black' | null {
  // Method 1: Check board flipped attribute/class (most reliable on chess.com)
  const board = document.querySelector('wc-chess-board, chess-board, .chessboard');
  // [BoardDetector] Board element:', board);

  if (board) {
    // Check for flipped class on board or parent
    const isFlipped = board.classList.contains('flipped') ||
                      board.closest('.flipped') !== null ||
                      (board as HTMLElement).getAttribute('flipped') === 'true';
    // [BoardDetector] Board flipped:', isFlipped);

    if (isFlipped) {
      // [BoardDetector] Detected: BLACK (board is flipped)');
      return 'black';
    }

    // Check first file coordinate (a) position - on chess.com it's in the bottom-left for white
    const fileCoords = document.querySelectorAll('.coordinate-light, .coordinate-dark, [class*="coords-"]');
    for (const coord of fileCoords) {
      const text = coord.textContent?.trim();
      if (text === '1') {
        const rect = coord.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        const isAtBottom = rect.top > boardRect.top + boardRect.height / 2;
        // [BoardDetector] Rank 1 position - at bottom:', isAtBottom);
        if (isAtBottom) {
          // [BoardDetector] Detected: WHITE (rank 1 at bottom)');
          return 'white';
        } else {
          // [BoardDetector] Detected: BLACK (rank 1 at top)');
          return 'black';
        }
      }
      if (text === '8') {
        const rect = coord.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        const isAtBottom = rect.top > boardRect.top + boardRect.height / 2;
        // [BoardDetector] Rank 8 position - at bottom:', isAtBottom);
        if (isAtBottom) {
          // [BoardDetector] Detected: BLACK (rank 8 at bottom)');
          return 'black';
        } else {
          // [BoardDetector] Detected: WHITE (rank 8 at top)');
          return 'white';
        }
      }
    }
  }

  // Method 2: Check clock color at bottom (works for daily games)
  // On chess.com, the player's clock is at the bottom
  const bottomClock = document.querySelector('.clock-bottom, .clock-component.clock-bottom');
  if (bottomClock) {
    // Check if the bottom clock has white or black class
    if (bottomClock.classList.contains('clock-black')) {
      // [BoardDetector] Detected: BLACK (clock-black at bottom)');
      return 'black';
    }
    if (bottomClock.classList.contains('clock-white')) {
      // [BoardDetector] Detected: WHITE (clock-white at bottom)');
      return 'white';
    }
    // [BoardDetector] Bottom clock found but no color class:', bottomClock.className);
  }

  // Method 3: Check player component for color indicator
  // Note: Skip classes like cc-user-block-white which are UI styles, not piece color indicators
  const bottomPlayer = document.querySelector('.player-component.player-bottom');
  if (bottomPlayer) {
    // Look for specific chess color indicators (not UI style classes)
    const blackIndicator = bottomPlayer.querySelector('.player-black, [class*="piece-black"], .clock-black');
    const whiteIndicator = bottomPlayer.querySelector('.player-white, [class*="piece-white"], .clock-white');
    // [BoardDetector] Bottom player - blackIndicator:', !!blackIndicator, 'whiteIndicator:', !!whiteIndicator);

    if (blackIndicator && !whiteIndicator) {
      // [BoardDetector] Detected: BLACK (player indicator)');
      return 'black';
    }
    if (whiteIndicator && !blackIndicator) {
      // [BoardDetector] Detected: WHITE (player indicator)');
      return 'white';
    }
  }

  // Method 4: Check for daily game specific elements
  // In daily games, check the board-player elements
  const boardPlayers = document.querySelectorAll('[class*="board-player"], .daily-game-player');
  for (const player of boardPlayers) {
    const rect = player.getBoundingClientRect();
    const isAtBottom = rect.top > window.innerHeight / 2;
    const className = player.className;
    // [BoardDetector] Board player at bottom:', isAtBottom, 'class:', className);

    if (isAtBottom) {
      if (className.includes('black')) {
        // [BoardDetector] Detected: BLACK (board-player black at bottom)');
        return 'black';
      }
      if (className.includes('white')) {
        // [BoardDetector] Detected: WHITE (board-player white at bottom)');
        return 'white';
      }
    }
  }

  // Method 5: Check king positions using visual coordinates (most reliable for daily games)
  // The player's king should be on the bottom half of the board
  if (board) {
    const boardRect = board.getBoundingClientRect();
    const boardMiddleY = boardRect.top + boardRect.height / 2;

    // Find kings by their piece classes
    const whiteKing = board.querySelector('.piece.wk, [class*="piece"][class*="wk"]');
    const blackKing = board.querySelector('.piece.bk, [class*="piece"][class*="bk"]');

    if (whiteKing && blackKing) {
      const whiteKingRect = whiteKing.getBoundingClientRect();
      const blackKingRect = blackKing.getBoundingClientRect();

      const whiteKingY = whiteKingRect.top + whiteKingRect.height / 2;
      const blackKingY = blackKingRect.top + blackKingRect.height / 2;

      // [BoardDetector] King positions - whiteKingY:', whiteKingY, 'blackKingY:', blackKingY, 'boardMiddleY:', boardMiddleY);

      // The king closer to the bottom of the screen is the player's king
      if (blackKingY > whiteKingY) {
        // Black king is lower (closer to bottom) -> player is black
        // [BoardDetector] Detected: BLACK (black king is on bottom)');
        return 'black';
      } else {
        // White king is lower (closer to bottom) -> player is white
        // [BoardDetector] Detected: WHITE (white king is on bottom)');
        return 'white';
      }
    } else {
      // [BoardDetector] Could not find both kings - whiteKing:', !!whiteKing, 'blackKing:', !!blackKing);
      // If kings not found, pieces may not be loaded yet - return null to retry
      if (!whiteKing && !blackKing) {
        // [BoardDetector] No kings found, pieces not loaded yet - will retry');
        return null;
      }
    }

    // Fallback: analyze all pieces using visual positions
    const pieces = board.querySelectorAll('[class*="piece"]');
    let blackPiecesBottomCount = 0;
    let whitePiecesBottomCount = 0;

    for (const piece of pieces) {
      const className = piece.className;
      const pieceRect = piece.getBoundingClientRect();
      const pieceY = pieceRect.top + pieceRect.height / 2;
      const isOnBottom = pieceY > boardMiddleY;

      // Check for black pieces (bp, br, bn, bb, bq, bk)
      if (/\bb[prnbqk]\b/.test(className) || className.includes(' b') && /[prnbqk]/.test(className)) {
        if (isOnBottom) blackPiecesBottomCount++;
      }
      // Check for white pieces (wp, wr, wn, wb, wq, wk)
      if (/\bw[prnbqk]\b/.test(className) || className.includes(' w') && /[prnbqk]/.test(className)) {
        if (isOnBottom) whitePiecesBottomCount++;
      }
    }

    // [BoardDetector] Piece visual analysis - blackOnBottom:', blackPiecesBottomCount, 'whiteOnBottom:', whitePiecesBottomCount);

    // If no pieces found at all, return null to retry
    if (blackPiecesBottomCount === 0 && whitePiecesBottomCount === 0) {
      // [BoardDetector] No pieces found in visual analysis - will retry');
      return null;
    }

    if (blackPiecesBottomCount > whitePiecesBottomCount) {
      // [BoardDetector] Detected: BLACK (more black pieces on bottom)');
      return 'black';
    }
    if (whitePiecesBottomCount > blackPiecesBottomCount) {
      // [BoardDetector] Detected: WHITE (more white pieces on bottom)');
      return 'white';
    }
  }

  // Default to white (unflipped board)
  // [BoardDetector] Defaulting to WHITE (no flip detected)');
  return 'white';
}


export function waitForBoard(callback: (config: BoardConfig) => void, maxAttempts = 30): void {
  let attempts = 0;

  const check = () => {
    // [BoardDetector] waitForBoard attempt', attempts + 1, '/', maxAttempts);
    const config = detectBoard();
    if (config) {
      // [BoardDetector] Board ready! Config:', config.playerColor, 'isFlipped:', config.isFlipped);
      callback(config);
      return;
    }

    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(check, 500);
    } else {
      // [BoardDetector] Max attempts reached, board not found');
    }
  };

  // Wait 5 seconds before first detection to let pieces fully load
  // [BoardDetector] Waiting 5s before first detection...');
  setTimeout(check, 5000);
}
