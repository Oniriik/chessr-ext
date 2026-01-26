import { BoardConfig } from "../../shared/types";
import { Platform, PlatformAdapter } from "./types";

const BOARD_SELECTORS = [
  "wc-chess-board",
  "chess-board",
  "#board-single",
  "#board-play-computer",
  "#board-vs-personalities",
  ".chessboard",
];

export class ChesscomAdapter implements PlatformAdapter {
  readonly platform: Platform = "chesscom";
  private isInitial = true;

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
          isFlipped: playerColor === "black",
          playerColor,
        };
      }
    }
    return null;
  }

  waitForBoard(
    callback: (config: BoardConfig) => void,
    maxAttempts = 30,
  ): void {
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

    // Wait 500ms before first detection to let pieces fully load
    setTimeout(check, 3000);
  }

  private detectPlayerColor(): "white" | "black" | null {
    const board = document.querySelector(
      "wc-chess-board, chess-board, .chessboard",
    );

    if (!board) return null;

    // Method 1: Check if board is flipped
    const isFlipped =
      board.classList.contains("flipped") ||
      board.closest(".flipped") !== null ||
      (board as HTMLElement).getAttribute("flipped") === "true";

    if (isFlipped) {
      return "black";
    }

    // Method 2: Check bottom clock color
    const bottomClock = document.querySelector(".clock-bottom");
    if (bottomClock) {
      if (bottomClock.classList.contains("clock-black")) {
        return "black";
      }
      if (bottomClock.classList.contains("clock-white")) {
        return "white";
      }
    }

    return "white";
  }

  getPiecePositions(boardElement: HTMLElement): Map<string, string> {
    const positions = new Map<string, string>();
    let pieceElements: Element[] = [];

    if (boardElement.tagName.toLowerCase() === "wc-chess-board") {
      const shadowRoot = (boardElement as any).shadowRoot;
      if (shadowRoot) {
        pieceElements = Array.from(shadowRoot.querySelectorAll(".piece"));
      }
    }

    if (pieceElements.length === 0) {
      pieceElements = Array.from(document.querySelectorAll(".piece"));
    }

    pieceElements.forEach((el) => {
      const classList = Array.from(el.classList);
      const pieceClass = classList.find((c) => /^[wb][prnbqk]$/.test(c));
      const squareClass = classList.find((c) => c.startsWith("square-"));

      if (pieceClass && squareClass) {
        const squareNum = parseInt(squareClass.replace("square-", ""));
        const file = Math.floor(squareNum / 10) - 1;
        const rank = (squareNum % 10) - 1;
        const square = String.fromCharCode(97 + file) + (rank + 1);
        positions.set(square, pieceClass);
      }
    });

    return positions;
  }

  async detectSideToMoveFromClock(
    playerColor: "white" | "black",
    currentSide: "w" | "b",
  ): Promise<"w" | "b"> {
    // Method 1: Check clocks (for timed games)
    const clocks = document.querySelectorAll(".clock-component");

    for (const clock of clocks) {
      if (clock.classList.contains("clock-player-turn")) {
        if (clock.classList.contains("clock-black")) {
          console.log("detected from clock black");
          return "b";
        }
        if (clock.classList.contains("clock-white")) {
          console.log("detected from clock white");
          return "w";
        }
      }
    }

    // Method 2: Check move list (for bot games / untimed games)
    // Wait 5s on initial load for DOM to update
    if (this.isInitial) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const moveList = document.querySelector(
      '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    );
    if (moveList) {
      const moves = moveList.querySelectorAll(".main-line-ply");
      if (moves.length > 0) {
        // Odd number of half-moves = black's turn, even = white's turn
        const side = moves.length % 2 === 1 ? "b" : "w";
        console.log(
          "detected from move list - moves:",
          moves.length,
          "side:",
          side,
        );
        return side;
      }
    }

    return currentSide;
  }

  markCurrentPlayerMoved(): void {
    this.isInitial = false;
  }

  isAllowedPage(): boolean {
    const path = window.location.pathname;
    // Support: /game/123, /game/live/123, /game/daily/123, /play/computer
    return (
      /^\/game\/(live\/|daily\/)?\d+/.test(path) || path === "/play/computer"
    );
  }

  isAnalysisDisabledPage(): boolean {
    const url = window.location.href;
    return url.includes("/review") || url.includes("/analysis");
  }

  getSquareSize(boardElement: HTMLElement): number {
    const pieces = document.querySelectorAll(".piece");
    if (pieces.length === 0) return 0;

    const firstPiece = pieces[0] as HTMLElement;
    const pieceRect = firstPiece.getBoundingClientRect();
    return pieceRect.width;
  }

  getBoardOrigin(
    boardElement: HTMLElement,
    squareSize: number,
    isFlipped: boolean,
  ): { x: number; y: number } {
    const pieces = document.querySelectorAll(".piece");
    const boardRect = boardElement.getBoundingClientRect();

    for (const piece of pieces) {
      const classList = Array.from(piece.classList);
      const squareClass = classList.find((c) => c.startsWith("square-"));
      if (!squareClass) continue;

      const squareNum = parseInt(squareClass.replace("square-", ""));
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
