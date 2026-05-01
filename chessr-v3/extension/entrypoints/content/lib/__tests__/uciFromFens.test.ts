import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uciFromFens, historyMatchesFen } from '../uciFromFens.js';

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
