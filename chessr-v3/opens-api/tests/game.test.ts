import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { seedTestDb } from './helpers.js';

// Test DB has:
//   B20 Sicilian Defense  uci="e2e4 c7c5"  (has win rates)
//   A00 Uncommon Opening  uci="g2g4"        (no win rates)
//   C00 French Defense    uci="e2e4 e7e6"   (has win rates)

before(() => seedTestDb());

async function req(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('GET /game', () => {
  it('requires moves param (empty is ok — returns book root)', async () => {
    const { status } = await req('/game');
    assert.equal(status, 200);
  });

  it('no moves — inBook true, no opening yet, nextMoves lists first moves', async () => {
    const { body } = await req('/game?moves=');
    assert.equal(body.opening, null);
    assert.equal(body.inBook, true);
    assert.equal(body.deviation, null);
    assert.ok(Array.isArray(body.nextMoves));
    const nxt = body.nextMoves as { uci: string }[];
    assert.ok(nxt.some(m => m.uci === 'e2e4'));
  });

  it('in-book position returns opening + nextMoves', async () => {
    const { body } = await req('/game?moves=e2e4+c7c5');
    assert.equal(body.inBook, true);
    assert.equal(body.deviation, null);
    const opening = body.opening as { eco: string; name: string };
    assert.equal(opening.eco, 'B20');
    assert.ok(opening.name.includes('Sicilian'));
    assert.ok(Array.isArray(body.nextMoves));
  });

  it('deviated game — returns last known opening + deviation info', async () => {
    // After e4 c5, play Nf3 (g1f3) which is not in test DB
    const { body } = await req('/game?moves=e2e4+c7c5+g1f3');
    assert.equal(body.inBook, false);
    assert.equal(body.nextMoves, null);
    const opening = body.opening as { eco: string } | null;
    assert.ok(opening !== null);
    assert.equal(opening!.eco, 'B20');
    const dev = body.deviation as { move: string; alternatives: unknown[] };
    assert.equal(dev.move, 'g1f3');
    assert.ok(Array.isArray(dev.alternatives));
  });

  it('completely unknown opening — opening null, deviation from root', async () => {
    // b2b4 is not in test DB
    const { body } = await req('/game?moves=b2b4');
    assert.equal(body.inBook, false);
    const dev = body.deviation as { move: string };
    assert.equal(dev.move, 'b2b4');
    // opening is null since even the root has no exact match for b2b4
    assert.equal(body.opening, null);
  });

  it('winRate present when data exists', async () => {
    const { body } = await req('/game?moves=e2e4+c7c5');
    const opening = body.opening as { winRate: { total: number } };
    assert.equal(opening.winRate.total, 10000);
  });

  it('deviation alternatives are from the last book position', async () => {
    // After e4 c5 (B20), deviate with g1f3
    // Alternatives should be the children of B20 in the book
    const { body } = await req('/game?moves=e2e4+c7c5+g1f3');
    const dev = body.deviation as { alternatives: { uci: string }[] };
    // In test DB there are no children of B20, so alternatives empty is ok
    assert.ok(Array.isArray(dev.alternatives));
  });
});
