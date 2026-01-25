import { positionsToFEN } from './position-parser';
import { PlatformAdapter } from './platforms/types';

export class MoveTracker {
  private adapter: PlatformAdapter;
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

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  start(boardElement: HTMLElement, playerColor: 'white' | 'black' = 'white') {
    this.boardElement = boardElement;
    this.playerColor = playerColor;
    console.log('[Chessr:MoveTracker] start() called with playerColor:', playerColor, 'platform:', this.adapter.platform);

    this.observer = new MutationObserver(() => {
      this.onMutation();
    });

    // Find the container to observe - pieces might be in a sibling container
    let observeTarget: HTMLElement = boardElement;

    // Platform-specific observation targets
    if (this.adapter.platform === 'lichess') {
      // Lichess: observe cg-container which contains cg-board with piece elements
      const cgContainer = boardElement.closest('cg-container');
      if (cgContainer) {
        observeTarget = cgContainer as HTMLElement;
      }
    } else {
      // Chess.com: Check for pieces container as sibling
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
    if (!this.boardElement) {
      console.log('[Chessr:MoveTracker] checkForChange - no boardElement');
      return;
    }

    // Get current piece positions from the board
    const currentPositions = this.getPiecePositions();
    const currentPosString = this.positionsToString(currentPositions);
    const lastPosString = this.positionsToString(this.lastPiecePositions);

    console.log('[Chessr:MoveTracker] checkForChange - positions count:', currentPositions.size);

    let detectedMove: string | null = null;

    if (!this.initialized) {
      console.log('[Chessr:MoveTracker] initializing...');
      this.lastPiecePositions = currentPositions;
      this.currentSideToMove = this.detectSideToMoveFromClock();
      this.initialized = true;
    } else if (currentPosString !== lastPosString) {
      // Detect the move in UCI format and which color moved
      const moveInfo = this.detectMoveInfo(this.lastPiecePositions, currentPositions);
      detectedMove = moveInfo.move;

      // Determine next turn: if we know which color moved, opposite is next
      if (moveInfo.movedColor) {
        this.currentSideToMove = moveInfo.movedColor === 'w' ? 'b' : 'w';
      } else {
        // Fallback to clock/DOM detection
        this.currentSideToMove = this.detectSideToMoveFromClock();
      }

      this.lastPiecePositions = currentPositions;
    }

    const fen = positionsToFEN(currentPositions, this.currentSideToMove);
    console.log('[Chessr:MoveTracker] FEN generated:', fen.substring(0, 50) + '...');
    console.log('[Chessr:MoveTracker] lastFEN:', this.lastFEN.substring(0, 50) + '...');
    console.log('[Chessr:MoveTracker] callbacks registered:', this.callbacks.length);

    if (fen !== this.lastFEN) {
      console.log('[Chessr:MoveTracker] FEN changed! Calling', this.callbacks.length, 'callbacks');
      this.lastFEN = fen;
      this.callbacks.forEach(cb => cb(fen));
    }

    // Notify move callbacks if a move was detected
    if (detectedMove) {
      this.moveCallbacks.forEach(cb => cb(detectedMove!));
    }
  }

  private detectSideToMoveFromClock(): 'w' | 'b' {
    return this.adapter.detectSideToMoveFromClock(this.playerColor, this.currentSideToMove);
  }

  private detectMoveInfo(oldPos: Map<string, string>, newPos: Map<string, string>): { move: string | null; movedColor: 'w' | 'b' | null } {
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

    // Fallback: look for any piece that appeared on a new square
    if (!toSquare) {
      for (const [square, piece] of newPos) {
        const oldPiece = oldPos.get(square);
        if (!oldPiece && piece) {
          toSquare = square;
          movedPiece = piece;
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

    const move = (fromSquare && toSquare) ? fromSquare + toSquare : null;
    // Extract color from piece string (e.g., 'wp' -> 'w', 'bk' -> 'b')
    const movedColor = movedPiece ? (movedPiece[0] as 'w' | 'b') : null;

    return { move, movedColor };
  }

  private getPiecePositions(): Map<string, string> {
    if (!this.boardElement) return new Map();
    return this.adapter.getPiecePositions(this.boardElement);
  }

  private positionsToString(positions: Map<string, string>): string {
    const entries = Array.from(positions.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([sq, pc]) => `${sq}:${pc}`).join(',');
  }

  getCurrentFEN(): string {
    return this.lastFEN;
  }

  // Allow external sync of side to move (useful when joining mid-game)
  setSideToMove(side: 'w' | 'b') {
    this.currentSideToMove = side;
    // Re-check with the new side
    if (this.boardElement) {
      const positions = this.getPiecePositions();
      const fen = positionsToFEN(positions, this.currentSideToMove);
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
