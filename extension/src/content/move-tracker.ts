import { Chess } from "chess.js";
import { PlatformAdapter } from "./platforms/types";

export class MoveTracker {
  private adapter: PlatformAdapter;
  private boardElement: HTMLElement | null = null;
  private chess: Chess = new Chess();
  private lastFEN = "";
  private lastMoveCount = 0;
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

    // Build chess.js state from move history
    this.updateChessFromMoveHistory();

    const fen = this.chess.fen();
    this.lastFEN = fen;
    this.initialized = true;

    console.log("[MoveTracker] Initialized - FEN:", fen);

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

    // Check if move count changed
    const currentMoveCount = this.adapter.getMoveCount?.() ?? 0;

    if (currentMoveCount !== this.lastMoveCount) {
      // Update chess.js state from move history
      const lastMove = this.updateChessFromMoveHistory();

      const fen = this.chess.fen();
      console.log(
        "[MoveTracker] Position changed - moves:",
        currentMoveCount,
        "last move:",
        lastMove,
      );

      // IMPORTANT: Notify move callbacks FIRST, then position callbacks
      // This ensures analysis is sent with the PREVIOUS lastFenBeforeMove
      // before onPositionChange sets a new one for the next turn
      if (lastMove) {
        this.moveCallbacks.forEach((cb) => cb(lastMove));
      }

      if (fen !== this.lastFEN) {
        this.lastFEN = fen;
        this.callbacks.forEach((cb) => cb(fen));
      }

      this.lastMoveCount = currentMoveCount;
    }
  }

  /**
   * Updates chess.js instance from move history in the DOM
   * Returns the last move in UCI format, or null if no moves
   */
  private updateChessFromMoveHistory(): string | null {
    // Get move history from adapter
    const moveHistory = this.adapter.getMoveHistory?.() ?? [];

    // Reset chess.js to starting position
    this.chess = new Chess();

    // Apply all moves
    let lastUciMove: string | null = null;
    for (const uciMove of moveHistory) {
      try {
        // Parse UCI move (e.g., "e2e4" or "e7e8q")
        const from = uciMove.substring(0, 2);
        const to = uciMove.substring(2, 4);
        const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

        const move = this.chess.move({ from, to, promotion });
        if (move) {
          lastUciMove = uciMove;
        }
      } catch (error) {
        console.warn("[MoveTracker] Failed to apply move:", uciMove, error);
        break;
      }
    }

    return lastUciMove;
  }

  getCurrentFEN(): string {
    return this.lastFEN;
  }

  getCurrentSideToMove(): "w" | "b" {
    return this.chess.turn();
  }

  setPlayerColor(color: "white" | "black") {
    this.playerColor = color;
  }
}
