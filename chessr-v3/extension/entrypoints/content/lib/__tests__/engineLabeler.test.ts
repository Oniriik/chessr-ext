import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labelSuggestions, type Suggestion } from '../engineLabeler.js';

const base: Omit<Suggestion, 'move'> = {
  multipv: 1, evaluation: 0, depth: 20,
  winRate: 50, drawRate: 0, lossRate: 50,
  mateScore: null, pv: [],
};

describe('labelSuggestions', () => {
  it('labels a capture', () => {
    // Position after 1. e4 d5: white can capture with exd5.
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const [res] = labelSuggestions([{ ...base, move: 'e4d5' }], fen);
    assert.deepEqual(res.labels, ['capture']);
  });

  it('labels checkmate-in-1 (immediate mate via isCheckmate)', () => {
    // Back-rank mate: white Re8# wins. Black king on g8 trapped by its own
    // f7/g7/h7 pawn shield; no black piece can interpose on f8 or capture on e8.
    const mateFen = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
    const [res] = labelSuggestions([{ ...base, move: 'e1e8' }], mateFen);
    assert.deepEqual(res.labels, ['mate'], 'back-rank Re8# must be labeled as mate');
  });

  it('labels promotion', () => {
    // White pawn on e7, empty e8. Move e7e8q.
    const fen = '8/4P3/8/8/8/8/8/4K2k w - - 0 1';
    const [res] = labelSuggestions([{ ...base, move: 'e7e8q' }], fen);
    assert.ok(res.labels.includes('promotion:q'));
  });

  it('stacks promotion with check when the promoted piece gives check', () => {
    // White pawn e7, white king h1, black king e1. Pawn promotes to queen
    // on e8 → queen checks the black king down the e-file.
    const fen = '8/4P3/8/8/8/8/8/4k2K w - - 0 1';
    const [res] = labelSuggestions([{ ...base, move: 'e7e8q' }], fen);
    assert.ok(res.labels.includes('check'), 'expected check label');
    assert.ok(res.labels.includes('promotion:q'), 'expected promotion:q to stack with check');
  });

  it('stacks promotion with mate when the promotion delivers checkmate', () => {
    // Black king on a8 boxed in by white king on c7; white pawn on b7 promotes
    // to queen on b8 → mate (no escape for the black king).
    const fen = 'k7/1PK5/8/8/8/8/8/8 w - - 0 1';
    const [res] = labelSuggestions([{ ...base, move: 'b7b8q' }], fen);
    assert.ok(res.labels.includes('mate'), 'expected mate label');
    assert.ok(res.labels.includes('promotion:q'), 'expected promotion:q to stack with mate');
  });

  it('flips mate interpretation by side-to-move', () => {
    // Black to move, mateScore=-3 means black delivers mate.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const [res] = labelSuggestions(
      [{ ...base, move: 'e7e5', mateScore: -3 }],
      fen,
    );
    assert.deepEqual(res.labels, ['mate']);
  });

  it('returns empty labels for an illegal move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const [res] = labelSuggestions([{ ...base, move: 'a1a8' }], fen);
    assert.deepEqual(res.labels, []);
  });

  it('returns [] on empty input', () => {
    assert.deepEqual(labelSuggestions([], 'any'), []);
  });
});
