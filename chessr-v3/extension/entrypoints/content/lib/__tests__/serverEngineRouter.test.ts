import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideRoute, HYSTERESIS_DWELL_MS, type RouteState } from '../serverRouteDecision.js';
import { fakeEngineLoad, fakeLoadBucket } from '../fakeEngineLoad.js';

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

describe('fakeEngineLoad', () => {
  it('is deterministic per (engine, bucket)', () => {
    assert.deepEqual(fakeEngineLoad('maia3', 42), fakeEngineLoad('maia3', 42));
  });

  it('varies across engines and buckets', () => {
    const a = fakeEngineLoad('maia3', 42);
    const b = fakeEngineLoad('komodo', 42);
    const c = fakeEngineLoad('maia3', 43);
    assert.ok(JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(c));
  });

  it('stays inside the plausible ranges', () => {
    for (let b = 0; b < 50; b++) {
      const v = fakeEngineLoad('komodo', b);
      assert.ok(v.activeUsers >= 2 && v.activeUsers <= 8);
      assert.ok((v.avgResponseMs ?? 0) >= 600 && (v.avgResponseMs ?? 0) <= 950);
      assert.ok(v.loadPct >= 25 && v.loadPct <= 65);
    }
  });

  it('buckets change every 5 minutes', () => {
    assert.equal(fakeLoadBucket(0), 0);
    assert.equal(fakeLoadBucket(299_999), 0);
    assert.equal(fakeLoadBucket(300_000), 1);
  });
});
