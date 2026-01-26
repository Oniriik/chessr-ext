import { positionsToFEN } from "./position-parser";
import { PlatformAdapter } from "./platforms/types";

export class MoveTracker {
  private adapter: PlatformAdapter;
  private observer: MutationObserver | null = null;
  private clockObserver: MutationObserver | null = null;
  private boardElement: HTMLElement | null = null;
  private lastFEN = "";
  private lastPiecePositions: Map<string, string> = new Map(); // square -> piece (e.g., 'e2' -> 'wp')
  private currentSideToMove: "w" | "b" = "w";
  private playerColor: "white" | "black" = "white";
  private callbacks: ((fen: string) => void)[] = [];
  private moveCallbacks: ((move: string) => void)[] = [];
  private debounceTimer: number | null = null;
  private initialized = false;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  start(boardElement: HTMLElement, playerColor: "white" | "black" = "white") {
    this.boardElement = boardElement;
    this.playerColor = playerColor;

    this.observer = new MutationObserver(() => {
      console.log("mutation pieces");
      this.onMutation();
    });

    // Find the container to observe - pieces might be in a sibling container
    let observeTarget: HTMLElement = boardElement;

    // Platform-specific observation targets
    if (this.adapter.platform === "lichess") {
      // Lichess: observe cg-container which contains cg-board with piece elements
      const cgContainer = boardElement.closest("cg-container");
      if (cgContainer) {
        observeTarget = cgContainer as HTMLElement;
      }
    } else {
      // Chess.com: Check for pieces container as sibling
      const parent = boardElement.parentElement;
      if (parent) {
        const piecesContainer = parent.querySelector(".pieces");
        if (piecesContainer) {
          observeTarget = parent as HTMLElement;
        }
      }

      // Also check for board-layout ancestor
      const boardLayout = boardElement.closest(
        '.board-layout-main, .board-layout-component, [class*="board-layout"]',
      );
      if (boardLayout) {
        observeTarget = boardLayout as HTMLElement;
      }
    }

    this.observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Set up clock observer to detect turn changes quickly
    this.setupClockObserver();

    // Wait for board to fully load before parsing initial position
    // This helps when resuming a game where pieces may still be loading
    setTimeout(() => {
      this.checkForChange();
    }, 500);
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.clockObserver) {
      this.clockObserver.disconnect();
      this.clockObserver = null;
    }
  }

  private setupClockObserver() {
    // Watch for clock changes to detect turn switches
    const clocks = document.querySelectorAll(".clock-component, .rclock");
    if (clocks.length === 0) return;

    this.clockObserver = new MutationObserver(() => {
      console.log("clock mutation");
      this.onMutation();
    });

    clocks.forEach((clock) => {
      this.clockObserver!.observe(clock, {
        attributes: true,
        attributeFilter: ["class"],
      });
    });
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
      // Don't check if a piece is being dragged
      if (this.isPieceDragging()) {
        return;
      }
      console.log("check for change timer");
      this.checkForChange();
    }, 200);
  }

  private isPieceDragging(): boolean {
    // Check for common dragging class names
    const draggingPiece = document.querySelector(
      ".piece.dragging, .piece.drag, .dragging, .drag, .moving",
    );
    console.log("draggingPiece", draggingPiece);
    return draggingPiece !== null;
  }

  private async checkForChange() {
    console.log("check for change");
    if (!this.boardElement) {
      return;
    }

    // Get current piece positions from the board
    const currentPositions = this.getPiecePositions();
    const currentPosString = this.positionsToString(currentPositions);
    const lastPosString = this.positionsToString(this.lastPiecePositions);

    let detectedMove: string | null = null;
    let positionsChanged = currentPosString !== lastPosString;

    if (!this.initialized) {
      this.lastPiecePositions = currentPositions;
      this.currentSideToMove = await this.detectSideToMoveFromClock();
      this.initialized = true;
    } else if (positionsChanged) {
      // Detect the move in UCI format and which color moved
      const moveInfo = this.detectMoveInfo(
        this.lastPiecePositions,
        currentPositions,
      );
      detectedMove = moveInfo.move;
      // Determine next turn: if we know which color moved, opposite is next
      if (moveInfo.movedColor) {
        this.currentSideToMove = moveInfo.movedColor === "w" ? "b" : "w";

        // If current player moved, mark it (for Chess.com initial detection)
        const playerColorCode = this.playerColor === "white" ? "w" : "b";
        if (
          moveInfo.movedColor === playerColorCode &&
          this.adapter.platform === "chesscom"
        ) {
          (this.adapter as any).markCurrentPlayerMoved?.();
        }
      } else {
        // Fallback to clock/DOM detection
        this.currentSideToMove = await this.detectSideToMoveFromClock();
      }

      this.lastPiecePositions = currentPositions;
    } else {
      // No position change detected, but check if turn changed via clock
      const clockSide = await this.detectSideToMoveFromClock();
      if (clockSide !== this.currentSideToMove) {
        console.log("Turn changed via clock without position change");
        this.currentSideToMove = clockSide;
      }
    }

    const fen = positionsToFEN(currentPositions, this.currentSideToMove);

    if (fen !== this.lastFEN) {
      this.lastFEN = fen;
      this.callbacks.forEach((cb) => cb(fen));
    }

    // Notify move callbacks if a move was detected
    if (detectedMove) {
      this.moveCallbacks.forEach((cb) => cb(detectedMove!));
    }
  }

  private async detectSideToMoveFromClock(): Promise<"w" | "b"> {
    return await this.adapter.detectSideToMoveFromClock(
      this.playerColor,
      this.currentSideToMove,
    );
  }

  private detectMoveInfo(
    oldPos: Map<string, string>,
    newPos: Map<string, string>,
  ): { move: string | null; movedColor: "w" | "b" | null } {
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

    const move = fromSquare && toSquare ? fromSquare + toSquare : null;
    // Extract color from piece string (e.g., 'wp' -> 'w', 'bk' -> 'b')
    const movedColor = movedPiece ? (movedPiece[0] as "w" | "b") : null;

    return { move, movedColor };
  }

  private getPiecePositions(): Map<string, string> {
    if (!this.boardElement) return new Map();
    return this.adapter.getPiecePositions(this.boardElement);
  }

  private positionsToString(positions: Map<string, string>): string {
    const entries = Array.from(positions.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return entries.map(([sq, pc]) => `${sq}:${pc}`).join(",");
  }

  getCurrentFEN(): string {
    return this.lastFEN;
  }

  // Allow external sync of side to move (useful when joining mid-game)
  setSideToMove(side: "w" | "b") {
    this.currentSideToMove = side;
    // Re-check with the new side
    if (this.boardElement) {
      const positions = this.getPiecePositions();
      const fen = positionsToFEN(positions, this.currentSideToMove);
      if (fen !== this.lastFEN) {
        this.lastFEN = fen;
        this.callbacks.forEach((cb) => cb(fen));
      }
    }
  }

  getCurrentSideToMove(): "w" | "b" {
    return this.currentSideToMove;
  }

  setPlayerColor(color: "white" | "black") {
    // [MoveTracker] Player color updated to:', color);
    this.playerColor = color;
  }
}
