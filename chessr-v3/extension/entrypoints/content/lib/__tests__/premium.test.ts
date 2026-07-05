import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPremium, canOfferTrial } from '../premium.js';

describe('isPremium', () => {
  it('true for paying / privileged tiers', () => {
    for (const p of ['premium', 'lifetime', 'beta', 'freetrial']) {
      assert.equal(isPremium(p), true, p);
    }
  });

  it('false for free and unknown plans', () => {
    assert.equal(isPremium('free'), false);
    assert.equal(isPremium(undefined), false);
    assert.equal(isPremium('whatever'), false);
  });
});

describe('canOfferTrial', () => {
  it('true only for a settled free-plan account that never claimed', () => {
    assert.equal(canOfferTrial('free', false, false), true);
  });

  it('false while the plan is still loading', () => {
    assert.equal(canOfferTrial('free', false, true), false);
  });

  it('false once the trial was claimed (even back on free plan)', () => {
    assert.equal(canOfferTrial('free', true, false), false);
  });

  it('false on any non-free plan', () => {
    for (const p of ['premium', 'lifetime', 'beta', 'freetrial', 'unlocker']) {
      assert.equal(canOfferTrial(p, false, false), false, p);
    }
  });

  it('false when the plan is unknown/undefined', () => {
    assert.equal(canOfferTrial(undefined, false, false), false);
  });
});
