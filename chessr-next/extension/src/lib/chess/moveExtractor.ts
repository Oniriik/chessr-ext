/**
 * Move extraction utilities for parsing chess moves from DOM
 * Platform-aware: supports both Chess.com and Lichess
 */

// Platform-specific selectors
const CHESSCOM_MOVE_LIST_SELECTOR = '.play-controller-moves, .move-list, [class*="vertical-move-list"]';
const CHESSCOM_MOVE_SELECTOR = '.main-line-ply';
const LICHESS_MOVE_LIST_SELECTOR = 'rm6, .moves';
const LICHESS_MOVE_SELECTOR = 'kwdb';

/**
 * Detect current platform from hostname
 */
function detectPlatform(): 'chesscom' | 'lichess' {
  const hostname = window.location.hostname;
  if (hostname.includes('lichess.org')) return 'lichess';
  return 'chesscom';
}

/**
 * Get selectors for current platform
 */
function getSelectors() {
  const platform = detectPlatform();
  if (platform === 'lichess') {
    return {
      moveListSelector: LICHESS_MOVE_LIST_SELECTOR,
      moveSelector: LICHESS_MOVE_SELECTOR,
    };
  }
  return {
    moveListSelector: CHESSCOM_MOVE_LIST_SELECTOR,
    moveSelector: CHESSCOM_MOVE_SELECTOR,
  };
}

/**
 * Normalize localized piece letters to English SAN notation
 * Chess.com uses localized piece letters (D=Dame, T=Tour, etc.)
 * chess.js expects English notation (Q, R, B, N, K)
 */
export function normalizePieceLetters(san: string): string {
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
    'С': 'B', // Слон (RU)
    // Knight
    'C': 'N', // Cavalier/Caballo/Cavalo (FR/ES/PT)
    'S': 'N', // Springer (DE)
    'К': 'N', // Конь (RU)
  };

  // Handle promotion (e.g., e8=D -> e8=Q)
  let result = san.replace(/=([DTFALCSФЛСК])/, (_, piece) => '=' + (pieceMap[piece] || piece));
  // Handle piece moves (e.g., Dxe5 -> Qxe5)
  result = result.replace(/^([DTFALCSФЛСК])([a-h1-8x])/, (_, piece, rest) => (pieceMap[piece] || piece) + rest);

  return result;
}

/**
 * Extract SAN notation from a ply element (Chess.com specific)
 * Handles figurine notation (icons for pieces)
 */
export function extractSanFromPly(ply: Element): string | null {
  let text = ply.textContent?.trim() || '';

  // Handle figurine notation: icon + destination (Chess.com)
  const figurine = ply.querySelector('[data-figurine]');
  if (figurine) {
    const piece = figurine.getAttribute('data-figurine');
    text = text.replace(/\s+/g, '');

    // Handle promotion with figurine
    if (text.includes('=')) {
      return text + piece;
    }
    return piece + text;
  }

  text = text.replace(/\s+/g, '');
  return normalizePieceLetters(text) || null;
}

/**
 * Extract all moves from the DOM move list as SAN strings
 * Platform-aware: works on both Chess.com and Lichess
 */
export function extractMovesFromDOM(): string[] {
  const platform = detectPlatform();
  const { moveListSelector, moveSelector } = getSelectors();

  const moveList = document.querySelector(moveListSelector);
  if (!moveList) return [];

  const plyElements = moveList.querySelectorAll(moveSelector);
  const moves: string[] = [];

  for (const ply of plyElements) {
    let san: string | null;

    if (platform === 'lichess') {
      // Lichess: moves are plain text in kwdb elements
      san = ply.textContent?.trim() || null;
    } else {
      // Chess.com: may have figurine notation
      san = extractSanFromPly(ply);
    }

    if (san) {
      moves.push(san);
    }
  }

  return moves;
}

/**
 * Get the move list container element
 */
export function getMoveListElement(): Element | null {
  const { moveListSelector } = getSelectors();
  return document.querySelector(moveListSelector);
}
