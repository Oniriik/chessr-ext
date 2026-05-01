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

export function uciFromFens(fenBefore: string, fenAfter: string): string | null {
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return null;
  }
  // Compare on the position fields only (ignore halfmove / fullmove counters
  // which can mismatch if chess.com / our state-tracking diverges by 1).
  const targetBoard = fenAfter.split(' ').slice(0, 4).join(' ');
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    const probe = new Chess(fenBefore);
    probe.move(m);
    const probeBoard = probe.fen().split(' ').slice(0, 4).join(' ');
    if (probeBoard === targetBoard) {
      return m.from + m.to + (m.promotion ?? '');
    }
  }
  return null;
}
