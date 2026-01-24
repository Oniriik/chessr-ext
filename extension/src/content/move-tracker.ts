import { parseBoardToFEN } from './position-parser';

export class MoveTracker {
  private observer: MutationObserver | null = null;
  private boardElement: HTMLElement | null = null;
  private lastFEN = '';
  private lastPiecePositions: Map<string, string> = new Map(); // square -> piece (e.g., 'e2' -> 'wp')
  private currentSideToMove: 'w' | 'b' = 'w';
  private playerColor: 'white' | 'black' = 'white';
  private callbacks: ((fen: string) => void)[] = [];
  private moveCallbacks: ((move: string) => void)[] = [];
  private debounceTimer: number | null = null;
  private initialized = false;

  start(boardElement: HTMLElement, playerColor: 'white' | 'black' = 'white') {
    this.boardElement = boardElement;
    this.playerColor = playerColor;
    // [MoveTracker] Started with player color:', playerColor);

    this.observer = new MutationObserver(() => {
      this.onMutation();
    });

    // Find the container to observe - pieces might be in a sibling container
    let observeTarget: HTMLElement = boardElement;

    // Check for pieces container as sibling
    const parent = boardElement.parentElement;
    if (parent) {
      const piecesContainer = parent.querySelector('.pieces');
      if (piecesContainer) {
        observeTarget = parent as HTMLElement;
      }
    }

    // Also check for board-layout ancestor
    const boardLayout = boardElement.closest('.board-layout-main, .board-layout-component, [class*="board-layout"]');
    if (boardLayout) {
      observeTarget = boardLayout as HTMLElement;
    }

    this.observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    // Wait for board to fully load before parsing initial position
    // This helps when resuming a game where pieces may still be loading
    setTimeout(() => {
      this.checkForChange();
    }, 2000);
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  onPositionChange(callback: (fen: string) => void) {
    this.callbacks.push(callback);
  }

  onMoveDetected(callback: (move: string) => void) {
    this.moveCallbacks.push(callback);
  }

  private onMutation() {
    // Debounce to avoid excessive calls during animations
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.checkForChange();
    }, 100);
  }

  private checkForChange() {
    if (!this.boardElement) return;

    // Get current piece positions from the board
    const currentPositions = this.getPiecePositions();
    const currentPosString = this.positionsToString(currentPositions);
    const lastPosString = this.positionsToString(this.lastPiecePositions);

    let detectedMove: string | null = null;

    if (!this.initialized) {
      this.lastPiecePositions = currentPositions;
      this.currentSideToMove = this.detectSideToMoveFromClock();
      this.initialized = true;
    } else if (currentPosString !== lastPosString) {
      // Detect the move in UCI format
      detectedMove = this.detectMoveUCI(this.lastPiecePositions, currentPositions);

      // Use clock to detect current turn (most reliable)
      const clockTurn = this.detectSideToMoveFromClock();
      this.currentSideToMove = clockTurn;

      this.lastPiecePositions = currentPositions;
    }

    const fen = parseBoardToFEN(this.boardElement, this.currentSideToMove);

    if (fen !== this.lastFEN) {
      this.lastFEN = fen;
      this.callbacks.forEach(cb => cb(fen));
    }

    // Notify move callbacks if a move was detected
    if (detectedMove) {
      this.moveCallbacks.forEach(cb => cb(detectedMove!));
    }
  }

  private detectSideToMoveFromClock(): 'w' | 'b' {
    // Find which clock is active (running)
    const activeClock = document.querySelector('.clock-component.clock-player-turn');

    if (activeClock) {
      // Check if it's the bottom clock (player's clock) or top clock (opponent's clock)
      const isPlayerClock = activeClock.classList.contains('clock-bottom');
      const isOpponentClock = activeClock.classList.contains('clock-top');

      // [MoveTracker] Active clock - isPlayer:', isPlayerClock, 'isOpponent:', isOpponentClock, 'playerColor:', this.playerColor);

      if (isPlayerClock) {
        // Active clock is player's clock = it's player's turn
        const turn = this.playerColor === 'white' ? 'w' : 'b';
        // [MoveTracker] Player clock active, turn:', turn);
        return turn;
      } else if (isOpponentClock) {
        // Active clock is opponent's clock = it's opponent's turn
        const turn = this.playerColor === 'white' ? 'b' : 'w';
        // [MoveTracker] Opponent clock active, turn:', turn);
        return turn;
      }
    }

    // Fallback: return current side
    // [MoveTracker] Fallback to current side:', this.currentSideToMove);
    return this.currentSideToMove;
  }

  private detectMoveUCI(oldPos: Map<string, string>, newPos: Map<string, string>): string | null {
    // Find the "from" square (piece disappeared)
    let fromSquare: string | null = null;
    let movedPiece: string | null = null;

    for (const [square, piece] of oldPos) {
      if (!newPos.has(square) || newPos.get(square) !== piece) {
        // Check if this piece moved (not captured)
        const stillExists = Array.from(newPos.values()).includes(piece);
        if (stillExists || newPos.get(square) !== piece) {
          fromSquare = square;
          movedPiece = piece;
          break;
        }
      }
    }

    // Find the "to" square (piece appeared or changed)
    let toSquare: string | null = null;

    for (const [square, piece] of newPos) {
      const oldPiece = oldPos.get(square);
      if (oldPiece !== piece && piece === movedPiece) {
        toSquare = square;
        break;
      }
    }

    // Handle castling (king moves 2 squares)
    if (fromSquare && toSquare) {
      return fromSquare + toSquare;
    }

    // Fallback: look for any piece that appeared on a new square
    if (!toSquare) {
      for (const [square, piece] of newPos) {
        const oldPiece = oldPos.get(square);
        if (!oldPiece && piece) {
          toSquare = square;
          // Find where this piece came from
          for (const [oldSq, oldP] of oldPos) {
            if (oldP === piece && !newPos.has(oldSq)) {
              fromSquare = oldSq;
              break;
            }
          }
          break;
        }
      }
    }

    if (fromSquare && toSquare) {
      return fromSquare + toSquare;
    }

    return null;
  }

  private getPiecePositions(): Map<string, string> {
    const positions = new Map<string, string>();

    // Find all piece elements on the board
    let pieceElements: Element[] = [];

    if (this.boardElement?.tagName.toLowerCase() === 'wc-chess-board') {
      const shadowRoot = (this.boardElement as any).shadowRoot;
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

        positions.set(square, pieceClass); // e.g., 'e2' -> 'wp'
      }
    });

    return positions;
  }

  private positionsToString(positions: Map<string, string>): string {
    const entries = Array.from(positions.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([sq, pc]) => `${sq}:${pc}`).join(',');
  }

  private detectMovedPieceColor(oldPos: Map<string, string>, newPos: Map<string, string>): 'w' | 'b' | null {
    // Find squares where a piece appeared (the "to" square of a move)
    for (const [square, piece] of newPos) {
      const oldPiece = oldPos.get(square);
      if (oldPiece !== piece) {
        return piece[0] as 'w' | 'b';
      }
    }

    // Fallback: check if a piece disappeared (en passant edge case)
    for (const [square, piece] of oldPos) {
      if (!newPos.has(square)) {
        const capturedColor = piece[0] as 'w' | 'b';
        return capturedColor === 'w' ? 'b' : 'w';
      }
    }

    return null;
  }


  getCurrentFEN(): string {
    return this.lastFEN;
  }

  // Allow external sync of side to move (useful when joining mid-game)
  setSideToMove(side: 'w' | 'b') {
    this.currentSideToMove = side;
    // Re-check with the new side
    if (this.boardElement) {
      const fen = parseBoardToFEN(this.boardElement, this.currentSideToMove);
      if (fen !== this.lastFEN) {
        this.lastFEN = fen;
        this.callbacks.forEach(cb => cb(fen));
      }
    }
  }

  getCurrentSideToMove(): 'w' | 'b' {
    return this.currentSideToMove;
  }

  setPlayerColor(color: 'white' | 'black') {
    // [MoveTracker] Player color updated to:', color);
    this.playerColor = color;
  }
}
