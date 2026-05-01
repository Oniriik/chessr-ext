import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFetchAnalysisJson } from '../torchJson.js';

const FIX = path.join(import.meta.dirname, 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
}

describe('parseFetchAnalysisJson', () => {
  it('parses a startpos fixture and exposes top-level fields', () => {
    const raw = loadFixture('torch-startpos.json');
    const out = parseFetchAnalysisJson(raw);
    assert.equal(typeof out.caps.white.all, 'number');
    assert.equal(typeof out.caps.black.all, 'number');
    assert.equal(typeof out.effectiveElo.white, 'number');
    assert.equal(typeof out.effectiveElo.black, 'number');
    assert.ok(Array.isArray(out.moveAnalyses));
  });

  it('maps each played move to a TorchMoveAnalysis with classification + eval', () => {
    const raw = loadFixture('torch-italian-25moves.json');
    const out = parseFetchAnalysisJson(raw);
    assert.equal(out.moveAnalyses.length, 25);
    const mv0 = out.moveAnalyses[0];
    assert.equal(typeof mv0.classification, 'string');
    assert.equal(typeof mv0.evaluation, 'number');
    assert.equal(typeof mv0.moveLan, 'string');
    assert.ok(mv0.moveLan.length >= 4, `expected uci move, got "${mv0.moveLan}"`);
  });

  it('detects mate in the mate-in-1 fixture', () => {
    const raw = loadFixture('torch-mate-in-1.json');
    const out = parseFetchAnalysisJson(raw);
    const lastMove = out.moveAnalyses[out.moveAnalyses.length - 1];
    assert.ok(
      lastMove.mateIn !== null || Math.abs(lastMove.evaluation) > 50,
      `expected mate or saturated eval, got mateIn=${lastMove.mateIn} eval=${lastMove.evaluation}`,
    );
  });

  it('aggregates tallies per side from the JSON', () => {
    const raw = loadFixture('torch-italian-25moves.json');
    const out = parseFetchAnalysisJson(raw);
    assert.equal(typeof out.tallies.white.blunder, 'number');
    assert.equal(typeof out.tallies.black.brilliant, 'number');
    assert.equal(typeof out.tallies.white.book, 'number');
  });

  it('exposes effective Elo on the italian fixture', () => {
    const raw = loadFixture('torch-italian-25moves.json');
    const out = parseFetchAnalysisJson(raw);
    assert.equal(out.effectiveElo.white, 2300);
    assert.equal(out.effectiveElo.black, 2300);
  });

  it('throws on non-object input', () => {
    assert.throws(() => parseFetchAnalysisJson(null), /expected object/);
    assert.throws(() => parseFetchAnalysisJson('string'), /expected object/);
  });

  it('handles missing fields with safe defaults', () => {
    const out = parseFetchAnalysisJson({ positions: [], CAPS: {}, reportCard: {}, tallies: {} });
    assert.equal(out.moveAnalyses.length, 0);
    assert.equal(out.caps.white.all, 0);
    assert.equal(out.effectiveElo.white, 0);
    assert.equal(out.tallies.white.blunder, 0);
  });
});
