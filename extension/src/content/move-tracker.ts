import { positionsToFEN } from "./position-parser";
import { PlatformAdapter } from "./platforms/types";

export class MoveTracker {
  private adapter: PlatformAdapter;
  private boardElement: HTMLElement | null = null;
  private lastFEN = "";
  private lastPiecePositions: Map<string, string> = new Map();
  private currentSideToMove: "w" | "b" = "w";
  private playerColor: "white" | "black" = "white";
  private callbacks: ((fen: string) => void)[] = [];
  private moveCallbacks: ((move: string) => void)[] = [];
  private initialized = false;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  start(boardElement: HTMLElement, playerColor: "white" | "black" = "white") {
    this.boardElement = boardElement;
    this.playerColor = playerColor;

    // Only use move list observer for detecting moves (chess.com)
    if (this.adapter.startMoveListObserver) {
      this.adapter.startMoveListObserver(() => {
        console.log("[MoveTracker] Move list changed");
        this.onMoveListChange();
      });
    }

    // Initial position check after board loads
    setTimeout(() => {
      this.initializePosition();
    }, 500);
  }

  stop() {
    this.adapter.stopMoveListObserver?.();
  }

  onPositionChange(callback: (fen: string) => void) {
    this.callbacks.push(callback);
  }

  onMoveDetected(callback: (move: string) => void) {
    this.moveCallbacks.push(callback);
  }

  private initializePosition() {
    if (!this.boardElement) return;

    const currentPositions = this.getPiecePositions();
    this.lastPiecePositions = currentPositions;

    // Determine side to move from move count
    const moveCount = this.adapter.getMoveCount?.() ?? 0;
    this.currentSideToMove = moveCount % 2 === 0 ? "w" : "b";

    console.log(
      "[MoveTracker] Initialized - moves:",
      moveCount,
      "side:",
      this.currentSideToMove,
    );

    const fen = positionsToFEN(currentPositions, this.currentSideToMove);
    this.lastFEN = fen;
    this.initialized = true;

    // Notify callbacks of initial position
    this.callbacks.forEach((cb) => cb(fen));
  }

  private onMoveListChange() {
    if (!this.boardElement || !this.initialized) return;

    // Small delay to let piece animations complete
    setTimeout(() => {
      this.checkForChange();
    }, 100);
  }

  private checkForChange() {
    if (!this.boardElement) return;

    const currentPositions = this.getPiecePositions();
    const currentPosString = this.positionsToString(currentPositions);
    const lastPosString = this.positionsToString(this.lastPiecePositions);

    const positionsChanged = currentPosString !== lastPosString;

    if (positionsChanged) {
      // Detect move info
      const moveInfo = this.detectMoveInfo(
        this.lastPiecePositions,
        currentPositions,
      );

      // Update side to move from move count (most reliable)
      const moveCount = this.adapter.getMoveCount?.() ?? 0;
      this.currentSideToMove = moveCount % 2 === 0 ? "w" : "b";

      console.log(
        "[MoveTracker] Position changed - moves:",
        moveCount,
        "side:",
        this.currentSideToMove,
        "detected:",
        moveInfo.move,
      );

      this.lastPiecePositions = currentPositions;

      const fen = positionsToFEN(currentPositions, this.currentSideToMove);

      if (fen !== this.lastFEN) {
        this.lastFEN = fen;
        this.callbacks.forEach((cb) => cb(fen));
      }

      // Notify move callbacks
      if (moveInfo.move) {
        this.moveCallbacks.forEach((cb) => cb(moveInfo.move!));
      }
    }
  }

  private detectMoveInfo(
    oldPos: Map<string, string>,
    newPos: Map<string, string>,
  ): { move: string | null; movedColor: "w" | "b" | null } {
    let fromSquare: string | null = null;
    let movedPiece: string | null = null;

    for (const [square, piece] of oldPos) {
      if (!newPos.has(square) || newPos.get(square) !== piece) {
        const stillExists = Array.from(newPos.values()).includes(piece);
        if (stillExists || newPos.get(square) !== piece) {
          fromSquare = square;
          movedPiece = piece;
          break;
        }
      }
    }

    let toSquare: string | null = null;

    for (const [square, piece] of newPos) {
      const oldPiece = oldPos.get(square);
      if (oldPiece !== piece && piece === movedPiece) {
        toSquare = square;
        break;
      }
    }

    if (!toSquare) {
      for (const [square, piece] of newPos) {
        const oldPiece = oldPos.get(square);
        if (!oldPiece && piece) {
          toSquare = square;
          movedPiece = piece;
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

  setSideToMove(side: "w" | "b") {
    this.currentSideToMove = side;
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
    this.playerColor = color;
  }
}
