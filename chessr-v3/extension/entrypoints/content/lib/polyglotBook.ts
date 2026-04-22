/**
 * Minimal Polyglot opening-book reader.
 *
 *   - book bytes = sorted entries, 16 bytes each, big-endian:
 *       key (8) || raw_move (2) || weight (2) || learn (4)
 *   - hash = standard 781-entry Polyglot Zobrist (loaded as a separate binary).
 *
 * Used by MaiaSuggestionEngine to cover the opening phase, since Maia 2's
 * training discards the first 10 moves of every game.
 *   See: https://www.microsoft.com/en-us/research/blog/the-human-side-of-ai-for-chess/
 */

import { Chess } from 'chess.js';

interface BookHit {
  uci: string;
  weight: number;
}

const ENTRY_SIZE = 16;

// Polyglot piece-index mapping (low-bit = side colour, 0=black 1=white)
const PIECE_INDEX: Record<string, [number, number]> = {
  p: [0, 1], n: [2, 3], b: [4, 5], r: [6, 7], q: [8, 9], k: [10, 11],
};

const RND_CASTLE_OFFSET = 768;       // K, Q, k, q
const RND_EP_OFFSET     = 768 + 4;   // 8 files
const RND_TURN          = 780;       // 1 entry, XORed iff white-to-move

export class PolyglotBook {
  private zobrist: BigUint64Array | null = null;
  private book: DataView | null = null;
  private bookLen = 0;
  private _ready = false;

  get ready(): boolean { return this._ready; }
  get size(): number { return this.bookLen; }

  async load(zobristUrl: string, bookUrl: string): Promise<void> {
    const [zRes, bRes] = await Promise.all([fetch(zobristUrl), fetch(bookUrl)]);
    if (!zRes.ok) throw new Error(`Failed to fetch zobrist: ${zRes.status}`);
    if (!bRes.ok) throw new Error(`Failed to fetch book: ${bRes.status}`);

    // Zobrist is 781 × uint64 big-endian.
    const zBuf = await zRes.arrayBuffer();
    if (zBuf.byteLength !== 781 * 8) {
      throw new Error(`Zobrist size ${zBuf.byteLength} ≠ 6248`);
    }
    const dv = new DataView(zBuf);
    this.zobrist = new BigUint64Array(781);
    for (let i = 0; i < 781; i++) this.zobrist[i] = dv.getBigUint64(i * 8, false);

    const bookBuf = await bRes.arrayBuffer();
    if (bookBuf.byteLength % ENTRY_SIZE !== 0) {
      throw new Error(`Book size ${bookBuf.byteLength} not multiple of 16`);
    }
    this.book = new DataView(bookBuf);
    this.bookLen = bookBuf.byteLength / ENTRY_SIZE;
    this._ready = true;
  }

  /** Compute Polyglot Zobrist hash of the position. */
  hash(board: Chess): bigint {
    if (!this.zobrist) throw new Error('PolyglotBook not loaded');
    let h = 0n;
    const z = this.zobrist;

    // Pieces.
    const grid = board.board(); // row 0 = rank 8 in chess.js
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = grid[r][f];
        if (!sq) continue;
        const pair = PIECE_INDEX[sq.type];
        const pieceIdx = sq.color === 'w' ? pair[1] : pair[0];
        const rank = 7 - r; // python-chess square = rank * 8 + file (rank 0 = "1")
        h ^= z[64 * pieceIdx + 8 * rank + f];
      }
    }

    // Castling — chess.js exposes via FEN field 3.
    const fenParts = board.fen().split(' ');
    const castling = fenParts[2] || '-';
    if (castling.includes('K')) h ^= z[RND_CASTLE_OFFSET + 0];
    if (castling.includes('Q')) h ^= z[RND_CASTLE_OFFSET + 1];
    if (castling.includes('k')) h ^= z[RND_CASTLE_OFFSET + 2];
    if (castling.includes('q')) h ^= z[RND_CASTLE_OFFSET + 3];

    // En-passant — Polyglot only counts the file if a pawn of the side to
    // move actually has the EP capture available next ply (otherwise the
    // hash would diverge from generators that follow the legal-EP rule).
    const ep = fenParts[3];
    if (ep && ep !== '-') {
      const file = ep.charCodeAt(0) - 97;
      const rank = parseInt(ep[1], 10) - 1;
      const sideToMove = board.turn(); // 'w' | 'b'
      const captureRank = sideToMove === 'w' ? rank - 1 : rank + 1;
      const couldCapture = (df: -1 | 1) => {
        const cf = file + df;
        if (cf < 0 || cf > 7) return false;
        // chess.js board row index = 7 - rank
        const sq = grid[7 - captureRank]?.[cf];
        return !!sq && sq.type === 'p' && sq.color === sideToMove;
      };
      if (couldCapture(-1) || couldCapture(1)) {
        h ^= z[RND_EP_OFFSET + file];
      }
    }

    if (board.turn() === 'w') h ^= z[RND_TURN];

    return h;
  }

  /**
   * Look up all moves for the given position. Returns top entries sorted by
   * weight descending. Empty array if the position isn't in book.
   */
  lookup(board: Chess): BookHit[] {
    if (!this.book || !this._ready) return [];
    const target = this.hash(board);

    // Binary search for any entry with this key.
    let lo = 0;
    let hi = this.bookLen - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const k = this.book.getBigUint64(mid * ENTRY_SIZE, false);
      if (k === target) { found = mid; break; }
      if (k < target) lo = mid + 1; else hi = mid - 1;
    }
    if (found < 0) return [];

    // Walk left and right to collect every entry sharing this key.
    let start = found;
    while (start > 0 && this.book.getBigUint64((start - 1) * ENTRY_SIZE, false) === target) start--;
    let end = found;
    while (end + 1 < this.bookLen && this.book.getBigUint64((end + 1) * ENTRY_SIZE, false) === target) end++;

    const hits: BookHit[] = [];
    const fen = board.fen();
    for (let i = start; i <= end; i++) {
      const off = i * ENTRY_SIZE;
      const rawMove = this.book.getUint16(off + 8, false);
      const weight = this.book.getUint16(off + 10, false);
      const uci = decodeMove(rawMove, fen);
      if (uci) hits.push({ uci, weight });
    }
    hits.sort((a, b) => b.weight - a.weight);
    return hits;
  }
}

/**
 * Decode a 16-bit Polyglot move into UCI. Polyglot stores castling as the
 * king capturing its own rook (e1h1 / e1a1 / e8h8 / e8a8); we translate to
 * the standard king-two-squares notation (e1g1 / e1c1 / e8g8 / e8c8).
 *
 * `fen` is needed to detect whether the encoded move IS a castle vs a
 * literal king-takes-rook (the latter is impossible in legal chess but the
 * format doesn't disambiguate).
 */
function decodeMove(raw: number, fen: string): string | null {
  const toFile   =  raw        & 0x7;
  const toRank   = (raw >>  3) & 0x7;
  const fromFile = (raw >>  6) & 0x7;
  const fromRank = (raw >>  9) & 0x7;
  const promo    = (raw >> 12) & 0x7;

  const sq = (f: number, r: number) =>
    String.fromCharCode(97 + f) + String(r + 1);

  let from = sq(fromFile, fromRank);
  let to = sq(toFile, toRank);

  // Castling translation.
  const sideToMove = fen.split(' ')[1];
  if (sideToMove === 'w' && from === 'e1') {
    if (to === 'h1') to = 'g1';
    else if (to === 'a1') to = 'c1';
  } else if (sideToMove === 'b' && from === 'e8') {
    if (to === 'h8') to = 'g8';
    else if (to === 'a8') to = 'c8';
  }

  if (promo > 0) {
    const promoChar = ['', 'n', 'b', 'r', 'q'][promo];
    return from + to + promoChar;
  }
  return from + to;
}
