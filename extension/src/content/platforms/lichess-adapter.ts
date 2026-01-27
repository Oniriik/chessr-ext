import { Chess } from 'chess.js';
import { BoardConfig } from '../../shared/types';
import { Platform, PlatformAdapter } from './types';

interface LichessGameData {
  game?: {
    player?: string;
    fen?: string;
  };
  player?: {
    color?: string;
  };
  clock?: {
    running?: boolean;
    white?: number;
    black?: number;
  };
}

export class LichessAdapter implements PlatformAdapter {
  readonly platform: Platform = 'lichess';
  private isInitial = true;
  private lastMoveCount = 0;
  private moveListObserver: MutationObserver | null = null;
  private onMoveCallback: (() => void) | null = null;

  detectBoard(): BoardConfig | null {
    const board = document.querySelector('cg-board');
    if (!board) return null;

    const playerColor = this.detectPlayerColor();
    return {
      boardElement: board as HTMLElement,
      isFlipped: playerColor === 'black',
      playerColor,
    };
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

    // Wait 2 seconds before first detection (Lichess loads faster than Chess.com)
    setTimeout(check, 2000);
  }

  private detectPlayerColor(): 'white' | 'black' {
    // Primary: Check cg-wrap orientation class (most reliable)
    const cgWrap = document.querySelector('.cg-wrap');
    if (cgWrap) {
      if (cgWrap.classList.contains('orientation-black')) {
        return 'black';
      }
      if (cgWrap.classList.contains('orientation-white')) {
        return 'white';
      }
    }

    // Fallback 1: Parse JSON from #page-init-data
    const gameData = this.getGameData();
    if (gameData?.player?.color) {
      return gameData.player.color as 'white' | 'black';
    }

    // Fallback 2: Check URL for color indicator (e.g., /VbH41r50/black)
    const pathParts = window.location.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart === 'black') return 'black';
    if (lastPart === 'white') return 'white';

    return 'white';
  }

  private getGameData(): LichessGameData | null {
    try {
      const dataScript = document.getElementById('page-init-data');
      if (dataScript?.textContent) {
        const parsed = JSON.parse(dataScript.textContent);
        return parsed.data || parsed;
      }
    } catch {
      // JSON parse error - ignore
    }
    return null;
  }

  getPiecePositions(boardElement: HTMLElement): Map<string, string> {
    const positions = new Map<string, string>();
    const pieces = boardElement.querySelectorAll('piece');
    const isFlipped = this.detectPlayerColor() === 'black';

    const typeMap: Record<string, string> = {
      pawn: 'p',
      rook: 'r',
      knight: 'n',
      bishop: 'b',
      queen: 'q',
      king: 'k',
    };

    const squareSize = boardElement.clientWidth / 8;

    pieces.forEach((piece) => {
      const el = piece as HTMLElement;
      const transform = el.style.transform;

      // Parse transform: translate(Xpx, Ypx)
      const match = transform.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
      if (!match) return;

      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);

      // Convert pixel position to file/rank
      // Lichess: x=0 is file a (or h if flipped), y=0 is rank 8 (or 1 if flipped)
      let file: number;
      let rank: number;

      if (isFlipped) {
        file = 7 - Math.round(x / squareSize);
        rank = Math.round(y / squareSize);
      } else {
        file = Math.round(x / squareSize);
        rank = 7 - Math.round(y / squareSize);
      }

      // Get piece type from class
      const classes = piece.className.split(' ');
      const color = classes.includes('white') ? 'w' : 'b';
      const pieceType = classes.find((c) => typeMap[c]);

      if (pieceType && file >= 0 && file <= 7 && rank >= 0 && rank <= 7) {
        const square = String.fromCharCode(97 + file) + (rank + 1);
        positions.set(square, color + typeMap[pieceType]);
      }
    });

    return positions;
  }

  async detectSideToMoveFromClock(playerColor: 'white' | 'black', currentSide: 'w' | 'b'): Promise<'w' | 'b'> {
    // Method 1: Count moves in the move list (most reliable - always present)
    // Wait 5s on initial load for DOM to update
    if (this.isInitial) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const moveList = document.querySelector('rm6, .moves');
    if (moveList) {
      const moves = moveList.querySelectorAll('kwdb');
      if (moves.length > 0) {
        // Odd number of moves = black's turn, even = white's turn
        const side = moves.length % 2 === 0 ? 'w' : 'b';
        console.log(
          '[LichessAdapter] Detected from move list - moves:',
          moves.length,
          'side:',
          side,
        );
        return side;
      }
    }

    // Method 2: Check for running clock (timed games - Lichess uses "running" class)
    const runningClock = document.querySelector('.rclock.running');
    if (runningClock) {
      if (runningClock.classList.contains('rclock-white')) {
        console.log('[LichessAdapter] Detected from running clock: white');
        return 'w';
      }
      if (runningClock.classList.contains('rclock-black')) {
        console.log('[LichessAdapter] Detected from running clock: black');
        return 'b';
      }
    }

    // Method 3: Correspondence games - check for rclock-turn__text element
    const turnTextElement = document.querySelector('.rclock-turn__text');
    if (turnTextElement) {
      const parentClock = turnTextElement.closest('.rclock');
      if (parentClock) {
        const isBottom = parentClock.classList.contains('rclock-bottom');
        const side = isBottom
          ? (playerColor === 'white' ? 'w' : 'b')
          : (playerColor === 'white' ? 'b' : 'w');
        console.log('[LichessAdapter] Detected from correspondence clock:', side);
        return side;
      }
    }

    // Method 4: Default
    console.log('[LichessAdapter] Using default side:', currentSide);
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
    const moveList = document.querySelector('rm6, .moves');

    if (!moveList) {
      console.log('[LichessAdapter] Move list not found, will retry');
      // Retry after a delay
      setTimeout(() => this.startMoveListObserver(onMove), 1000);
      return;
    }

    // Get initial move count
    const moves = moveList.querySelectorAll('kwdb');
    this.lastMoveCount = moves.length;
    console.log('[LichessAdapter] Initial move count:', this.lastMoveCount);

    // Set up observer
    this.moveListObserver = new MutationObserver(() => {
      const currentMoves = moveList.querySelectorAll('kwdb');
      if (currentMoves.length !== this.lastMoveCount) {
        console.log(
          '[LichessAdapter] Move detected:',
          this.lastMoveCount,
          '→',
          currentMoves.length,
        );
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
    const moveList = document.querySelector('rm6, .moves');
    if (!moveList) return 0;
    return moveList.querySelectorAll('kwdb').length;
  }

  /**
   * Get move history in UCI format by parsing DOM and converting SAN to UCI
   */
  getMoveHistory(): string[] {
    const chess = new Chess();
    const uciMoves: string[] = [];

    const moveList = document.querySelector('rm6, .moves');
    if (!moveList) return [];

    const moveElements = moveList.querySelectorAll('kwdb');
    for (const moveEl of moveElements) {
      const san = moveEl.textContent?.trim();
      if (!san) continue;

      try {
        const move = chess.move(san);
        if (move) {
          uciMoves.push(move.from + move.to + (move.promotion || ''));
        }
      } catch {
        // Invalid move, stop parsing
        console.warn('[LichessAdapter] Failed to parse move:', san);
        break;
      }
    }

    return uciMoves;
  }

  isAllowedPage(): boolean {
    const path = window.location.pathname;

    // Exclude known non-game pages
    const excluded = [
      '/analysis',
      '/editor',
      '/study',
      '/training',
      '/broadcast',
      '/tv',
      '/games',
      '/player',
      '/team',
      '/forum',
      '/blog',
      '/learn',
      '/practice',
      '/coach',
      '/streamer',
      '/video',
      '/opening',
      '/paste',
      '/patron',
      '/tournament',
      '/swiss',
      '/simul',
      '/@/',
    ];

    if (excluded.some((p) => path.startsWith(p))) return false;

    // Match game URLs:
    // - /{8-char-gameId} - spectator view
    // - /{8-char-gameId}{4-char-playerId} - player view (12 chars total)
    // - /{8-char-gameId}/black or /white - explicit color
    return /^\/[a-zA-Z0-9]{8}([a-zA-Z0-9]{4})?(\/?(black|white)?)?$/.test(path);
  }

  isAnalysisDisabledPage(): boolean {
    return window.location.pathname.startsWith('/analysis');
  }

  getSquareSize(boardElement: HTMLElement): number {
    return boardElement.clientWidth / 8;
  }

  getBoardOrigin(boardElement: HTMLElement, squareSize: number, isFlipped: boolean): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
}
