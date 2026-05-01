/**
 * Derive the UCI move that connects two adjacent positions.
 *
 * Given fenBefore (the position the side-to-move was looking at) and
 * fenAfter (after one legal move), enumerate legal moves from fenBefore
 * and return the UCI string of the one that yields fenAfter.
 *
 * Returns null if no legal move connects the two positions (illegal
 * fenAfter, or non-adjacent positions). Cheap (≤ ~50 candidates per ply).
 */

import { Chess } from 'chess.js';

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
