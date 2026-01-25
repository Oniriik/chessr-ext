import { BoardConfig } from '../../shared/types';

export type Platform = 'chesscom' | 'lichess';

export interface PlatformAdapter {
  readonly platform: Platform;

  // Board detection
  detectBoard(): BoardConfig | null;
  waitForBoard(callback: (config: BoardConfig) => void, maxAttempts?: number): void;

  // Piece positions (for move tracking)
  getPiecePositions(boardElement: HTMLElement): Map<string, string>;

  // Turn detection
  detectSideToMoveFromClock(playerColor: 'white' | 'black', currentSide: 'w' | 'b'): 'w' | 'b';

  // Page validation
  isAllowedPage(): boolean;
  isAnalysisDisabledPage(): boolean;

  // Overlay positioning
  getSquareSize(boardElement: HTMLElement): number;
  getBoardOrigin(boardElement: HTMLElement, squareSize: number, isFlipped: boolean): { x: number; y: number };
}
