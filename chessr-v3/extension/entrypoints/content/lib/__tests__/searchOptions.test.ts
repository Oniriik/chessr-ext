import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoCommand, normalizeSearchOptions } from '../searchOptions.js';

describe('normalizeSearchOptions', () => {
  it('returns null for non-object input', () => {
    assert.equal(normalizeSearchOptions(null), null);
    assert.equal(normalizeSearchOptions('nodes'), null);
  });

  it('rejects unknown mode', () => {
    assert.equal(normalizeSearchOptions({ mode: 'infinite' }), null);
  });

  it('clamps nodes to [10_000, 50_000_000]', () => {
    assert.deepEqual(normalizeSearchOptions({ mode: 'nodes', nodes: 1 }), { mode: 'nodes', nodes: 10_000 });
    assert.deepEqual(normalizeSearchOptions({ mode: 'nodes', nodes: 1e10 }), { mode: 'nodes', nodes: 50_000_000 });
  });

  it('clamps depth to [1, 40] and movetime to [100, 30_000]', () => {
    assert.deepEqual(normalizeSearchOptions({ mode: 'depth', depth: 0 }), { mode: 'depth', depth: 1 });
    assert.deepEqual(normalizeSearchOptions({ mode: 'movetime', movetime: 50 }), { mode: 'movetime', movetime: 100 });
  });
});

describe('buildGoCommand', () => {
  it('falls back to bare "go" on null', () => {
    assert.equal(buildGoCommand(null), 'go');
  });
  it('formats nodes / depth / movetime', () => {
    assert.equal(buildGoCommand({ mode: 'nodes', nodes: 1_000_000 }), 'go nodes 1000000');
    assert.equal(buildGoCommand({ mode: 'depth', depth: 18 }), 'go depth 18');
    assert.equal(buildGoCommand({ mode: 'movetime', movetime: 2000 }), 'go movetime 2000');
  });
});
