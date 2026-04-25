/**
 * diagBuffer — categorized ring buffers + structured snapshot collector
 * for the Settings → "Copy debug logs" button.
 *
 * Design goals:
 *   1. Per-feature buckets: a fast-firing event (e.g. opponent move →
 *      eval bar update every second) doesn't evict useful context like
 *      the last newGame or the last suggestion before things broke.
 *   2. Auto-classification on the WS path — no need for content.tsx to
 *      add explicit calls for every protocol message; recordWsSend /
 *      recordWsRecv routes by message-type prefix into the right bucket.
 *   3. Snapshot is JSON-serialisable end-to-end. Good for clipboard
 *      paste (collectDebugDump) AND for a future POST-to-server
 *      endpoint (collectDebugObject).
 *
 * Bucket sizes are conservative — bump if we need deeper history later.
 */

const TRUNC_PAYLOAD_AT = 400;

type Level = 'warn' | 'error';

interface LogEntry {
  ts: number;
  level: Level;
  msg: string;
}

interface WsEntry {
  ts: number;
  dir: 'send' | 'recv';
  type: string;
  preview: string;
}

interface EventEntry {
  ts: number;
  type: string;
  preview: string;
}

interface EngineSwapEntry {
  ts: number;
  slot: 'suggestion' | 'analysis';
  engineId?: string;
  mode: 'wasm' | 'server';
  success: boolean;
  detail?: string;        // error message on fail, free-form on success
}

// ─── Buffers ───────────────────────────────────────────────────────────

function ring<T>(max: number) {
  const arr: T[] = [];
  return {
    push(item: T) { if (arr.length >= max) arr.shift(); arr.push(item); },
    snapshot(): T[] { return [...arr]; },
    get length() { return arr.length; },
  };
}

const buffers = {
  errors:       ring<LogEntry>(10),
  events: {
    newGame:    ring<EventEntry>(5),
    move:       ring<EventEntry>(10),
    gameEnd:    ring<EventEntry>(5),
    other:      ring<EventEntry>(5),
  },
  suggestions:  ring<WsEntry>(10),
  analyses:     ring<WsEntry>(10),
  evals:        ring<WsEntry>(10),
  maia:         ring<WsEntry>(10),
  ws:           ring<WsEntry>(20),
  engineSwaps:  ring<EngineSwapEntry>(10),
};

interface EngineSnap {
  id?: string;
  mode?: 'wasm' | 'server';
  ready?: boolean;
}
const engineSnap: { suggestion?: EngineSnap; analysis?: EngineSnap } = {};

// ─── Capture: console + global errors ─────────────────────────────────

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) {
    const head = `${a.name || 'Error'}: ${a.message || '(no message)'}`;
    const stack = a.stack
      ? '\n  ' + a.stack.split('\n').slice(1, 4).map((l) => l.trim()).join('\n  ')
      : '';
    return head + stack;
  }
  if (a == null) return String(a);
  if (typeof a === 'object') {
    try {
      const s = JSON.stringify(a);
      return s === '{}' && Object.keys(a as object).length === 0
        ? `(empty ${(a as object).constructor?.name ?? 'object'})`
        : s.slice(0, TRUNC_PAYLOAD_AT);
    } catch { return String(a); }
  }
  return String(a);
}

let installed = false;
export function installDiagCapture(): void {
  if (installed) return;
  installed = true;

  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...a: unknown[]) => {
    buffers.errors.push({ ts: Date.now(), level: 'warn',  msg: a.map(formatArg).join(' ').slice(0, 1500) });
    origWarn(...a);
  };
  console.error = (...a: unknown[]) => {
    buffers.errors.push({ ts: Date.now(), level: 'error', msg: a.map(formatArg).join(' ').slice(0, 1500) });
    origError(...a);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      buffers.errors.push({
        ts: Date.now(), level: 'error',
        msg: `[window.onerror] ${e.message} ${e.filename || '?'}:${e.lineno || '?'}`,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      buffers.errors.push({
        ts: Date.now(), level: 'error',
        msg: `[unhandledrejection] ${String((e as PromiseRejectionEvent).reason)}`,
      });
    });
  }
}

// ─── Capture: WebSocket messages (auto-classify by type) ──────────────

function classifyWs(type: string): keyof typeof buffers | 'other' {
  if (type.startsWith('suggestion_')) return 'suggestions';
  if (type.startsWith('analysis_'))   return 'analyses';
  if (type.startsWith('eval_log') || type === 'engine_eval_request' || type === 'engine_eval_response' || type === 'engine_eval_error') return 'evals';
  if (type === 'maia_request')        return 'maia';
  return 'other';
}

function pushWs(dir: 'send' | 'recv', data: unknown): void {
  let type = 'unknown';
  let preview = '';
  try {
    const obj = data as Record<string, unknown>;
    if (obj && typeof obj === 'object' && 'type' in obj) type = String(obj.type);
    preview = JSON.stringify(data).slice(0, TRUNC_PAYLOAD_AT);
  } catch {
    preview = String(data).slice(0, TRUNC_PAYLOAD_AT);
  }
  const entry: WsEntry = { ts: Date.now(), dir, type, preview };
  buffers.ws.push(entry);
  const cat = classifyWs(type);
  if (cat !== 'other') {
    (buffers[cat] as ReturnType<typeof ring<WsEntry>>).push(entry);
  }
}
export function recordWsSend(data: unknown): void { pushWs('send', data); }
export function recordWsRecv(data: unknown): void { pushWs('recv', data); }

// ─── Capture: chessr:* events from the page ───────────────────────────

export function recordChessrEvent(type: string, payload: Record<string, unknown>): void {
  const interesting = ['fen', 'move', 'gameOver', 'gameEnd', 'turn', 'playingAs', 'name', 'value'];
  const compact: Record<string, unknown> = {};
  for (const k of interesting) {
    if (k in payload) compact[k] = payload[k];
  }
  const entry: EventEntry = {
    ts: Date.now(),
    type,
    preview: JSON.stringify(compact).slice(0, TRUNC_PAYLOAD_AT),
  };
  if (type.endsWith(':newGame'))      buffers.events.newGame.push(entry);
  else if (type.endsWith(':move'))    buffers.events.move.push(entry);
  else if (type.endsWith(':gameEnd')) buffers.events.gameEnd.push(entry);
  else                                 buffers.events.other.push(entry);
}

// ─── Capture: engine swaps (called by content.tsx createEngine) ───────

export function recordEngineSwap(entry: Omit<EngineSwapEntry, 'ts'>): void {
  buffers.engineSwaps.push({ ts: Date.now(), ...entry });
  // Also update the live snapshot so collectDebugObject reflects the
  // current engine state without needing a separate getter.
  setEngineState(entry.slot, { id: entry.engineId, mode: entry.mode, ready: entry.success });
}

export function setEngineState(slot: 'suggestion' | 'analysis', state: EngineSnap): void {
  engineSnap[slot] = { ...state };
}

// ─── Snapshot ──────────────────────────────────────────────────────────

export interface DebugSnapshot {
  schemaVersion: 2;
  capturedAt: string;
  client: {
    extensionVersion?: string;
    buildEnv?: string;
    userAgent: string;
    url: string;
  };
  connection: { wsUrl?: string };
  user: { id?: string; plan?: string };
  engines: {
    selected?: string;
    suggestion?: EngineSnap;
    analysis?: EngineSnap;
  };
  game?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  devFlags: {
    chessrForceServer: string | null;
    chessrFailWasm: string | null;
  };
  background: {
    available: boolean;
    bootedAt?: string;
    uptimeSeconds?: number;
    extensionVersion?: string;
    logs: LogEntry[];
  };
  recent: {
    errors: LogEntry[];
    events: {
      newGame: EventEntry[];
      move: EventEntry[];
      gameEnd: EventEntry[];
      other: EventEntry[];
    };
    suggestions: WsEntry[];
    analyses: WsEntry[];
    evals: WsEntry[];
    maia: WsEntry[];
    engineSwaps: EngineSwapEntry[];
    ws: WsEntry[];
  };
  meta: Record<string, unknown>;
}

interface BackgroundDump {
  meta?: Record<string, unknown>;
  logs?: LogEntry[];
}

export async function collectDebugObject(meta: Record<string, unknown>): Promise<DebugSnapshot> {
  let bg: BackgroundDump = {};
  let bgOk = false;
  try {
    bg = await Promise.race([
      browser.runtime.sendMessage({ type: 'getBackgroundDiag' }) as Promise<BackgroundDump>,
      new Promise<BackgroundDump>((res) => setTimeout(() => res({}), 1500)),
    ]);
    bgOk = !!(bg && (bg.meta || bg.logs));
  } catch { /* SW unavailable */ }

  const devFlags = (() => {
    try {
      return {
        chessrForceServer: localStorage.chessrForceServer || null,
        chessrFailWasm:    localStorage.chessrFailWasm    || null,
      };
    } catch { return { chessrForceServer: null, chessrFailWasm: null }; }
  })();

  return {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    client: {
      extensionVersion: meta.extensionVersion as string | undefined,
      buildEnv:         meta.buildEnv as string | undefined,
      userAgent:        typeof navigator !== 'undefined' ? navigator.userAgent : '',
      url:              typeof location !== 'undefined' ? location.href : '',
    },
    connection: { wsUrl: meta.wsUrl as string | undefined },
    user: { id: meta.userId as string | undefined, plan: meta.plan as string | undefined },
    engines: {
      selected:   meta.engineId as string | undefined,
      suggestion: engineSnap.suggestion,
      analysis:   engineSnap.analysis,
    },
    game:     meta.game as Record<string, unknown> | undefined,
    settings: meta.settings as Record<string, unknown> | undefined,
    devFlags,
    background: {
      available: bgOk,
      bootedAt:        bg.meta?.bootedAt as string | undefined,
      uptimeSeconds:   bg.meta?.uptimeSeconds as number | undefined,
      extensionVersion: bg.meta?.extensionVersion as string | undefined,
      logs:            bg.logs ?? [],
    },
    recent: {
      errors:      buffers.errors.snapshot(),
      events: {
        newGame: buffers.events.newGame.snapshot(),
        move:    buffers.events.move.snapshot(),
        gameEnd: buffers.events.gameEnd.snapshot(),
        other:   buffers.events.other.snapshot(),
      },
      suggestions: buffers.suggestions.snapshot(),
      analyses:    buffers.analyses.snapshot(),
      evals:       buffers.evals.snapshot(),
      maia:        buffers.maia.snapshot(),
      engineSwaps: buffers.engineSwaps.snapshot(),
      ws:          buffers.ws.snapshot(),
    },
    meta,
  };
}

// ─── Text dump (clipboard / Discord paste) ────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

function dumpEntries(out: string[], title: string, entries: Array<{ ts: number; level?: string; dir?: string; type?: string; msg?: string; preview?: string }>): void {
  out.push(`\n========== Last ${entries.length} ${title} ==========`);
  if (entries.length === 0) { out.push('(none)'); return; }
  for (const e of entries) {
    const prefix = e.level ? e.level.toUpperCase().padEnd(5)
                  : e.dir ? (e.dir === 'send' ? '→' : '←')
                  : '';
    const body = e.msg ?? `${(e.type ?? '').padEnd(28)} ${e.preview ?? ''}`;
    out.push(`[${fmtTs(e.ts)}] ${prefix} ${body}`.trimEnd());
  }
}

export async function collectDebugDump(meta: Record<string, unknown>): Promise<string> {
  const snap = await collectDebugObject(meta);
  const out: string[] = [];

  out.push('========== Chessr Debug Dump ==========');
  out.push(`schemaVersion : ${snap.schemaVersion}`);
  out.push(`capturedAt    : ${snap.capturedAt}`);
  out.push(`extension     : ${snap.client.extensionVersion ?? '?'} (${snap.client.buildEnv ?? '?'})`);
  out.push(`UA            : ${snap.client.userAgent}`);
  out.push(`URL           : ${snap.client.url}`);

  out.push('\n========== Connection ==========');
  out.push(`wsUrl: ${snap.connection.wsUrl ?? '?'}`);

  out.push('\n========== User ==========');
  out.push(`id   : ${snap.user.id ?? '(none)'}`);
  out.push(`plan : ${snap.user.plan ?? '(none)'}`);

  out.push('\n========== Engines ==========');
  out.push(`selected  : ${snap.engines.selected ?? '?'}`);
  out.push(`suggestion: ${JSON.stringify(snap.engines.suggestion ?? {})}`);
  out.push(`analysis  : ${JSON.stringify(snap.engines.analysis ?? {})}`);

  if (snap.game) {
    out.push('\n========== Game state ==========');
    for (const [k, v] of Object.entries(snap.game)) out.push(`${k}: ${JSON.stringify(v)}`);
  }
  if (snap.settings) {
    out.push('\n========== Settings ==========');
    for (const [k, v] of Object.entries(snap.settings)) out.push(`${k}: ${JSON.stringify(v)}`);
  }

  out.push('\n========== Dev flags ==========');
  out.push(`chessrForceServer: ${snap.devFlags.chessrForceServer ?? '(unset)'}`);
  out.push(`chessrFailWasm   : ${snap.devFlags.chessrFailWasm   ?? '(unset)'}`);

  out.push('\n========== Background SW ==========');
  if (!snap.background.available) {
    out.push('(unavailable — SW asleep or unreachable within 1.5s)');
  } else {
    out.push(`bootedAt        : ${snap.background.bootedAt}`);
    out.push(`uptimeSeconds   : ${snap.background.uptimeSeconds}`);
    out.push(`extensionVersion: ${snap.background.extensionVersion}`);
    if (snap.background.logs.length) {
      out.push(`Last ${snap.background.logs.length} bg warnings/errors:`);
      for (const e of snap.background.logs) {
        out.push(`  [${fmtTs(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}`);
      }
    }
  }

  // Per-feature buckets
  dumpEntries(out, 'errors',                   snap.recent.errors);
  dumpEntries(out, 'engine swaps',             snap.recent.engineSwaps.map((e) => ({
    ts: e.ts,
    msg: `${e.slot.padEnd(10)} ${e.engineId ?? '?'} ${e.mode} success=${e.success}${e.detail ? ' — ' + e.detail : ''}`,
  })));
  dumpEntries(out, 'newGame events',           snap.recent.events.newGame);
  dumpEntries(out, 'move events',              snap.recent.events.move);
  dumpEntries(out, 'gameEnd events',           snap.recent.events.gameEnd);
  dumpEntries(out, 'other chessr:* events',    snap.recent.events.other);
  dumpEntries(out, 'suggestion WS messages',   snap.recent.suggestions);
  dumpEntries(out, 'analysis WS messages',     snap.recent.analyses);
  dumpEntries(out, 'eval WS messages',         snap.recent.evals);
  dumpEntries(out, 'maia WS messages',         snap.recent.maia);
  dumpEntries(out, 'raw WS messages (any)',    snap.recent.ws);

  return out.join('\n');
}
