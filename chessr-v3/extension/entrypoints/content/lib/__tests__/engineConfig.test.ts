import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineSetOptions, type EngineParams } from '../engineConfig.js';

const base: EngineParams = {
  targetElo: 1800,
  personality: 'Default',
  multiPv: 3,
  limitStrength: true,
  dynamism: 130,
  kingSafety: 80,
  variety: 4,
};

describe('buildEngineSetOptions', () => {
  it('emits all options when all are supported (space-form UCI)', () => {
    const supported = new Set(['MultiPV', 'Personality', 'UCI LimitStrength', 'UCI Elo', 'Dynamism', 'King Safety', 'Variety']);
    const out = buildEngineSetOptions(base, supported);
    assert.equal(out.MultiPV, '3');
    assert.equal(out.Personality, 'Default');
    assert.equal(out['UCI LimitStrength'], 'true');
    assert.equal(out['UCI Elo'], '1800');
    assert.equal(out.Dynamism, '130');
    assert.equal(out['King Safety'], '80');
    assert.equal(out.Variety, '4');
  });

  it('accepts underscore-form UCI_Elo / UCI_LimitStrength when Komodo advertises those', () => {
    const supported = new Set(['MultiPV', 'UCI_LimitStrength', 'UCI_Elo']);
    const out = buildEngineSetOptions(base, supported);
    assert.equal(out.UCI_LimitStrength, 'true');
    assert.equal(out.UCI_Elo, '1800');
    assert.ok(!('UCI Elo' in out));
    assert.ok(!('Personality' in out));
  });

  it('falls back to Skill Level when UCI Elo is unsupported', () => {
    const supported = new Set(['MultiPV', 'Skill Level']);
    const out = buildEngineSetOptions({ ...base, targetElo: 1950 }, supported);
    assert.equal(out['Skill Level'], '50');
    assert.ok(!('UCI Elo' in out));
    assert.ok(!('UCI_Elo' in out));
  });

  it('clamps Skill Level to [0, 100]', () => {
    const supported = new Set(['MultiPV', 'Skill Level']);
    assert.equal(buildEngineSetOptions({ ...base, targetElo: 200 }, supported)['Skill Level'], '0');
    assert.equal(buildEngineSetOptions({ ...base, targetElo: 9999 }, supported)['Skill Level'], '100');
  });

  it('skips Personality / Dynamism / King Safety / Variety when unsupported', () => {
    const supported = new Set(['MultiPV', 'UCI Elo', 'UCI LimitStrength']);
    const out = buildEngineSetOptions(base, supported);
    assert.ok(!('Personality' in out));
    assert.ok(!('Dynamism' in out));
    assert.ok(!('King Safety' in out));
    assert.ok(!('Variety' in out));
  });

  it('clamps targetElo to [400, 3500] and multiPv to [1, 3]', () => {
    const supported = new Set(['MultiPV', 'UCI Elo', 'UCI LimitStrength']);
    assert.equal(buildEngineSetOptions({ ...base, targetElo: 100, multiPv: 10 }, supported)['UCI Elo'], '400');
    assert.equal(buildEngineSetOptions({ ...base, targetElo: 5000, multiPv: 10 }, supported).MultiPV, '3');
  });

  it('clamps Dynamism and King Safety to [0, 200]', () => {
    const supported = new Set(['MultiPV', 'Dynamism', 'King Safety']);
    assert.equal(buildEngineSetOptions({ ...base, dynamism: -10, kingSafety: 999 }, supported).Dynamism, '0');
    assert.equal(buildEngineSetOptions({ ...base, dynamism: -10, kingSafety: 999 }, supported)['King Safety'], '200');
  });

  it('disables OwnBook when multiPv > 1 (book cannot return alternatives)', () => {
    const supported = new Set(['MultiPV', 'OwnBook']);
    assert.equal(buildEngineSetOptions({ ...base, multiPv: 1 }, supported).OwnBook, 'true');
    assert.equal(buildEngineSetOptions({ ...base, multiPv: 3 }, supported).OwnBook, 'false');
  });

  it('omits OwnBook when the engine does not advertise it', () => {
    const supported = new Set(['MultiPV']);
    const out = buildEngineSetOptions({ ...base, multiPv: 3 }, supported);
    assert.ok(!('OwnBook' in out));
  });

  it('omits dynamism / kingSafety / variety when value not provided', () => {
    const supported = new Set(['MultiPV', 'UCI Elo', 'UCI LimitStrength', 'Dynamism', 'King Safety', 'Variety']);
    const out = buildEngineSetOptions(
      { ...base, dynamism: undefined, kingSafety: undefined, variety: undefined },
      supported,
    );
    assert.ok(!('Dynamism' in out));
    assert.ok(!('King Safety' in out));
    assert.ok(!('Variety' in out));
  });
});
