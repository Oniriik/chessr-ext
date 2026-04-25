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

export default defineBackground(() => {
  console.log('Chessr v3 background loaded');

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Existing — proxy fetch for content scripts (legacy path, rare in v3).
    if (msg?.type === 'fetchExtensionFile' && msg.path) {
      fetch(browser.runtime.getURL(msg.path))
        .then((r) => r.text())
        .then((text) => sendResponse({ text }))
        .catch((err) => sendResponse({ error: err.message }));
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
