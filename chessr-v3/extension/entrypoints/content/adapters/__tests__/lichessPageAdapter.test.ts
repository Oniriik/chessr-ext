import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LichessPageAdapter } from '../lichessPageAdapter.js';

// Minimal global stubs so the adapter module can import & run under tsx --test.
function installDom() {
  const noop = () => {};
  const elProto = {
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop, contains: () => false },
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
  (globalThis as any).location = { href: 'https://lichess.org/AbCd1234', hostname: 'lichess.org' };
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  (globalThis as any).addEventListener = noop;
  (globalThis as any).removeEventListener = noop;
  (globalThis as any).history = { pushState: noop, replaceState: noop };
  (globalThis as any).PointerEvent = class { constructor(_t: string, _o: any) {} } as any;
  (globalThis as any).MouseEvent = class { constructor(_t: string, _o: any) {} } as any;
}

function installLichess(opts: { puzzle?: any; sound?: any } = {}) {
  (globalThis as any).lichess = {
    events: { on: () => {} },
    socket: { events: { on: () => {} } },
    sound: opts.sound,
    puzzle: opts.puzzle,
  };
  (globalThis as any).site = { sound: opts.sound };
}

describe('LichessPageAdapter — host matching', () => {
  it('matches lichess.org and subdomains', () => {
    const a = new LichessPageAdapter();
    assert.equal(a.matches('lichess.org'), true);
    assert.equal(a.matches('www.lichess.org'), true);
    assert.equal(a.matches('en.lichess.org'), true);
  });

  it('rejects chess.com and others', () => {
    const a = new LichessPageAdapter();
    assert.equal(a.matches('chess.com'), false);
    assert.equal(a.matches('www.chess.com'), false);
    assert.equal(a.matches('lichesss.org'), false);
    assert.equal(a.matches('example.com'), false);
  });
});

describe('LichessPageAdapter — executeMove', () => {
  beforeEach(() => installDom());

  it('routes puzzle through puzzle.playUci(uci) (preferred path)', async () => {
    let played: string | null = null;
    installLichess({ puzzle: { playUci: (uci: string) => { played = uci; } } });

    const a = new LichessPageAdapter();
    const ok = await a.executeMove('e7e8q');
    assert.equal(ok, true);
    assert.equal(played, 'e7e8q');
  });

  it('returns false when board missing AND no puzzle ctrl', async () => {
    installLichess();
    const a = new LichessPageAdapter();
    const ok = await a.executeMove('e2e4');
    assert.equal(ok, false);
  });

  it('rejects malformed UCI', async () => {
    installLichess({ puzzle: { playUci: () => {} } });
    const a = new LichessPageAdapter();
    assert.equal(await a.executeMove(''), false);
    assert.equal(await a.executeMove('e2'), false);
  });
});

describe('LichessPageAdapter — premove + rematch + cancel', () => {
  beforeEach(() => installDom());

  it('cancelPremoves is a no-op (no exception)', () => {
    installLichess();
    const a = new LichessPageAdapter();
    assert.doesNotThrow(() => a.cancelPremoves());
  });

  it('requestRematch returns false when no rematch button found', () => {
    installLichess();
    const a = new LichessPageAdapter();
    assert.equal(a.requestRematch(), false);
  });
});
