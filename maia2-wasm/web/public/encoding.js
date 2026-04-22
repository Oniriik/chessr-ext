// Port of maia2/utils.py:
//   - board_to_tensor      → boardToTensor(board) → Float32Array(18*8*8)
//   - get_side_info legal-mask portion → legalMovesMask(board, allMovesDict) → Float32Array(N)
//   - mirror_move          → mirrorMove(uci)
//
// `board` is a chess.js Chess instance.

import { Chess } from "https://esm.sh/chess.js@1.0.0-beta.8";

export const NUM_CHANNELS = 18;
const PIECE_INDEX = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

// chess.js square name (e.g. "a1") → python-chess square index (rank*8 + file).
function squareIndex(name) {
  const file = name.charCodeAt(0) - 97;     // a..h → 0..7
  const rank = parseInt(name[1], 10) - 1;   // 1..8 → 0..7
  return rank * 8 + file;
}

export function boardToTensor(board) {
  // Layout: 12 piece planes (W{P,N,B,R,Q,K} then B{P,N,B,R,Q,K}),
  //         1 turn plane, 4 castling planes, 1 en-passant plane = 18.
  const t = new Float32Array(NUM_CHANNELS * 64);
  const plane = (c) => c * 64;

  const grid = board.board(); // 8x8 array, row 0 = rank 8.
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = grid[r][f];
      if (!sq) continue;
      const pieceChannel = PIECE_INDEX[sq.type] + (sq.color === "w" ? 0 : 6);
      // python-chess uses rank as row, where rank 0 = "1". chess.js row 0 = "8".
      const rank = 7 - r;
      const file = f;
      t[plane(pieceChannel) + rank * 8 + file] = 1.0;
    }
  }

  // Turn channel: 1.0 if it's white's turn.
  if (board.turn() === "w") {
    const off = plane(12);
    for (let i = 0; i < 64; i++) t[off + i] = 1.0;
  }

  // Castling rights — chess.js exposes via board.fen() field 3.
  const fen = board.fen().split(" ");
  const castling = fen[2] || "-";
  const setPlane = (c) => {
    const off = plane(c);
    for (let i = 0; i < 64; i++) t[off + i] = 1.0;
  };
  if (castling.includes("K")) setPlane(13);
  if (castling.includes("Q")) setPlane(14);
  if (castling.includes("k")) setPlane(15);
  if (castling.includes("q")) setPlane(16);

  // En-passant target square (single cell set).
  const ep = fen[3];
  if (ep && ep !== "-") {
    const idx = squareIndex(ep);
    t[plane(17) + idx] = 1.0;
  }

  return t;
}

export function legalMovesMask(board, allMovesDict) {
  const mask = new Float32Array(Object.keys(allMovesDict).length);
  for (const m of board.moves({ verbose: true })) {
    const uci = m.from + m.to + (m.promotion ? m.promotion : "");
    const idx = allMovesDict[uci];
    if (idx === undefined) {
      console.warn(`legal move not in dict: ${uci}`);
      continue;
    }
    mask[idx] = 1.0;
  }
  return mask;
}

export function mirrorSquare(sq) {
  // "a1" → "a8", "e7" → "e2"
  return sq[0] + (9 - parseInt(sq[1], 10));
}

export function mirrorMove(uci) {
  const promo = uci.length > 4 ? uci.slice(4) : "";
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

// Mirror a chess.js Chess instance by FEN flip (vertically + swap turn).
export function mirroredBoard(board) {
  const [pieces, turn, castling, ep, half, full] = board.fen().split(" ");
  // Flip rank order, swap case for color.
  const rows = pieces.split("/").reverse().map(row =>
    row.split("").map(c =>
      c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
    ).join("")
  );
  const flippedPieces = rows.join("/");
  const flippedTurn = turn === "w" ? "b" : "w";
  // Castling letters swap case.
  const flippedCastling = castling === "-" ? "-" :
    castling.split("").map(c =>
      c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
    ).join("");
  // En-passant square mirrored vertically.
  const flippedEp = ep === "-" ? "-" : mirrorSquare(ep);
  const flippedFen = [flippedPieces, flippedTurn, flippedCastling, flippedEp, half, full].join(" ");
  return new Chess(flippedFen);
}
