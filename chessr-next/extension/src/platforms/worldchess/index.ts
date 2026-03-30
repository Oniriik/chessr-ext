import { Platform } from '../types';
import { detectRoute } from './routes';
import { getMountPoints } from './mounts';

const BOARD_SELECTOR = 'cg-board[data-cg-type="board"]';

/** Find the main game board inside GameBoardCenter */
function findMainBoard(): HTMLElement | null {
  return document.querySelector(
    '[data-component="GameBoardCenter"] ' + BOARD_SELECTOR,
  ) as HTMLElement | null;
}
const MOVE_BUTTON_SELECTOR = 'button[id^="move_"][id$="_table"]';

/**
 * Detects if a game has started by checking for the board element on a game page.
 */
export function detectGameStarted(): boolean {
  const board = findMainBoard();
  if (!board) return false;
  // Verify we're on a game page
  return /\/game\/[0-9a-f-]+/i.test(window.location.pathname);
}

/**
 * Detects player color from page title.
 * Title format: "WhitePlayer vs BlackPlayer / World Chess - ..."
 * Player name extracted from header avatar alt: "Your (Name) avatar in the header section"
 */
export function detectPlayerColor(): 'white' | 'black' | null {
  // Get player name from header avatar
  const avatarImg = document.querySelector('[data-component="HeaderToolsItemAccountButton"] img[alt^="Your ("]');
  if (!avatarImg) return null;
  const altText = avatarImg.getAttribute('alt') || '';
  const nameMatch = altText.match(/^Your \((.+?)\) avatar/);
  if (!nameMatch) return null;
  const playerName = nameMatch[1];

  // Parse title: "WhiteName vs BlackName / World Chess - ..."
  const title = document.title;
  const titleMatch = title.match(/^(.+?) vs (.+?) \//);
  if (!titleMatch) return null;

  const whiteName = titleMatch[1].trim();
  const blackName = titleMatch[2].trim();

  if (playerName === whiteName) return 'white';
  if (playerName === blackName) return 'black';

  // Fallback: check board rotation
  const board = findMainBoard();
  if (board) {
    const transform = board.style.transform || '';
    if (transform.includes('rotate(180deg)')) return 'black';
  }
  return 'white';
}

/**
 * Detects current turn by counting moves.
 */
export function detectCurrentTurn(): 'white' | 'black' {
  const moves = document.querySelectorAll(MOVE_BUTTON_SELECTOR);
  // Even number of moves = white's turn, odd = black's turn
  return moves.length % 2 === 0 ? 'white' : 'black';
}

/**
 * Detects player and opponent ratings from PlayerBox elements.
 */
export function detectRatings(): { playerRating: number | null; opponentRating: number | null } {
  // WorldChess PlayerBox elements — bottom is the current player
  const playerBoxes = document.querySelectorAll('[data-component="PlayerBox"]');
  if (playerBoxes.length < 2) return { playerRating: null, opponentRating: null };

  // TODO: Extract ratings from PlayerBox DOM when we have more DOM details
  return { playerRating: null, opponentRating: null };
}

export const worldchess: Platform = {
  id: 'worldchess',
  name: 'World Chess',
  hostname: /^(www\.)?worldchess\.com$/,
  detectRoute,
  getMountPoints,
};
