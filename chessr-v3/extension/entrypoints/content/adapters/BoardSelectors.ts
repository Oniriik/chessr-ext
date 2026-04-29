/**
 * Content-world DOM selector adapter.
 *
 * `arrows.ts` and `evalBar.ts` both need to find the on-page board element
 * to overlay SVG arrows and the eval gauge on top of it. The selectors
 * differ per platform — chess.com uses a `<wc-chess-board>` web component,
 * Lichess uses chessground's `<cg-board>` inside `.cg-wrap`.
 *
 * `pickBoardSelectors(host)` returns the implementation matching the page
 * the content script is running on. Platform detection mirrors the page
 * adapter (same hostname predicates).
 */

export interface BoardSelectors {
  /** Root element of the playable board (used as the SVG overlay parent). */
  boardEl(): HTMLElement | null;
}

class ChesscomBoardSelectors implements BoardSelectors {
  boardEl(): HTMLElement | null {
    return document.querySelector('wc-chess-board') as HTMLElement | null;
  }
}

class LichessBoardSelectors implements BoardSelectors {
  boardEl(): HTMLElement | null {
    // The cg-wrap is the size-stable parent and the right anchor for an
    // absolute-positioned overlay. cg-board itself reflows on every move
    // and isn't a great mount target.
    return document.querySelector('.main-board .cg-wrap') as HTMLElement | null
        ?? document.querySelector('.cg-wrap') as HTMLElement | null;
  }
}

const chesscom = new ChesscomBoardSelectors();
const lichess = new LichessBoardSelectors();

export function pickBoardSelectors(host: string = location.hostname): BoardSelectors {
  if (/(^|\.)chess\.com$/.test(host)) return chesscom;
  if (/(^|\.)lichess\.org$/.test(host)) return lichess;
  // Fallback: chess.com (status quo) — content script also gates on hostname
  // upstream, so this branch shouldn't be reached in practice.
  return chesscom;
}

export const boardSelectors = pickBoardSelectors();
