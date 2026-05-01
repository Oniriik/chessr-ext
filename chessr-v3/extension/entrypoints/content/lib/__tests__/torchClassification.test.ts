import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapTorchClassification } from '../torchClassification.js';

describe('mapTorchClassification', () => {
  it('maps known Chess.com names', () => {
    assert.equal(mapTorchClassification('best'),       'best');
    assert.equal(mapTorchClassification('brilliant'),  'brilliant');
    assert.equal(mapTorchClassification('greatFind'),  'great');
    assert.equal(mapTorchClassification('excellent'),  'excellent');
    assert.equal(mapTorchClassification('good'),       'good');
    assert.equal(mapTorchClassification('book'),       'book');
    assert.equal(mapTorchClassification('forced'),     'forced');
    assert.equal(mapTorchClassification('inaccuracy'), 'inaccuracy');
    assert.equal(mapTorchClassification('mistake'),    'mistake');
    assert.equal(mapTorchClassification('miss'),       'miss');
    assert.equal(mapTorchClassification('blunder'),    'blunder');
  });

  it('falls back to good on unknown / undefined / null', () => {
    assert.equal(mapTorchClassification(undefined), 'good');
    assert.equal(mapTorchClassification(null as unknown as string | undefined), 'good');
    assert.equal(mapTorchClassification(''), 'good');
    assert.equal(mapTorchClassification('mysterious'), 'good');
  });

  it('is case-sensitive (Chess.com uses camelCase consistently)', () => {
    assert.equal(mapTorchClassification('Brilliant'), 'good');
    assert.equal(mapTorchClassification('BLUNDER'), 'good');
  });
});
