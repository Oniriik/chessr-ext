import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorldchessPageAdapter } from '../worldchessPageAdapter.js';

function installDom(pathname = '/game/1924d979-ac9d-4def-b4a9-a6b5a12de0c5') {
  const noop = () => {};
  const elProto = {
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop, contains: () => false },
    rotation: 0,
  };
  (globalThis as any).document = {
    documentElement: elProto,
    body: elProto,
    head: elProto,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    createElement: () => ({ ...elProto, style: {}, click: noop }),
    getElementById: () => null,
    elementFromPoint: () => null,
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).location = {
    href: `https://worldchess.com${pathname}`,
    hostname: 'worldchess.com',
    pathname,
  };
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  (globalThis as any).addEventListener = noop;
  (globalThis as any).removeEventListener = noop;
}

function installEngine(opts: {
  gameId?: string;
  fen?: string;
  turn?: 'w' | 'b';
  moveImpl?: (uci: string, opts?: any) => Promise<unknown>;
} = {}) {
  const gameId = opts.gameId ?? '1924d979-ac9d-4def-b4a9-a6b5a12de0c5';
  const state = {
    currentFen: opts.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: opts.turn ?? 'w',
    checkmateData: { check: false, checkmate: false, kingIndex: -1 },
  };
  const subs: Record<string, Array<(...args: unknown[]) => void>> = {};
  const store = {
    get: () => state,
    on: (field: string, cb: (...args: unknown[]) => void) => {
      (subs[field] ||= []).push(cb);
      // Mirror real chessgun: fire immediately on subscribe.
      cb(state[field as keyof typeof state]);
      return () => {
        const arr = subs[field];
        if (!arr) return;
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },
  };
  const engine = {
    store,
    on: (f: string, cb: (...args: unknown[]) => void) => store.on(f, cb),
    move: opts.moveImpl ?? (async () => undefined),
  };
  (globalThis as any)[`chessEngine: ${gameId}`] = engine;
  return { engine, state, subs };
}

describe('WorldchessPageAdapter — host matching', () => {
  it('matches worldchess.com and subdomains', () => {
    const a = new WorldchessPageAdapter();
    assert.equal(a.matches('worldchess.com'), true);
    assert.equal(a.matches('www.worldchess.com'), true);
    assert.equal(a.matches('en.worldchess.com'), true);
  });

  it('rejects chess.com and others', () => {
    const a = new WorldchessPageAdapter();
    assert.equal(a.matches('chess.com'), false);
    assert.equal(a.matches('lichess.org'), false);
    assert.equal(a.matches('worldchesss.com'), false);
    assert.equal(a.matches('example.com'), false);
  });
});

describe('WorldchessPageAdapter — executeMove', () => {
  beforeEach(() => installDom());

  it('routes through chessEngine.move(uci, { isUserMove: true })', async () => {
    let played: string | null = null;
    let opts: any = null;
    const a = new WorldchessPageAdapter();
    installEngine({
      moveImpl: async (uci, o) => { played = uci; opts = o; },
    });
    // Manually attach engine via private boot path: install + tick.
    const dispose = a.install(() => {});
    // Allow the boot poll to fire. install() schedules the first tick at 200ms.
    await new Promise((r) => setTimeout(r, 250));

    const ok = await a.executeMove('e2e4');
    assert.equal(ok, true);
    assert.equal(played, 'e2e4');
    assert.equal(opts?.isUserMove, true);
    dispose();
  });

  it('returns false when no engine attached', async () => {
    installDom('/lobby');
    const a = new WorldchessPageAdapter();
    const ok = await a.executeMove('e2e4');
    assert.equal(ok, false);
  });

  it('rejects malformed UCI', async () => {
    const a = new WorldchessPageAdapter();
    installEngine();
    assert.equal(await a.executeMove(''), false);
    assert.equal(await a.executeMove('e2'), false);
  });
});

describe('WorldchessPageAdapter — premove + rematch + cancel', () => {
  beforeEach(() => installDom());

  it('cancelPremoves is a no-op (no exception)', () => {
    const a = new WorldchessPageAdapter();
    assert.doesNotThrow(() => a.cancelPremoves());
  });

  it('requestRematch returns false when no New Game button found', () => {
    const a = new WorldchessPageAdapter();
    assert.equal(a.requestRematch(), false);
  });
});
