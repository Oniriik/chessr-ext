import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute, HYSTERESIS_DWELL_MS, type RouteState } from '../serverRouteDecision.js';

const onServer: RouteState = { fallbackActive: false, belowSince: null };

describe('decideRoute (hysteresis)', () => {
  it('stays on server below the threshold', () => {
    const { next, changed } = decideRoute(onServer, 60, 80, 0);
    assert.equal(changed, false);
    assert.equal(next.fallbackActive, false);
  });

  it('falls back to local at/above the threshold', () => {
    const { next, changed } = decideRoute(onServer, 80, 80, 0);
    assert.equal(changed, true);
    assert.equal(next.fallbackActive, true);
  });

  it('threshold 100 never falls back, even fully saturated', () => {
    const { next, changed } = decideRoute(onServer, 100, 100, 0);
    assert.equal(changed, false);
    assert.equal(next.fallbackActive, false);
  });

  it('does not return to server before the dwell time', () => {
    let s: RouteState = { fallbackActive: true, belowSince: null };
    ({ next: s } = decideRoute(s, 50, 80, 1000));            // starts tracking
    assert.equal(s.belowSince, 1000);
    const r = decideRoute(s, 50, 80, 1000 + HYSTERESIS_DWELL_MS - 1);
    assert.equal(r.changed, false);
    assert.equal(r.next.fallbackActive, true);
  });

  it('returns to server after sustained calm', () => {
    let s: RouteState = { fallbackActive: true, belowSince: null };
    ({ next: s } = decideRoute(s, 50, 80, 1000));
    const r = decideRoute(s, 50, 80, 1000 + HYSTERESIS_DWELL_MS);
    assert.equal(r.changed, true);
    assert.equal(r.next.fallbackActive, false);
  });

  it('a load spike inside the calm window resets the timer', () => {
    let s: RouteState = { fallbackActive: true, belowSince: null };
    ({ next: s } = decideRoute(s, 50, 80, 1000));
    // 70 is below threshold(80) but NOT below threshold-15(65) → reset.
    ({ next: s } = decideRoute(s, 70, 80, 30_000));
    assert.equal(s.belowSince, null);
    assert.equal(s.fallbackActive, true);
  });
});
