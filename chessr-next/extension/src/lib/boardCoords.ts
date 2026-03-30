/**
 * Board coordinate utilities for auto-move.
 *
 * Computes screen-absolute pixel coordinates of the chess board
 * so the desktop app can move the mouse to the correct squares.
 */

/**
 * Get the board element's screen-absolute bounding rect.
 *
 * Uses getBoundingClientRect() for viewport-relative coords,
 * then adds window.screenX/screenY + browser chrome offset
 * to get screen-absolute coordinates.
 */
export function getScreenBoardRect(
  platform: 'lichess' | 'chesscom',
): { x: number; y: number; width: number; height: number } | null {
  let boardEl: HTMLElement | null;

  if (platform === 'lichess') {
    boardEl = document.querySelector('cg-board') as HTMLElement;
  } else {
    boardEl = document.querySelector(
      'wc-chess-board, chess-board, .chessboard',
    ) as HTMLElement;
  }

  if (!boardEl) return null;

  const rect = boardEl.getBoundingClientRect();

  // Convert viewport-relative to screen-absolute coordinates.
  // window.screenX/screenY give the browser window's position on screen.
  // The browser chrome (title bar, address bar, tabs) adds an offset
  // between the window position and the content viewport.
  const chromeOffsetX = (window.outerWidth - window.innerWidth) / 2;
  const chromeOffsetY = window.outerHeight - window.innerHeight;

  return {
    x: Math.round(rect.left + window.screenX + chromeOffsetX),
    y: Math.round(rect.top + window.screenY + chromeOffsetY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}
