/**
 * diagBuffer — collects diagnostics for the "Copy debug logs" button in
 * Settings. Patches the content script's `console.warn` / `console.error`
 * + the global `error` / `unhandledrejection` events into a ring buffer,
 * mirrors WS sent/received messages, and assembles a single text dump
 * the user can paste into a support ticket / Discord.
 *
 * Background script logs are fetched on-demand via runtime.sendMessage
 * (`type: 'getBackgroundDiag'`) — see entrypoints/background.ts.
 */

const MAX_LOG_ENTRIES = 200;
const MAX_WS_ENTRIES = 100;
const TRUNC_PAYLOAD_AT = 400;

type Level = 'log' | 'warn' | 'error';

interface LogEntry {
  ts: number;
  level: Level;
  msg: string;
}

interface WsEntry {
  ts: number;
  dir: 'send' | 'recv';
  type: string;
  preview: string;       // truncated JSON
}

const logs: LogEntry[] = [];
const wsHistory: WsEntry[] = [];

function pushLog(level: Level, args: unknown[]): void {
  if (logs.length >= MAX_LOG_ENTRIES) logs.shift();
  const msg = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a, null, 0).slice(0, TRUNC_PAYLOAD_AT); }
    catch { return String(a); }
  }).join(' ');
  logs.push({ ts: Date.now(), level, msg: msg.slice(0, 1000) });
}

function pushWs(dir: 'send' | 'recv', data: unknown): void {
  if (wsHistory.length >= MAX_WS_ENTRIES) wsHistory.shift();
  let type = 'unknown';
  let preview = '';
  try {
    const obj = data as Record<string, unknown>;
    if (obj && typeof obj === 'object' && 'type' in obj) {
      type = String(obj.type);
    }
    preview = JSON.stringify(data).slice(0, TRUNC_PAYLOAD_AT);
  } catch {
    preview = String(data).slice(0, TRUNC_PAYLOAD_AT);
  }
  wsHistory.push({ ts: Date.now(), dir, type, preview });
}

let installed = false;
export function installDiagCapture(): void {
  if (installed) return;
  installed = true;
  // We don't replace console.log to avoid polluting the buffer with
  // every dbg message, but warn + error matter.
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...a: unknown[]) => { pushLog('warn', a); origWarn(...a); };
  console.error = (...a: unknown[]) => { pushLog('error', a); origError(...a); };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      pushLog('error', ['[window.onerror]', e.message, (e.filename || '?') + ':' + (e.lineno || '?')]);
    });
    window.addEventListener('unhandledrejection', (e) => {
      pushLog('error', ['[unhandledrejection]', String((e as PromiseRejectionEvent).reason)]);
    });
  }
}

export function recordWsSend(data: unknown): void { pushWs('send', data); }
export function recordWsRecv(data: unknown): void { pushWs('recv', data); }

// ─── Dump assembly ────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 23); // HH:mm:ss.sss
}

interface BackgroundDump {
  logs?: LogEntry[];
  meta?: Record<string, unknown>;
}

/** Collect a full diagnostics dump as a single multi-section string,
 *  ready to copy to clipboard. */
export async function collectDebugDump(meta: Record<string, unknown>): Promise<string> {
  const sections: string[] = [];
  const now = new Date().toISOString();

  sections.push('========== Chessr Debug Dump ==========');
  sections.push(`Timestamp:  ${now}`);
  sections.push(`UA:         ${navigator.userAgent}`);
  sections.push(`URL:        ${location.href}`);

  sections.push('\n========== Meta ==========');
  for (const [k, v] of Object.entries(meta)) {
    sections.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }

  // localStorage debug toggles — useful to know if user forced a server fallback
  try {
    const force = localStorage.chessrForceServer || '';
    const fail = localStorage.chessrFailWasm || '';
    sections.push(`chessrForceServer: ${force || '(unset)'}`);
    sections.push(`chessrFailWasm:    ${fail || '(unset)'}`);
  } catch { /* ignore storage block */ }

  // Background dump (best-effort — the SW may be asleep, that's fine)
  let bg: BackgroundDump = {};
  try {
    bg = await Promise.race([
      browser.runtime.sendMessage({ type: 'getBackgroundDiag' }) as Promise<BackgroundDump>,
      new Promise<BackgroundDump>((res) => setTimeout(() => res({}), 1500)),
    ]);
  } catch { /* SW unavailable */ }

  if (bg?.meta && Object.keys(bg.meta).length) {
    sections.push('\n========== Background meta ==========');
    for (const [k, v] of Object.entries(bg.meta)) {
      sections.push(`${k}: ${String(v)}`);
    }
  }

  sections.push(`\n========== Last ${logs.length} content-script warnings/errors ==========`);
  if (logs.length === 0) sections.push('(none)');
  for (const e of logs) {
    sections.push(`[${fmtTs(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}`);
  }

  if (bg?.logs?.length) {
    sections.push(`\n========== Last ${bg.logs.length} background warnings/errors ==========`);
    for (const e of bg.logs) {
      sections.push(`[${fmtTs(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}`);
    }
  }

  sections.push(`\n========== Last ${wsHistory.length} WS messages ==========`);
  if (wsHistory.length === 0) sections.push('(none)');
  for (const w of wsHistory) {
    const arrow = w.dir === 'send' ? '→' : '←';
    sections.push(`[${fmtTs(w.ts)}] ${arrow} ${w.type.padEnd(28)} ${w.preview}`);
  }

  return sections.join('\n');
}
