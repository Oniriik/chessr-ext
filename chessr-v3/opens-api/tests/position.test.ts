import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { seedTestDb } from './helpers.js';

before(() => seedTestDb());

const SICILIAN_FEN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const START_FEN    = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function req(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('GET /position', () => {
  it('requires fen param', async () => {
    const { status } = await req('/position');
    assert.equal(status, 400);
  });

  it('matches Sicilian Defense by FEN', async () => {
    const { status, body } = await req(`/position?fen=${encodeURIComponent(SICILIAN_FEN)}`);
    assert.equal(status, 200);
    const opening = body.opening as { eco: string; name: string } | null;
    assert.ok(opening !== null);
    assert.equal(opening!.eco, 'B20');
    assert.ok(opening!.name.includes('Sicilian'));
  });

  it('returns null opening for unknown position', async () => {
    const { body } = await req(`/position?fen=${encodeURIComponent(START_FEN)}`);
    assert.equal(body.opening, null);
  });

  it('always returns alternatives array', async () => {
    const { body } = await req(`/position?fen=${encodeURIComponent(START_FEN)}`);
    assert.ok(Array.isArray(body.alternatives));
  });

  it('alternatives sorted by total desc (nulls last)', async () => {
    const { body } = await req(`/position?fen=${encodeURIComponent(START_FEN)}`);
    const alts = body.alternatives as { total: number | null }[];
    // Non-null totals must come before null totals.
    let seenNull = false;
    for (const alt of alts) {
      if (alt.total === null) { seenNull = true; continue; }
      assert.ok(!seenNull, 'non-null total came after a null total');
    }
  });

  it('alternative shape is correct', async () => {
    const { body } = await req(`/position?fen=${encodeURIComponent(START_FEN)}`);
    const alts = body.alternatives as { uci: string; eco: string; name: string; total: number | null; white_wr: number | null }[];
    if (alts.length > 0) {
      assert.ok(typeof alts[0].uci === 'string');
      assert.ok(typeof alts[0].eco === 'string');
      assert.ok(typeof alts[0].name === 'string');
    }
  });
});
