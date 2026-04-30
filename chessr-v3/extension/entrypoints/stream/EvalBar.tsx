/**
 * Vertical eval bar — white at the bottom (or top, when board is flipped).
 * Centered at 50/50 when eval is 0, fills more white as +cp grows, more
 * black as eval drops. Mate: full bar of the winning color.
 */

interface Props {
  /** Engine evaluation in pawns, from side-to-move's perspective.
   *  null = no eval available yet. */
  evaluation: number | null;
  /** Mate-in-N from side-to-move's perspective. Negative = side to move
   *  is getting mated. null = no forced mate. */
  mateScore: number | null;
  /** Whose turn it is, used to flip the eval sign to white-perspective. */
  turn: 'white' | 'black' | null;
  /** Board orientation — eval bar follows the board flip. */
  orientation: 'white' | 'black';
  height?: number;
  width?: number;
}

/** Convert centipawn-style eval to a 0..1 fill ratio for "white share".
 *  Uses a soft tanh so big advantages don't pin the bar to 100% — keeps
 *  the visual responsive across the whole eval range. */
function evalToWhiteShare(evalWhite: number): number {
  const k = 0.4; // gentler curve (1.0 cp ≈ 0.62 ratio)
  const ratio = 0.5 + 0.5 * Math.tanh(k * evalWhite);
  return Math.max(0.02, Math.min(0.98, ratio));
}

export default function EvalBar({
  evaluation, mateScore, turn, orientation, height = 480, width = 24,
}: Props) {
  // Convert side-to-move eval → white-perspective eval.
  let evalWhite: number | null = null;
  let mateForWhite: number | null = null;
  if (mateScore !== null) {
    mateForWhite = turn === 'black' ? -mateScore : mateScore;
  } else if (evaluation !== null) {
    evalWhite = turn === 'black' ? -evaluation : evaluation;
  }

  const whiteShare =
    mateForWhite !== null
      ? mateForWhite > 0 ? 1 : mateForWhite < 0 ? 0 : 0.5
      : evalWhite !== null
      ? evalToWhiteShare(evalWhite)
      : 0.5;

  // Display label — what to write above/below the bar.
  const label =
    mateForWhite !== null
      ? `M${Math.abs(mateForWhite)}`
      : evalWhite !== null
      ? (evalWhite > 0 ? '+' : '') + evalWhite.toFixed(1)
      : '—';

  // Black at top when orientation=white (mirrors the board), and vice versa.
  // We compute the white-fill height from the *bottom* so it grows upward
  // when white is winning.
  const whiteFillH = whiteShare * height;
  const blackFillH = height - whiteFillH;

  // For orientation='black', flip vertically.
  const flipped = orientation === 'black';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          position: 'relative',
          width,
          height,
          background: '#1a1b26',
          border: '1px solid #2a2b3d',
          borderRadius: 4,
          overflow: 'hidden',
          transform: flipped ? 'scaleY(-1)' : undefined,
        }}
      >
        {/* Black share (top) */}
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: blackFillH,
            background: '#1a1a1a',
            transition: 'height 200ms ease',
          }}
        />
        {/* White share (bottom) */}
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: whiteFillH,
            background: '#fafafa',
            transition: 'height 200ms ease',
          }}
        />
        {/* Midline */}
        <div
          style={{
            position: 'absolute', top: '50%', left: 0, right: 0,
            height: 1, background: 'rgba(168, 85, 247, 0.5)',
          }}
        />
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
        color: '#a1a1aa', fontVariantNumeric: 'tabular-nums',
        minWidth: 40, textAlign: 'center',
      }}>
        {label}
      </span>
    </div>
  );
}
