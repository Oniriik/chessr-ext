/**
 * Domain: FEN Parser
 * Pure functions for FEN notation handling
 */

export interface PieceInfo {
  type: string;
  color: 'w' | 'b';
  square: string;
}

export interface SquareCoords {
  file: number;
  rank: number;
}

/**
 * Convert square notation (e.g., "e4") to coordinates (internal use)
 */
function squareToCoords(square: string): SquareCoords {
  return {
    file: square.charCodeAt(0) - 97, // a=0, h=7
    rank: parseInt(square[1]) - 1,   // 1=0, 8=7
  };
}

/**
 * Convert coordinates to square notation
 */
export function coordsToSquare(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + (rank + 1);
}

/**
 * Convert pieces array to FEN string
 */
export function piecesToFEN(pieces: PieceInfo[], sideToMove: 'w' | 'b'): string {
  const board: (string | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));

  pieces.forEach(({ type, color, square }) => {
    const { file, rank } = squareToCoords(square);
    const piece = color === 'w' ? type.toUpperCase() : type.toLowerCase();
    board[7 - rank][file] = piece;
  });

  const fenBoard = board.map(row => {
    let fenRow = '';
    let emptyCount = 0;

    row.forEach(cell => {
      if (cell === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          fenRow += emptyCount;
          emptyCount = 0;
        }
        fenRow += cell;
      }
    });

    if (emptyCount > 0) {
      fenRow += emptyCount;
    }

    return fenRow;
  }).join('/');

  return `${fenBoard} ${sideToMove} KQkq - 0 1`;
}

/**
 * Parse FEN string to pieces array
 */
export function fenToPieces(fen: string): PieceInfo[] {
  const pieces: PieceInfo[] = [];
  const fenParts = fen.split(' ');
  const boardPart = fenParts[0];
  const rows = boardPart.split('/');

  const pieceMap: Record<string, { type: string; color: 'w' | 'b' }> = {
    'P': { type: 'p', color: 'w' },
    'N': { type: 'n', color: 'w' },
    'B': { type: 'b', color: 'w' },
    'R': { type: 'r', color: 'w' },
    'Q': { type: 'q', color: 'w' },
    'K': { type: 'k', color: 'w' },
    'p': { type: 'p', color: 'b' },
    'n': { type: 'n', color: 'b' },
    'b': { type: 'b', color: 'b' },
    'r': { type: 'r', color: 'b' },
    'q': { type: 'q', color: 'b' },
    'k': { type: 'k', color: 'b' },
  };

  rows.forEach((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let file = 0;

    for (const char of row) {
      if (/\d/.test(char)) {
        file += parseInt(char);
      } else if (pieceMap[char]) {
        const square = coordsToSquare(file, rank - 1);
        pieces.push({
          type: pieceMap[char].type,
          color: pieceMap[char].color,
          square,
        });
        file++;
      }
    }
  });

  return pieces;
}
