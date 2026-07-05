import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uciFromFens, uciPairFromFens, historyMatchesFen } from '../uciFromFens.js';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('uciFromFens', () => {
  it('extracts a simple pawn move', () => {
    const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    assert.equal(uciFromFens(STARTPOS, after), 'e2e4');
  });

  it('extracts a knight move', () => {
    const after = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
    assert.equal(uciFromFens(STARTPOS, after), 'g1f3');
  });

  it('extracts a promotion', () => {
    const before = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    const after  = '4Q3/8/8/8/8/8/k7/4K3 b - - 0 1';
    assert.equal(uciFromFens(before, after), 'e7e8q');
  });

  it('returns null for non-adjacent positions', () => {
    const after = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
    assert.equal(uciFromFens(STARTPOS, after), null);
  });

  it('returns null on invalid fenBefore', () => {
    assert.equal(uciFromFens('not a fen', STARTPOS), null);
  });

  it('handles castling (kingside)', () => {
    const before = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 4';
    const after  = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 b kq - 5 4';
    assert.equal(uciFromFens(before, after), 'e1g1');
  });

  it("matches a 2-square pawn push when chess.com writes '-' for en-passant", () => {
    // chess.com only sets the en-passant square when an enemy pawn can
    // actually capture en-passant; chess.js always sets it after a 2-square
    // pawn push. uciFromFens must compare on board+stm+castling only, not
    // on the en-passant field.
    const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    assert.equal(uciFromFens(STARTPOS, after), 'e2e4');
  });
});

describe('uciPairFromFens', () => {
  it('derives the 2-ply pair of a premove jump (opponent move + premove)', () => {
    // White played 1.e4 earlier. Observed transition: black plays e7e5 AND
    // white's queued premove g1f3 executes in the same synchronous cascade,
    // so the FEN jumps 2 plies at once.
    const before = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const after  = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const pair = uciPairFromFens(before, after);
    assert.ok(pair);
    assert.deepEqual(pair!.moves, ['e7e5', 'g1f3']);
    // Intermediate FEN is the position after the first move only.
    assert.equal(uciFromFens(pair!.fenMid, after), 'g1f3');
    assert.equal(uciFromFens(before, pair!.fenMid), 'e7e5');
  });

  it('derives a pair involving a capture premove', () => {
    // After 1.e4 d5: white queued exd5 as premove. Observed jump:
    // black plays d7d5 + white premove e4xd5 in one transition.
    const before = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const after  = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    const pair = uciPairFromFens(before, after);
    assert.ok(pair);
    assert.deepEqual(pair!.moves, ['d7d5', 'e4d5']);
  });

  it('returns null for a 1-ply transition', () => {
    const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    assert.equal(uciPairFromFens(STARTPOS, after), null);
  });

  it('returns null for identical positions', () => {
    assert.equal(uciPairFromFens(STARTPOS, STARTPOS), null);
  });

  it('returns null for non-adjacent positions (3+ plies)', () => {
    // After 1.e4 e5 2.Nf3 Nc6 — 4 plies from startpos.
    const after = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    assert.equal(uciPairFromFens(STARTPOS, after), null);
  });

  it('returns null on invalid fenBefore', () => {
    assert.equal(uciPairFromFens('not a fen', STARTPOS), null);
  });
});

describe('historyMatchesFen', () => {
  it('empty history matches startpos', () => {
    const startpos = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    assert.equal(historyMatchesFen([], startpos), true);
  });

  it('e2e4 matches the after-1.e4 position', () => {
    const after1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    assert.equal(historyMatchesFen(['e2e4'], after1), true);
  });

  it('history with extra move does not match same FEN', () => {
    const after1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    assert.equal(historyMatchesFen(['e2e4', 'e7e5'], after1), false);
  });

  it('illegal move in history returns false', () => {
    const startpos = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    // e2e5 is illegal from startpos
    assert.equal(historyMatchesFen(['e2e5'], startpos), false);
  });

  it('25-move italian replay matches expected FEN', () => {
    const moves = ['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','e1g1','f8c5'];
    // After 4...Bc5
    const expected = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 5 5';
    assert.equal(historyMatchesFen(moves, expected), true);
  });
});
