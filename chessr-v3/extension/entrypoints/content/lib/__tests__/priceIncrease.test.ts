import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, isPreannounceActive, type PricesResponse } from '../priceIncrease';

const EUR = { price: '€2.99', original: null, currency: 'EUR' };
const UP = { monthly: EUR, yearly: EUR, lifetime: EUR };

test('formatCountdown pads and includes days only when > 0', () => {
  assert.equal(formatCountdown(0), '00:00:00');
  assert.equal(formatCountdown(-5000), '00:00:00'); // clamps
  assert.equal(formatCountdown(1000), '00:00:01');
  assert.equal(formatCountdown(23 * 3600_000 + 59 * 60_000 + 59_000), '23:59:59');
  assert.equal(formatCountdown(86_400_000 + 3661_000), '1d 01:01:01');
  assert.equal(formatCountdown(3 * 86_400_000 + 4 * 3600_000 + 5 * 60_000 + 6_000), '3d 04:05:06');
});

test('isPreannounceActive requires upcoming + future priceChangeAt', () => {
  const now = Date.parse('2026-07-08T00:00:00Z');
  const future = '2026-07-11T22:00:00.000Z';
  const past = '2026-07-01T00:00:00.000Z';
  assert.equal(isPreannounceActive(null, now), false);
  assert.equal(isPreannounceActive({} as PricesResponse, now), false);
  assert.equal(isPreannounceActive({ upcoming: UP }, now), false); // no date
  assert.equal(isPreannounceActive({ upcoming: UP, priceChangeAt: past }, now), false);
  assert.equal(isPreannounceActive({ priceChangeAt: future }, now), false); // no upcoming
  assert.equal(isPreannounceActive({ upcoming: UP, priceChangeAt: future }, now), true);
  assert.equal(isPreannounceActive({ upcoming: UP, priceChangeAt: 'garbage' }, now), false);
});
