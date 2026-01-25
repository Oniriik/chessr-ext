interface PieceInfo {
  type: string;
  color: 'w' | 'b';
  square: string;
}

export function parseBoardToFEN(boardElement: HTMLElement, sideToMove: 'w' | 'b' = 'w'): string {
  const pieces = parsePieces(boardElement);
  return toFEN(pieces, sideToMove);
}

/**
 * Generate FEN from a piece positions map (platform-agnostic).
 * Map format: square -> piece class (e.g., 'e2' -> 'wp', 'e7' -> 'bp')
 */
export function positionsToFEN(positions: Map<string, string>, sideToMove: 'w' | 'b' = 'w'): string {
  const pieces: PieceInfo[] = [];

  for (const [square, pieceClass] of positions) {
    if (pieceClass.length >= 2) {
      const color = pieceClass[0] as 'w' | 'b';
      const type = pieceClass[1];
      pieces.push({ type, color, square });
    }
  }

  return toFEN(pieces, sideToMove);
}

function parsePieces(boardElement: HTMLElement): PieceInfo[] {
  const pieces: PieceInfo[] = [];
  let pieceElements: NodeListOf<Element> | Element[] = [];

  // Method 1: For wc-chess-board with shadow DOM
  if (boardElement.tagName.toLowerCase() === 'wc-chess-board') {
    const shadowRoot = (boardElement as any).shadowRoot;
    if (shadowRoot) {
      pieceElements = shadowRoot.querySelectorAll('.piece');
    }
    if (pieceElements.length === 0) {
      pieceElements = boardElement.querySelectorAll('.piece');
    }
  }

  // Method 2: Global search
  if (pieceElements.length === 0) {
    pieceElements = document.querySelectorAll('.piece');
  }

  // Method 3: Look in board-layout-component
  if (pieceElements.length === 0) {
    const boardLayout = document.querySelector('.board-layout-component');
    if (boardLayout) {
      pieceElements = boardLayout.querySelectorAll('.piece');
    }
  }

  // Method 4: Look for elements with piece class pattern
  if (pieceElements.length === 0) {
    const allElements = document.querySelectorAll('[class*="square-"]');
    pieceElements = Array.from(allElements).filter(el => {
      const classes = el.className;
      return /\b[wb][prnbqk]\b/.test(classes);
    });
  }

  // Method 5: Get FEN from board API
  if (pieceElements.length === 0 && boardElement.tagName.toLowerCase() === 'wc-chess-board') {
    const fen = (boardElement as any).getAttribute('fen') ||
                (boardElement as any).fen ||
                (boardElement as any).game?.getFEN?.();
    if (fen) {
      return parseFENToPieces(fen);
    }
  }

  pieceElements.forEach((el) => {
    const classList = Array.from(el.classList);
    const pieceClass = classList.find(c => /^[wb][prnbqk]$/.test(c));
    const squareClass = classList.find(c => c.startsWith('square-'));

    if (pieceClass && squareClass) {
      const color = pieceClass[0] as 'w' | 'b';
      const type = pieceClass[1];
      const squareNum = parseInt(squareClass.replace('square-', ''));

      // square-XY: X = file (1-8), Y = rank (1-8)
      // X is tens digit, Y is ones digit
      const file = Math.floor(squareNum / 10) - 1;  // tens digit = file (a=0, h=7)
      const rank = (squareNum % 10) - 1;            // ones digit = rank (1=0, 8=7)
      const square = numToSquare(file, rank);

      pieces.push({ type, color, square });
    }
  });

  return pieces;
}

function toFEN(pieces: PieceInfo[], sideToMove: 'w' | 'b'): string {
  const board: (string | null)[][] = Array(8).fill(null).map(() => Array(8).fill(null));

  pieces.forEach(({ type, color, square }) => {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1]) - 1;
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

  // Calculate castling rights based on piece positions
  const castling = getCastlingRights(pieces);
  return `${fenBoard} ${sideToMove} ${castling} - 0 1`;
}

function numToSquare(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + (rank + 1);
}

function getCastlingRights(pieces: PieceInfo[]): string {
  // Check if kings and rooks are on their initial squares
  const pieceMap = new Map<string, PieceInfo>();
  pieces.forEach(p => pieceMap.set(p.square, p));

  let castling = '';

  // White king on e1?
  const whiteKing = pieceMap.get('e1');
  if (whiteKing?.type === 'k' && whiteKing?.color === 'w') {
    // White kingside rook on h1?
    const whiteRookH = pieceMap.get('h1');
    if (whiteRookH?.type === 'r' && whiteRookH?.color === 'w') {
      castling += 'K';
    }
    // White queenside rook on a1?
    const whiteRookA = pieceMap.get('a1');
    if (whiteRookA?.type === 'r' && whiteRookA?.color === 'w') {
      castling += 'Q';
    }
  }

  // Black king on e8?
  const blackKing = pieceMap.get('e8');
  if (blackKing?.type === 'k' && blackKing?.color === 'b') {
    // Black kingside rook on h8?
    const blackRookH = pieceMap.get('h8');
    if (blackRookH?.type === 'r' && blackRookH?.color === 'b') {
      castling += 'k';
    }
    // Black queenside rook on a8?
    const blackRookA = pieceMap.get('a8');
    if (blackRookA?.type === 'r' && blackRookA?.color === 'b') {
      castling += 'q';
    }
  }

  return castling || '-';
}

function parseFENToPieces(fen: string): PieceInfo[] {
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
        const square = numToSquare(file, rank - 1);
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

