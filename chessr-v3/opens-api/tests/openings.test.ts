import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { seedTestDb } from './helpers.js';

before(() => seedTestDb());

async function req(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('GET /openings', () => {
  it('returns openings list', async () => {
    const { status, body } = await req('/openings');
    assert.equal(status, 200);
    assert.ok((body.count as number) >= 3);
    assert.ok(Array.isArray(body.openings));
  });

  it('search by name (case-insensitive)', async () => {
    const { body } = await req('/openings?q=sicilian');
    const openings = body.openings as { name: string }[];
    assert.ok(openings.some((o) => o.name.toLowerCase().includes('sicilian')));
  });

  it('search by moves prefix', async () => {
    const { body } = await req('/openings?moves=e2e4');
    const openings = body.openings as { uci: string }[];
    assert.ok(openings.length > 0);
    assert.ok(openings.every((o) => o.uci.startsWith('e2e4')));
  });

  it('sort by winrate white — descending', async () => {
    const { body } = await req('/openings?sort=winrate&color=white');
    const openings = body.openings as { winRate: { white: number } | null }[];
    const rates = openings.filter((o) => o.winRate).map((o) => o.winRate!.white);
    for (let i = 1; i < rates.length; i++) assert.ok(rates[i - 1] >= rates[i]);
  });

  it('sort by winrate black — descending', async () => {
    const { body } = await req('/openings?sort=winrate&color=black');
    const openings = body.openings as { winRate: { black: number } | null }[];
    const rates = openings.filter((o) => o.winRate).map((o) => o.winRate!.black);
    for (let i = 1; i < rates.length; i++) assert.ok(rates[i - 1] >= rates[i]);
  });

  it('respects limit param', async () => {
    const { body } = await req('/openings?limit=1');
    assert.equal((body.openings as unknown[]).length, 1);
  });

  it('winRate is present when data exists', async () => {
    const { body } = await req('/openings?q=sicilian');
    const first = (body.openings as { winRate: unknown }[])[0];
    assert.ok(first.winRate !== null);
  });
});

describe('GET /openings/:eco', () => {
  it('returns a known opening', async () => {
    const { status, body } = await req('/openings/B20');
    assert.equal(status, 200);
    assert.equal(body.eco, 'B20');
    assert.equal(body.name, 'Sicilian Defense');
  });

  it('is case-insensitive', async () => {
    const { status, body } = await req('/openings/b20');
    assert.equal(status, 200);
    assert.equal(body.eco, 'B20');
  });

  it('returns 404 for unknown ECO', async () => {
    const { status } = await req('/openings/Z99');
    assert.equal(status, 404);
  });

  it('winRate shape is correct when data exists', async () => {
    const { body } = await req('/openings/B20');
    const wr = body.winRate as { white: number; draw: number; black: number; total: number };
    assert.equal(wr.total, 10000);
    assert.equal(wr.white, 0.5);
    assert.equal(wr.black, 0.2);
  });

  it('winRate is null when not fetched', async () => {
    const { body } = await req('/openings/A00');
    assert.equal(body.winRate, null);
  });
});
