/**
 * Stream Mode chessboard — pure SVG renderer.
 *
 * Self-contained: no chessground, no external piece sets, just a 320×320
 * (or scaled) SVG that paints squares + Unicode chess glyphs from a FEN
 * board portion. Suggestion arrows are drawn as SVG paths on top of the
 * pieces.
 *
 * Why not chessground: we only display, never accept user input. A 200-
 * line SVG is lighter than a +200KB chessground bundle and avoids the
 * asset packaging headache for the standalone stream page.
 */

import React from 'react';

// Use the filled (black-Unicode) glyphs for BOTH colors and tint via
// SVG `fill`. The outlined (white-Unicode) glyphs ♔♕♖♗♘♙ render as
// thin strokes that are hard to read on a busy background; the filled
// variants ♚♛♜♝♞♟ are heavier shapes that read clearly at small sizes.
const PIECE_GLYPH: Record<string, string> = {
  K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

/** Parse the board portion (first FEN field) into a 64-cell array.
 *  Index 0 = a8 (top-left when white is at bottom). */
function parseFenBoard(fen: string | null): (string | null)[] {
  const board: (string | null)[] = new Array(64).fill(null);
  if (!fen) return board;
  const rows = fen.split(' ')[0]?.split('/') ?? [];
  if (rows.length !== 8) return board;
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        f += parseInt(ch, 10);
      } else {
        board[r * 8 + f] = ch;
        f++;
      }
    }
  }
  return board;
}

/** UCI square (e.g. "e2") → [file 0..7, rank 0..7]. */
function uciToFileRank(sq: string): [number, number] | null {
  if (sq.length < 2) return null;
  const f = sq.charCodeAt(0) - 97;     // 'a' = 0
  const r = parseInt(sq[1], 10) - 1;   // '1' = 0
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return [f, r];
}

/** Apply orientation: returns [col, row] in board pixels (0..7).
 *  When orientation is 'black', the board is flipped — black pieces at
 *  the bottom of the rendered SVG. */
function squareToCoords(sq: string, orientation: 'white' | 'black'): [number, number] | null {
  const fr = uciToFileRank(sq);
  if (!fr) return null;
  const [file, rank] = fr;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return [col, row];
}

interface ArrowSpec {
  from: string;
  to: string;
  color: string;
  rank: number;
}

interface Props {
  fen: string | null;
  orientation: 'white' | 'black';
  /** Suggestions to render as arrows. UCI moves; first is rank 0 (best). */
  arrows?: ArrowSpec[];
  size?: number;
}

const ARROW_COLORS = ['#22c55e', '#3b82f6', '#f59e0b']; // green / blue / amber

export default function Chessboard({ fen, orientation, arrows = [], size = 480 }: Props) {
  const board = parseFenBoard(fen);
  const sq = size / 8;

  // Reorder cells for rendering when board is flipped — index 0 = top-left
  // visual square, which corresponds to a8 (when white) or h1 (when black).
  const visualOrder = (() => {
    const idxs: number[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = orientation === 'white' ? col : 7 - col;
        const rank = orientation === 'white' ? 7 - row : row;
        idxs.push((7 - rank) * 8 + file);
      }
    }
    return idxs;
  })();

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', borderRadius: 6, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
    >
      {/* Squares */}
      {Array.from({ length: 64 }).map((_, i) => {
        const col = i % 8;
        const row = Math.floor(i / 8);
        const isLight = (col + row) % 2 === 0;
        return (
          <rect
            key={`sq-${i}`}
            x={col * sq}
            y={row * sq}
            width={sq}
            height={sq}
            fill={isLight ? '#ebecd0' : '#779556'}
          />
        );
      })}

      {/* File + rank labels (a-h on bottom, 1-8 on left) */}
      {Array.from({ length: 8 }).map((_, i) => {
        const file = orientation === 'white' ? i : 7 - i;
        const rank = orientation === 'white' ? 7 - i : i;
        const fileChar = String.fromCharCode(97 + file);
        const rankChar = String(rank + 1);
        return (
          <React.Fragment key={`label-${i}`}>
            <text x={i * sq + 3} y={size - 3} fontSize={10} fontWeight={700} fill={i % 2 === 0 ? '#779556' : '#ebecd0'} fontFamily="ui-monospace, monospace">
              {fileChar}
            </text>
            <text x={3} y={i * sq + 12} fontSize={10} fontWeight={700} fill={i % 2 === 0 ? '#ebecd0' : '#779556'} fontFamily="ui-monospace, monospace">
              {rankChar}
            </text>
          </React.Fragment>
        );
      })}

      {/* Pieces */}
      {visualOrder.map((boardIdx, i) => {
        const piece = board[boardIdx];
        if (!piece) return null;
        const col = i % 8;
        const row = Math.floor(i / 8);
        const x = col * sq + sq / 2;
        const y = row * sq + sq / 2;
        const glyph = PIECE_GLYPH[piece] ?? '?';
        const isWhite = piece === piece.toUpperCase();
        return (
          <text
            key={`p-${i}`}
            x={x}
            y={y}
            fontSize={sq * 0.82}
            textAnchor="middle"
            dominantBaseline="central"
            fill={isWhite ? '#fafafa' : '#0f0f12'}
            stroke={isWhite ? '#0f0f12' : '#fafafa'}
            strokeWidth={1.2}
            paintOrder="stroke"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {glyph}
          </text>
        );
      })}

      {/* Arrows on top */}
      {arrows.map((a, i) => {
        const fromXY = squareToCoords(a.from, orientation);
        const toXY = squareToCoords(a.to, orientation);
        if (!fromXY || !toXY) return null;
        const x1 = fromXY[0] * sq + sq / 2;
        const y1 = fromXY[1] * sq + sq / 2;
        const x2 = toXY[0] * sq + sq / 2;
        const y2 = toXY[1] * sq + sq / 2;
        return <Arrow key={`arr-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} color={a.color} squareSize={sq} />;
      })}
    </svg>
  );
}

function Arrow({
  x1, y1, x2, y2, color, squareSize,
}: { x1: number; y1: number; x2: number; y2: number; color: string; squareSize: number }) {
  // Shorten the arrow at both ends so it doesn't overlap pieces too hard.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;

  const startInset = squareSize * 0.18;
  const endInset = squareSize * 0.32;
  const sx = x1 + ux * startInset;
  const sy = y1 + uy * startInset;
  const ex = x2 - ux * endInset;
  const ey = y2 - uy * endInset;

  const headLen = squareSize * 0.32;
  const headWidth = squareSize * 0.36;
  const shaftWidth = squareSize * 0.16;

  // Head triangle base center
  const baseX = ex - ux * headLen;
  const baseY = ey - uy * headLen;
  // Perpendicular vector for head width
  const px = -uy;
  const py = ux;
  const hx1 = baseX + px * (headWidth / 2);
  const hy1 = baseY + py * (headWidth / 2);
  const hx2 = baseX - px * (headWidth / 2);
  const hy2 = baseY - py * (headWidth / 2);

  return (
    <g opacity={0.85}>
      <line
        x1={sx} y1={sy} x2={baseX} y2={baseY}
        stroke={color} strokeWidth={shaftWidth} strokeLinecap="round"
      />
      <polygon
        points={`${ex},${ey} ${hx1},${hy1} ${hx2},${hy2}`}
        fill={color}
      />
    </g>
  );
}

export { ARROW_COLORS };
