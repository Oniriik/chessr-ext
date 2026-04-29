// Background service worker. Two responsibilities:
//   1. Proxy fetches of extension assets when the content script needs
//      to read its own /engine/* files (rare in v3+ — most assets are
//      fetched directly).
//   2. Maintain a small ring buffer of warn/error logs + boot meta so
//      the Settings → "Copy debug logs" button can pull them via
//      runtime.sendMessage({ type: 'getBackgroundDiag' }).

interface BgLogEntry {
  ts: number;
  level: 'log' | 'warn' | 'error';
  msg: string;
}

const BG_LOG_MAX = 100;
const bgLogs: BgLogEntry[] = [];

function pushBg(level: BgLogEntry['level'], args: unknown[]): void {
  if (bgLogs.length >= BG_LOG_MAX) bgLogs.shift();
  const msg = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ').slice(0, 800);
  bgLogs.push({ ts: Date.now(), level, msg });
}

const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);
console.warn = (...a: unknown[]) => { pushBg('warn', a); origWarn(...a); };
console.error = (...a: unknown[]) => { pushBg('error', a); origError(...a); };

// `self` may not exist when WXT pre-evaluates this file under Node at
// build time. Gate on its presence so the dev/prod build doesn't crash.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('error', (e: any) => {
    pushBg('error', ['[bg.onerror]', e?.message || String(e), (e?.filename || '?') + ':' + (e?.lineno || '?')]);
  });
  self.addEventListener('unhandledrejection', (e: any) => {
    pushBg('error', ['[bg.unhandledrejection]', String(e?.reason)]);
  });
}

const bootedAt = Date.now();

// CDP-based native mouse-event injector. Lichess's chessground rejects
// synthesised pointer events on round (live games) — `setPointerCapture`
// + drag-distance threshold checks make `dispatchEvent` unreliable.
// `chrome.debugger.sendCommand("Input.dispatchMouseEvent")` injects events
// at the OS-input layer, indistinguishable from real user clicks. Cost:
// while the debugger is attached, Chrome shows a "Chessr is debugging
// this browser" banner that the user can dismiss (which detaches us).
const attachedTabs = new Set<number>();

async function ensureAttached(tabId: number): Promise<boolean> {
  if (attachedTabs.has(tabId)) return true;
  try {
    await new Promise<void>((resolve, reject) => {
      // Casting because the wxt-shipped browser typings sometimes miss
      // chrome.debugger when running under firefox-mode TS check.
      const dbg = (browser as any).debugger;
      if (!dbg?.attach) return reject(new Error('debugger API unavailable'));
      dbg.attach({ tabId }, '1.3', () => {
        const lastErr = (browser.runtime as any).lastError;
        if (lastErr) return reject(new Error(lastErr.message));
        resolve();
      });
    });
    attachedTabs.add(tabId);
    return true;
  } catch (err) {
    pushBg('warn', ['[cdp] attach failed', String(err)]);
    return false;
  }
}

function sendCdp(tabId: number, method: string, params: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const dbg = (browser as any).debugger;
    dbg.sendCommand({ tabId }, method, params, (res: unknown) => {
      const lastErr = (browser.runtime as any).lastError;
      if (lastErr) return reject(new Error(lastErr.message));
      resolve(res);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function cdpMouseMove(
  tabId: number,
  fromX: number, fromY: number, toX: number, toY: number,
  pickDelay = 0, selectDelay = 0, moveDelay = 0,
): Promise<boolean> {
  if (!(await ensureAttached(tabId))) return false;
  try {
    // Phase 1: idle pause before "picking up" the piece (mimics the human
    // pausing to think / hover before clicking).
    if (pickDelay > 0) await delay(pickDelay);

    await sendCdp(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1,
    });

    // Phase 2: hold the piece briefly before starting to drag.
    if (selectDelay > 0) await delay(selectDelay);

    // Phase 3: spread the 10 interpolated moves across moveDelay so the
    // drag visibly takes moveDelay milliseconds end-to-end.
    const steps = 10;
    const stepDelay = moveDelay > 0 ? moveDelay / steps : 0;
    for (let i = 1; i <= steps; i++) {
      const x = fromX + (toX - fromX) * (i / steps);
      const y = fromY + (toY - fromY) * (i / steps);
      await sendCdp(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'left',
      });
      if (stepDelay > 0) await delay(stepDelay);
    }

    await sendCdp(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1,
    });
    return true;
  } catch (err) {
    pushBg('warn', ['[cdp] mouseMove failed', String(err)]);
    return false;
  }
}

export default defineBackground(() => {
  console.log('Chessr v3 background loaded');

  // Track debugger detach (user clicked the "Cancel" banner, or tab closed)
  // so we don't try to reuse a stale attachment.
  const dbg = (browser as any).debugger;
  if (dbg?.onDetach?.addListener) {
    dbg.onDetach.addListener((source: { tabId?: number }) => {
      if (source.tabId !== undefined) attachedTabs.delete(source.tabId);
    });
  }
  browser.tabs.onRemoved.addListener((tabId) => {
    attachedTabs.delete(tabId);
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Existing — proxy fetch for content scripts (legacy path, rare in v3).
    if (msg?.type === 'fetchExtensionFile' && msg.path) {
      fetch(browser.runtime.getURL(msg.path))
        .then((r) => r.text())
        .then((text) => sendResponse({ text }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }

    // CDP mouse move — used by lichess executeMove on round.
    if (msg?.type === 'cdpMouseMove' && sender.tab?.id !== undefined) {
      const { fromX, fromY, toX, toY, pickDelay, selectDelay, moveDelay } = msg;
      cdpMouseMove(
        sender.tab.id,
        fromX, fromY, toX, toY,
        pickDelay ?? 0, selectDelay ?? 0, moveDelay ?? 0,
      )
        .then((ok) => sendResponse({ ok }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    // CDP single click — used for promotion modal selection on lichess.
    if (msg?.type === 'cdpClick' && sender.tab?.id !== undefined) {
      const { x, y } = msg;
      const tabId = sender.tab.id;
      (async () => {
        if (!(await ensureAttached(tabId))) return sendResponse({ ok: false });
        try {
          await sendCdp(tabId, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1,
          });
          await sendCdp(tabId, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }

    // Background-side debug dump for the Settings copy button.
    if (msg?.type === 'getBackgroundDiag') {
      sendResponse({
        meta: {
          bootedAt: new Date(bootedAt).toISOString(),
          uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
          extensionVersion: browser.runtime.getManifest().version,
        },
        logs: bgLogs.slice(-50),
      });
      return false;
    }
  });
});
