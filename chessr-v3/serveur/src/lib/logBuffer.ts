/**
 * Ring buffer of recent log lines + live subscribers.
 *
 * Hooks into console.log / console.error / console.warn so every line emitted
 * by the app (wsLog, [Pool], [Review], Hono middleware, etc.) is captured
 * and fanned out to live SSE subscribers (the dashboard).
 */

type Line = { ts: number; level: 'log' | 'warn' | 'error'; text: string };

const MAX_LINES = 2000;
const buffer: Line[] = [];
const subs = new Set<(line: Line) => void>();

function push(level: Line['level'], args: unknown[]): void {
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  const line: Line = { ts: Date.now(), level, text };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.shift();
  for (const cb of subs) {
    try { cb(line); } catch {}
  }
}

let installed = false;
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => { orig.log(...args); push('log', args); };
  console.warn = (...args: unknown[]) => { orig.warn(...args); push('warn', args); };
  console.error = (...args: unknown[]) => { orig.error(...args); push('error', args); };
}

export function getRecentLines(): Line[] {
  return buffer.slice();
}

export function subscribe(cb: (line: Line) => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
