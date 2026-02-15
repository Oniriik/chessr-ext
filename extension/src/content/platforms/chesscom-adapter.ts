import { Chess } from "chess.js";
import { BoardConfig } from "../../shared/types";
import { Platform, PlatformAdapter, RatingInfo } from "./types";

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
  private lastMoveCount = 0;
  private moveListObserver: MutationObserver | null = null;
  private onMoveCallback: (() => void) | null = null;

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

    // Wait 3000ms before first detection to let pieces fully load
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

  /**
   * Start observing the move list for new moves
   * Calls the callback whenever a new move is detected
   */
  startMoveListObserver(onMove: () => void): void {
    this.onMoveCallback = onMove;

    // Find the move list element
    const moveList = document.querySelector(
      '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    );

    if (!moveList) {
      console.log("[ChesscomAdapter] Move list not found, will retry");
      // Retry after a delay
      setTimeout(() => this.startMoveListObserver(onMove), 1000);
      return;
    }

    // Get initial move count
    const moves = moveList.querySelectorAll(".main-line-ply");
    this.lastMoveCount = moves.length;
    console.log("[ChesscomAdapter] Initial move count:", this.lastMoveCount);

    // Set up observer
    this.moveListObserver = new MutationObserver(() => {
      const currentMoves = moveList.querySelectorAll(".main-line-ply");
      if (currentMoves.length !== this.lastMoveCount) {
        this.lastMoveCount = currentMoves.length;
        this.onMoveCallback?.();
      }
    });

    this.moveListObserver.observe(moveList, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop observing the move list
   */
  stopMoveListObserver(): void {
    if (this.moveListObserver) {
      this.moveListObserver.disconnect();
      this.moveListObserver = null;
    }
    this.onMoveCallback = null;
  }

  /**
   * Get the current number of moves from the move list
   */
  getMoveCount(): number {
    const moveList = document.querySelector(
      '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    );
    if (!moveList) return 0;
    return moveList.querySelectorAll(".main-line-ply").length;
  }

  /**
   * Get move history in UCI format by parsing DOM and converting SAN to UCI
   */
  getMoveHistory(): string[] {
    const chess = new Chess();
    const uciMoves: string[] = [];

    const moveList = document.querySelector(
      '.play-controller-moves, .move-list, [class*="vertical-move-list"]',
    );
    if (!moveList) return [];

    const plyElements = moveList.querySelectorAll(".main-line-ply");
    for (const ply of plyElements) {
      const san = this.extractSanFromPly(ply);
      if (!san) continue;

      try {
        const move = chess.move(san);
        if (move) {
          uciMoves.push(move.from + move.to + (move.promotion || ""));
        }
      } catch {
        // Invalid move, stop parsing
        break;
      }
    }

    return uciMoves;
  }

  /**
   * Normalize localized piece letters to English SAN notation
   * Chess.com uses localized piece letters (D=Dame, T=Tour, etc.)
   * chess.js expects English notation (Q, R, B, N, K)
   */
  private normalizePieceLetters(san: string): string {
    // Map of localized piece letters to English
    // French: R(Roi), D(Dame), T(Tour), F(Fou), C(Cavalier)
    // German: K(König), D(Dame), T(Turm), L(Läufer), S(Springer)
    // Spanish: R(Rey), D(Dama), T(Torre), A(Alfil), C(Caballo)
    // Portuguese: R(Rei), D(Dama), T(Torre), B(Bispo), C(Cavalo)
    // Russian: Кр(Король), Ф(Ферзь), Л(Ладья), С(Слон), К(Конь)
    const pieceMap: Record<string, string> = {
      // Queen
      'D': 'Q', // Dame/Dama (FR/DE/ES/PT)
      'Ф': 'Q', // Ферзь (RU)
      // Rook
      'T': 'R', // Tour/Torre/Turm (FR/ES/DE/PT)
      'Л': 'R', // Ладья (RU)
      // Bishop
      'F': 'B', // Fou (FR)
      'A': 'B', // Alfil (ES)
      'L': 'B', // Läufer (DE)
      'С': 'B', // Слон (RU) - Cyrillic С
      // Knight
      'C': 'N', // Cavalier/Caballo/Cavalo (FR/ES/PT)
      'S': 'N', // Springer (DE)
      'К': 'N', // Конь (RU) - Cyrillic К (also used for King, but Knight more common in moves)
    };

    // Replace piece letter after = (promotion) - Latin and Cyrillic
    let result = san.replace(/=([DTFALCSФЛСК])/, (_, piece) => '=' + (pieceMap[piece] || piece));

    // Replace piece letter at start (piece moves) - only uppercase followed by file/rank
    result = result.replace(/^([DTFALCSФЛСК])([a-h1-8x])/, (_, piece, rest) => (pieceMap[piece] || piece) + rest);

    return result;
  }

  /**
   * Extract SAN notation from a ply element
   * Handles figurine notation (icons for pieces)
   */
  private extractSanFromPly(ply: Element): string | null {
    // Get text content
    let text = ply.textContent?.trim() || "";

    // Handle figurine notation: icon + destination (e.g., [N]f3 → Nf3)
    const figurine = ply.querySelector("[data-figurine]");
    if (figurine) {
      const piece = figurine.getAttribute("data-figurine"); // N, B, R, Q, K
      // Remove any whitespace and get just the move part
      text = text.replace(/\s+/g, "");

      // Check if this is a promotion (text contains "=")
      // Promotion: e8= + Q → e8=Q (piece goes after =)
      // Regular move: [N]f3 → Nf3 (piece goes before)
      if (text.includes("=")) {
        return text + piece;
      }
      return piece + text;
    }

    // Remove whitespace for regular moves
    text = text.replace(/\s+/g, "");

    // Normalize localized piece letters to English
    return this.normalizePieceLetters(text) || null;
  }

  /**
   * Detect player and opponent ratings from Chess.com DOM
   * Returns { playerRating, opponentRating } or nulls if not found
   */
  detectRatings(): RatingInfo {
    // Player rating: bottom player
    const bottomPlayer = document.querySelector("#board-layout-player-bottom");
    const playerRatingEl = bottomPlayer?.querySelector(
      '[data-cy="user-tagline-rating"]',
    );
    const playerRating = playerRatingEl?.textContent
      ?.trim()
      .replace(/[()]/g, "");

    // Opponent rating: top player
    const topPlayer = document.querySelector("#board-layout-player-top");
    const opponentRatingEl = topPlayer?.querySelector(
      '[data-cy="user-tagline-rating"]',
    );
    const opponentRating = opponentRatingEl?.textContent
      ?.trim()
      .replace(/[()]/g, "");

    return {
      playerRating: playerRating ? parseInt(playerRating, 10) : null,
      opponentRating: opponentRating ? parseInt(opponentRating, 10) : null,
    };
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
