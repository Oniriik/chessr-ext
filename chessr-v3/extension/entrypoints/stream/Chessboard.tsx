/**
 * Stream Mode chessboard — pure SVG renderer.
 *
 * Self-contained: no chessground, no external piece sets, just a scaled
 * SVG that paints squares + Unicode chess glyphs from a FEN board portion.
 * Suggestion arrows are drawn as SVG paths on top of the pieces.
 */

import React from 'react';

// Use filled glyphs for BOTH colors and tint via SVG `fill`. The outlined
// white glyphs render as thin strokes that are hard to read on busy
// backgrounds; the filled variants are heavier shapes that read clearly.
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

/** Apply orientation: returns [col, row] in board grid coords (0..7).
 *  When orientation is 'black', the board is flipped. */
function squareToCoords(sq: string, orientation: 'white' | 'black'): [number, number] | null {
  if (sq.length < 2) return null;
  const f = sq.charCodeAt(0) - 97;
  const r = parseInt(sq[1], 10) - 1;
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return [col, row];
}

// Mirror PerformanceCard / arrows.ts palette — keep in sync if those move.
const CLASSIFICATION_COLOR: Record<string, string> = {
  best: '#81B64C',       brilliant: '#26C2A3',  great: '#749BBF',
  excellent: '#6ee7b7',  good: '#95B776',       book: '#D5A47D',
  forced: '#96AF8B',     inaccuracy: '#F7C631', mistake: '#FFA459',
  miss: '#FF7769',       blunder: '#FA412D',
};
const CLASSIFICATION_LABEL: Record<string, string> = {
  best: 'Best', brilliant: 'Brill', great: 'Great', excellent: 'Excel',
  good: 'Good', book: 'Book', forced: 'Frcd',
  inaccuracy: 'Inacc', mistake: 'Mist', miss: 'Miss', blunder: 'Blund',
};
const LABEL_COLOR: Record<string, string> = {
  check: '#fb923c', mate: '#c084fc', capture: '#94a3b8',
};
const PROMO_SYMBOL: Record<string, string> = {
  q: 'Q', r: 'R', b: 'B', n: 'N',
};

function resolveLabelDisplay(label: string, mateScore?: number | null): { text: string; color: string } {
  if (label.startsWith('promotion:')) {
    const piece = label.split(':')[1];
    return { text: `Promo ${PROMO_SYMBOL[piece] ?? '♛'}`, color: '#c084fc' };
  }
  if (label === 'mate' && mateScore != null) {
    return { text: Math.abs(mateScore) === 1 ? 'Mate' : `M${Math.abs(mateScore)}`, color: LABEL_COLOR.mate };
  }
  return { text: label.charAt(0).toUpperCase() + label.slice(1), color: LABEL_COLOR[label] ?? '#94a3b8' };
}

interface ArrowSpec {
  from: string;
  to: string;
  color: string;
  rank: number;
  labels?: string[];
  mateScore?: number | null;
  cls?: string;
}

interface Props {
  fen: string | null;
  orientation: 'white' | 'black';
  arrows?: ArrowSpec[];
  size?: number;
  opponentMove?: { uci: string; classification?: string } | null;
  /** Override opponent arrow color (from settingsStore.opponentArrowColor). */
  opponentArrowColor?: string;
  /** Player's own last move arrow (from analysisStore.currentMyLastMove). */
  myLastMove?: { uci: string; classification?: string } | null;
}

const ARROW_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'];

export default function Chessboard({
  fen,
  orientation,
  arrows = [],
  size = 480,
  opponentMove = null,
  opponentArrowColor = '#94a3b8',
  myLastMove = null,
}: Props) {
  const board = parseFenBoard(fen);
  const sq = size / 8;

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

      {/* File + rank labels (a–h on bottom, 1–8 on left). */}
      {Array.from({ length: 8 }).map((_, i) => {
        const file = orientation === 'white' ? i : 7 - i;
        const rank = orientation === 'white' ? 7 - i : i;
        const fileChar = String.fromCharCode(97 + file);
        const rankChar = String(rank + 1);
        return (
          <React.Fragment key={`label-${i}`}>
            <text x={i * sq + 3} y={size - 3} fontSize={10} fontWeight={700} fill={i % 2 === 0 ? '#ebecd0' : '#779556'} fontFamily="ui-monospace, monospace">
              {fileChar}
            </text>
            <text x={3} y={i * sq + 12} fontSize={10} fontWeight={700} fill={i % 2 === 0 ? '#779556' : '#ebecd0'} fontFamily="ui-monospace, monospace">
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

      {/* Opponent move arrow — muted, rendered below suggestion arrows */}
      {opponentMove && (() => {
        const from = opponentMove.uci.slice(0, 2);
        const to = opponentMove.uci.slice(2, 4);
        return (
          <React.Fragment key="opp-move">
            <Arrow from={from} to={to} orientation={orientation} color={opponentArrowColor} squareSize={sq} opacity={0.55} />
            {opponentMove.classification && CLASSIFICATION_LABEL[opponentMove.classification] && (
              <Badge
                sq={to}
                orientation={orientation}
                squareSize={sq}
                chips={[{
                  text: CLASSIFICATION_LABEL[opponentMove.classification],
                  color: CLASSIFICATION_COLOR[opponentMove.classification] ?? '#94a3b8',
                }]}
              />
            )}
          </React.Fragment>
        );
      })()}

      {/* My last move arrow — colored by classification */}
      {myLastMove && (() => {
        const from = myLastMove.uci.slice(0, 2);
        const to = myLastMove.uci.slice(2, 4);
        const arrowColor = myLastMove.classification
          ? (CLASSIFICATION_COLOR[myLastMove.classification] ?? '#aaaaaa')
          : '#aaaaaa';
        return (
          <React.Fragment key="my-last-move">
            <Arrow from={from} to={to} orientation={orientation} color={arrowColor} squareSize={sq} opacity={0.65} />
            {myLastMove.classification && CLASSIFICATION_LABEL[myLastMove.classification] && (
              <Badge
                sq={to}
                orientation={orientation}
                squareSize={sq}
                chips={[{
                  text: CLASSIFICATION_LABEL[myLastMove.classification],
                  color: arrowColor,
                }]}
              />
            )}
          </React.Fragment>
        );
      })()}

      {/* Suggestion arrows */}
      {arrows.map((a, i) => (
        <Arrow
          key={`arr-${i}`}
          from={a.from}
          to={a.to}
          orientation={orientation}
          color={a.color}
          squareSize={sq}
        />
      ))}

      {/* Badges (classification + chess-state labels) on each arrow's
          destination. Rendered after the arrows so they paint on top. */}
      {arrows.map((a, i) => {
        const chips: { text: string; color: string }[] = [];
        if (a.cls && CLASSIFICATION_LABEL[a.cls]) {
          chips.push({ text: CLASSIFICATION_LABEL[a.cls], color: CLASSIFICATION_COLOR[a.cls] });
        }
        for (const l of a.labels ?? []) {
          chips.push(resolveLabelDisplay(l, a.mateScore));
        }
        if (chips.length === 0) return null;
        return <Badge key={`badges-${i}`} sq={a.to} orientation={orientation} squareSize={sq} chips={chips} />;
      })}
    </svg>
  );
}

/** Stack of chips at the top-right corner of a destination square.
 *  Mirrors arrows.ts makeBadge layout — slot 0 at top, others below. */
function Badge({
  sq: square,
  orientation,
  squareSize,
  chips,
}: {
  sq: string;
  orientation: 'white' | 'black';
  squareSize: number;
  chips: { text: string; color: string }[];
}) {
  const coords = squareToCoords(square, orientation);
  if (!coords) return null;
  const cx = coords[0] * squareSize + squareSize / 2;
  const cy = coords[1] * squareSize + squareSize / 2;
  const fontSize = Math.max(6, squareSize / 11);
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.2;
  const badgeH = fontSize + padY * 2;
  const inset = 8;
  return (
    <g>
      {chips.map((chip, i) => {
        const badgeW = chip.text.length * fontSize * 0.65 + padX * 2;
        // Top-right corner of the destination square — matches arrows.ts makeBadge.
        const x = cx + squareSize / 2 - badgeW / 2 - inset;
        const y = cy - squareSize / 2 + badgeH / 2 + inset + i * (badgeH + 2);
        const r = parseInt(chip.color.slice(1, 3), 16);
        const g = parseInt(chip.color.slice(3, 5), 16);
        const b = parseInt(chip.color.slice(5, 7), 16);
        return (
          <g key={`chip-${i}`} transform={`translate(${x}, ${y})`}>
            <rect
              x={-badgeW / 2} y={-badgeH / 2}
              width={badgeW} height={badgeH}
              rx={fontSize * 0.3}
              fill={`rgba(${r}, ${g}, ${b}, 0.85)`}
            />
            <text
              x={0} y={fontSize * 0.35}
              textAnchor="middle"
              fontSize={fontSize} fontWeight={700}
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
              letterSpacing="0.04em"
              fill="white"
            >
              {chip.text.toUpperCase()}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Arrow from one square to another. Handles straight and L-shaped (knight)
 *  moves, matching the buildMovePath logic in content/lib/arrows.ts. */
function Arrow({
  from, to, orientation, color, squareSize, opacity = 0.85,
}: {
  from: string;
  to: string;
  orientation: 'white' | 'black';
  color: string;
  squareSize: number;
  opacity?: number;
}) {
  const fromXY = squareToCoords(from, orientation);
  const toXY = squareToCoords(to, orientation);
  if (!fromXY || !toXY) return null;
  const x1 = fromXY[0] * squareSize + squareSize / 2;
  const y1 = fromXY[1] * squareSize + squareSize / 2;
  const x2 = toXY[0] * squareSize + squareSize / 2;
  const y2 = toXY[1] * squareSize + squareSize / 2;

  const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rankDiff = Math.abs(parseInt(from[1], 10) - parseInt(to[1], 10));
  const isKnight = (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);

  const startInset = squareSize * 0.18;
  const endInset = squareSize * 0.32;
  const headLen = squareSize * 0.32;
  const headWidth = squareSize * 0.36;
  const shaftWidth = squareSize * 0.16;

  if (isKnight) {
    const ddx = x2 - x1;
    const ddy = y2 - y1;
    // L-path corner: the long leg goes first.
    const cornerX = Math.abs(ddx) > Math.abs(ddy) ? x2 : x1;
    const cornerY = Math.abs(ddx) > Math.abs(ddy) ? y1 : y2;

    // Inset start along first segment.
    const dx1 = cornerX - x1;
    const dy1 = cornerY - y1;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const sx = len1 > 0 ? x1 + (dx1 / len1) * startInset : x1;
    const sy = len1 > 0 ? y1 + (dy1 / len1) * startInset : y1;

    // Direction of last segment (corner → destination).
    const dx2 = x2 - cornerX;
    const dy2 = y2 - cornerY;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (len2 < 1) return null;
    const ux2 = dx2 / len2;
    const uy2 = dy2 / len2;

    const ex = x2 - ux2 * endInset;
    const ey = y2 - uy2 * endInset;
    const bx = ex - ux2 * headLen;
    const by = ey - uy2 * headLen;
    const px = -uy2;
    const py = ux2;

    return (
      <g opacity={opacity}>
        <polyline
          points={`${sx},${sy} ${cornerX},${cornerY} ${bx},${by}`}
          stroke={color}
          strokeWidth={shaftWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <polygon
          points={`${ex},${ey} ${bx + px * (headWidth / 2)},${by + py * (headWidth / 2)} ${bx - px * (headWidth / 2)},${by - py * (headWidth / 2)}`}
          fill={color}
        />
      </g>
    );
  }

  // Straight arrow.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;

  const sx = x1 + ux * startInset;
  const sy = y1 + uy * startInset;
  const ex = x2 - ux * endInset;
  const ey = y2 - uy * endInset;
  const bx = ex - ux * headLen;
  const by = ey - uy * headLen;
  const px = -uy;
  const py = ux;

  return (
    <g opacity={opacity}>
      <line x1={sx} y1={sy} x2={bx} y2={by} stroke={color} strokeWidth={shaftWidth} strokeLinecap="round" />
      <polygon
        points={`${ex},${ey} ${bx + px * (headWidth / 2)},${by + py * (headWidth / 2)} ${bx - px * (headWidth / 2)},${by - py * (headWidth / 2)}`}
        fill={color}
      />
    </g>
  );
}

export { ARROW_COLORS };
