/**
 * Derive the UCI move that connects two adjacent positions.
 *
 * Given fenBefore (the position the side-to-move was looking at) and
 * fenAfter (after one legal move), enumerate legal moves from fenBefore
 * and return the UCI string of the one that yields fenAfter.
 *
 * Returns null if no legal move connects the two positions (illegal
 * fenAfter, or non-adjacent positions). Cheap (≤ ~50 candidates per ply).
 *
 * Also exposes `historyMatchesFen(history, fen)` — replay a UCI history
 * from startpos and check whether it produces `fen`. Used to gate calls
 * to torch's `position startpos moves <history>` to avoid sending an
 * inconsistent sequence (which can wasm-abort the engine when chess.com
 * loaded an in-progress game whose early moves we never observed).
 */

import { Chess } from 'chess.js';

/** Replay `history` (UCI moves) from startpos and check the resulting
 *  position equals `fen`. Compared on the first 3 space-separated tokens
 *  (board + side-to-move + castling) — en-passant + halfmove + fullmove
 *  fields diverge harmlessly between chess.js and chess.com so we ignore
 *  them. Returns false if any move in history is illegal. */
export function historyMatchesFen(history: string[], fen: string): boolean {
  let chess: Chess;
  try {
    chess = new Chess();
  } catch {
    return false;
  }
  for (const m of history) {
    try {
      const result = chess.move({
        from: m.slice(0, 2),
        to: m.slice(2, 4),
        promotion: m.length >= 5 ? m.slice(4) : undefined,
      });
      if (!result) return false;
    } catch {
      return false;
    }
  }
  const replayKey = chess.fen().split(' ').slice(0, 3).join(' ');
  const targetKey = fen.split(' ').slice(0, 3).join(' ');
  return replayKey === targetKey;
}

/**
 * Derive the TWO UCI moves connecting fenBefore → fenAfter when the
 * positions are exactly 2 plies apart.
 *
 * This happens with premoves: chess.com applies the opponent's move AND
 * the queued premove in the same synchronous cascade, so the FEN we
 * observe on the `game.move` hook jumps 2 plies in a single transition.
 * Without this recovery the move history desyncs and gets cleared, which
 * permanently disables torch's rich fetch_analysis path for the game.
 *
 * Returns the pair plus the intermediate FEN (position after the first
 * move — chess.js normalized), or null if no legal 2-move sequence
 * connects the positions. Cost: worst-case ~40×40 probes, only paid when
 * the 1-ply match already failed (rare).
 */
export function uciPairFromFens(
  fenBefore: string,
  fenAfter: string,
): { moves: [string, string]; fenMid: string } | null {
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return null;
  }
  const targetBoard = fenAfter.split(' ').slice(0, 3).join(' ');
  for (const m1 of chess.moves({ verbose: true })) {
    const mid = new Chess(fenBefore);
    mid.move(m1);
    const fenMid = mid.fen();
    for (const m2 of mid.moves({ verbose: true })) {
      const probe = new Chess(fenMid);
      probe.move(m2);
      if (probe.fen().split(' ').slice(0, 3).join(' ') === targetBoard) {
        return {
          moves: [m1.from + m1.to + (m1.promotion ?? ''), m2.from + m2.to + (m2.promotion ?? '')],
          fenMid,
        };
      }
    }
  }
  return null;
}

export function uciFromFens(fenBefore: string, fenAfter: string): string | null {
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return null;
  }
  // Compare on board + side-to-move + castling only. We ignore:
  //   - en-passant (field 4): chess.com writes '-' when no pawn can
  //     actually capture en-passant, while chess.js always writes the
  //     square after a 2-square pawn push. Including this field made
  //     every 2-square pawn push (e2e4, e7e5, …) fail to match.
  //   - halfmove / fullmove (fields 5-6): drift by 1 between trackers.
  // Board+stm+castling is enough to uniquely identify the move from a
  // given position (different moves produce different boards).
  const targetBoard = fenAfter.split(' ').slice(0, 3).join(' ');
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    const probe = new Chess(fenBefore);
    probe.move(m);
    const probeBoard = probe.fen().split(' ').slice(0, 3).join(' ');
    if (probeBoard === targetBoard) {
      return m.from + m.to + (m.promotion ?? '');
    }
  }
  return null;
}
