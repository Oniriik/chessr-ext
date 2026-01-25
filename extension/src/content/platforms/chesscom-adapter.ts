import { BoardConfig } from '../../shared/types';
import { Platform, PlatformAdapter } from './types';

const BOARD_SELECTORS = [
  'wc-chess-board',
  'chess-board',
  '#board-single',
  '#board-play-computer',
  '#board-vs-personalities',
  '.chessboard',
];

export class ChesscomAdapter implements PlatformAdapter {
  readonly platform: Platform = 'chesscom';

  detectBoard(): BoardConfig | null {
    for (const selector of BOARD_SELECTORS) {
      const board = document.querySelector(selector);
      if (board) {
        const playerColor = this.detectPlayerColor();
        if (playerColor === null) {
          return null;
        }
        return {
          boardElement: board as HTMLElement,
          isFlipped: playerColor === 'black',
          playerColor,
        };
      }
    }
    return null;
  }

  waitForBoard(callback: (config: BoardConfig) => void, maxAttempts = 30): void {
    let attempts = 0;

    const check = () => {
      const config = this.detectBoard();
      if (config) {
        callback(config);
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(check, 500);
      }
    };

    // Wait 5 seconds before first detection to let pieces fully load
    setTimeout(check, 5000);
  }

  private detectPlayerColor(): 'white' | 'black' | null {
    const board = document.querySelector('wc-chess-board, chess-board, .chessboard');

    if (board) {
      // Check for flipped class on board or parent
      const isFlipped = board.classList.contains('flipped') ||
                        board.closest('.flipped') !== null ||
                        (board as HTMLElement).getAttribute('flipped') === 'true';

      if (isFlipped) {
        return 'black';
      }

      // Check coordinate positions
      const fileCoords = document.querySelectorAll('.coordinate-light, .coordinate-dark, [class*="coords-"]');
      for (const coord of fileCoords) {
        const text = coord.textContent?.trim();
        if (text === '1') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          const isAtBottom = rect.top > boardRect.top + boardRect.height / 2;
          return isAtBottom ? 'white' : 'black';
        }
        if (text === '8') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          const isAtBottom = rect.top > boardRect.top + boardRect.height / 2;
          return isAtBottom ? 'black' : 'white';
        }
      }
    }

    // Check clock color at bottom
    const bottomClock = document.querySelector('.clock-bottom, .clock-component.clock-bottom');
    if (bottomClock) {
      if (bottomClock.classList.contains('clock-black')) {
        return 'black';
      }
      if (bottomClock.classList.contains('clock-white')) {
        return 'white';
      }
    }

    // Check player component
    const bottomPlayer = document.querySelector('.player-component.player-bottom');
    if (bottomPlayer) {
      const blackIndicator = bottomPlayer.querySelector('.player-black, [class*="piece-black"], .clock-black');
      const whiteIndicator = bottomPlayer.querySelector('.player-white, [class*="piece-white"], .clock-white');

      if (blackIndicator && !whiteIndicator) {
        return 'black';
      }
      if (whiteIndicator && !blackIndicator) {
        return 'white';
      }
    }

    // Check daily game specific elements
    const boardPlayers = document.querySelectorAll('[class*="board-player"], .daily-game-player');
    for (const player of boardPlayers) {
      const rect = player.getBoundingClientRect();
      const isAtBottom = rect.top > window.innerHeight / 2;
      const className = player.className;

      if (isAtBottom) {
        if (className.includes('black')) {
          return 'black';
        }
        if (className.includes('white')) {
          return 'white';
        }
      }
    }

    // Check king positions
    if (board) {
      const boardRect = board.getBoundingClientRect();
      const whiteKing = board.querySelector('.piece.wk, [class*="piece"][class*="wk"]');
      const blackKing = board.querySelector('.piece.bk, [class*="piece"][class*="bk"]');

      if (whiteKing && blackKing) {
        const whiteKingRect = whiteKing.getBoundingClientRect();
        const blackKingRect = blackKing.getBoundingClientRect();
        const whiteKingY = whiteKingRect.top + whiteKingRect.height / 2;
        const blackKingY = blackKingRect.top + blackKingRect.height / 2;

        return blackKingY > whiteKingY ? 'black' : 'white';
      }

      if (!whiteKing && !blackKing) {
        return null;
      }

      // Fallback: analyze all pieces
      const pieces = board.querySelectorAll('[class*="piece"]');
      const boardMiddleY = boardRect.top + boardRect.height / 2;
      let blackPiecesBottomCount = 0;
      let whitePiecesBottomCount = 0;

      for (const piece of pieces) {
        const className = piece.className;
        const pieceRect = piece.getBoundingClientRect();
        const pieceY = pieceRect.top + pieceRect.height / 2;
        const isOnBottom = pieceY > boardMiddleY;

        if (/\bb[prnbqk]\b/.test(className) || className.includes(' b') && /[prnbqk]/.test(className)) {
          if (isOnBottom) blackPiecesBottomCount++;
        }
        if (/\bw[prnbqk]\b/.test(className) || className.includes(' w') && /[prnbqk]/.test(className)) {
          if (isOnBottom) whitePiecesBottomCount++;
        }
      }

      if (blackPiecesBottomCount === 0 && whitePiecesBottomCount === 0) {
        return null;
      }

      if (blackPiecesBottomCount > whitePiecesBottomCount) {
        return 'black';
      }
      if (whitePiecesBottomCount > blackPiecesBottomCount) {
        return 'white';
      }
    }

    return 'white';
  }

  getPiecePositions(boardElement: HTMLElement): Map<string, string> {
    const positions = new Map<string, string>();
    let pieceElements: Element[] = [];

    if (boardElement.tagName.toLowerCase() === 'wc-chess-board') {
      const shadowRoot = (boardElement as any).shadowRoot;
      if (shadowRoot) {
        pieceElements = Array.from(shadowRoot.querySelectorAll('.piece'));
      }
    }

    if (pieceElements.length === 0) {
      pieceElements = Array.from(document.querySelectorAll('.piece'));
    }

    pieceElements.forEach((el) => {
      const classList = Array.from(el.classList);
      const pieceClass = classList.find(c => /^[wb][prnbqk]$/.test(c));
      const squareClass = classList.find(c => c.startsWith('square-'));

      if (pieceClass && squareClass) {
        const squareNum = parseInt(squareClass.replace('square-', ''));
        const file = Math.floor(squareNum / 10) - 1;
        const rank = (squareNum % 10) - 1;
        const square = String.fromCharCode(97 + file) + (rank + 1);
        positions.set(square, pieceClass);
      }
    });

    return positions;
  }

  detectSideToMoveFromClock(playerColor: 'white' | 'black', currentSide: 'w' | 'b'): 'w' | 'b' {
    // Method 1: Clock-based detection (live/blitz games)
    const activeClock = document.querySelector('.clock-component.clock-player-turn');

    if (activeClock) {
      const isPlayerClock = activeClock.classList.contains('clock-bottom');
      const isOpponentClock = activeClock.classList.contains('clock-top');

      if (isPlayerClock) {
        return playerColor === 'white' ? 'w' : 'b';
      } else if (isOpponentClock) {
        return playerColor === 'white' ? 'b' : 'w';
      }
    }

    // Method 2: Check move list (bot games without clock)
    // Count moves to determine turn - odd ply = black's turn, even ply = white's turn
    const moves = document.querySelectorAll('.move-node, [data-ply]');
    if (moves.length > 0) {
      const lastMove = moves[moves.length - 1];
      const ply = lastMove.getAttribute('data-ply');
      if (ply) {
        const plyNum = parseInt(ply, 10);
        return plyNum % 2 === 0 ? 'w' : 'b';
      }
      return moves.length % 2 === 0 ? 'w' : 'b';
    }

    return currentSide;
  }

  isAllowedPage(): boolean {
    const path = window.location.pathname;
    // Support: /game/123, /game/live/123, /game/daily/123, /play/computer
    return /^\/game\/(live\/|daily\/)?\d+/.test(path) || path === '/play/computer';
  }

  isAnalysisDisabledPage(): boolean {
    const url = window.location.href;
    return url.includes('/review') || url.includes('/analysis');
  }

  getSquareSize(boardElement: HTMLElement): number {
    const pieces = document.querySelectorAll('.piece');
    if (pieces.length === 0) return 0;

    const firstPiece = pieces[0] as HTMLElement;
    const pieceRect = firstPiece.getBoundingClientRect();
    return pieceRect.width;
  }

  getBoardOrigin(boardElement: HTMLElement, squareSize: number, isFlipped: boolean): { x: number; y: number } {
    const pieces = document.querySelectorAll('.piece');
    const boardRect = boardElement.getBoundingClientRect();

    for (const piece of pieces) {
      const classList = Array.from(piece.classList);
      const squareClass = classList.find(c => c.startsWith('square-'));
      if (!squareClass) continue;

      const squareNum = parseInt(squareClass.replace('square-', ''));
      const fileNum = Math.floor(squareNum / 10) - 1;
      const rankNum = (squareNum % 10) - 1;

      const pRect = piece.getBoundingClientRect();
      const pieceX = pRect.left - boardRect.left;
      const pieceY = pRect.top - boardRect.top;

      if (isFlipped) {
        return {
          x: pieceX - (7 - fileNum) * squareSize,
          y: pieceY - rankNum * squareSize,
        };
      } else {
        return {
          x: pieceX - fileNum * squareSize,
          y: pieceY - (7 - rankNum) * squareSize,
        };
      }
    }

    return { x: 0, y: 0 };
  }
}
