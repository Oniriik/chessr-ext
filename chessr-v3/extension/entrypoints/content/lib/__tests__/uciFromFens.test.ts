import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uciFromFens } from '../uciFromFens.js';

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
