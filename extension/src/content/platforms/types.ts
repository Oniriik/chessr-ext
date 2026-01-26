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
  detectSideToMoveFromClock(playerColor: 'white' | 'black', currentSide: 'w' | 'b'): Promise<'w' | 'b'>;

  // Move list observation (optional - for platforms that support it)
  startMoveListObserver?(onMove: () => void): void;
  stopMoveListObserver?(): void;
  getMoveCount?(): number;
  getMoveHistory?(): string[];  // Returns UCI moves from DOM

  // Page validation
  isAllowedPage(): boolean;
  isAnalysisDisabledPage(): boolean;

  // Overlay positioning
  getSquareSize(boardElement: HTMLElement): number;
  getBoardOrigin(boardElement: HTMLElement, squareSize: number, isFlipped: boolean): { x: number; y: number };
}
