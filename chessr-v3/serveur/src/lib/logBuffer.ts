/**
 * Ring buffer of recent log lines + live subscribers + on-disk rotation.
 *
 * Hooks into console.log / console.error / console.warn so every line emitted
 * by the app (wsLog, [Pool], [Review], Hono middleware, etc.) is captured,
 * fanned out to live SSE subscribers (the dashboard) AND appended to a
 * rotating file under LOG_DIR (default /app/logs in Docker, ./logs in local).
 *
 * On boot we replay the tail of the most recent file so the dashboard's
 * "recent history" view survives a serveur restart.
 */

import { existsSync, mkdirSync, statSync, renameSync, readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

type Line = { ts: number; level: 'log' | 'warn' | 'error'; text: string };

const MAX_LINES = 2000;
const buffer: Line[] = [];
const subs = new Set<(line: Line) => void>();

// File rotation: 5 files × 10 MB. With ~150 B/line, that's ~330k lines of
// retention — about a day of normal traffic.
const LOG_DIR = process.env.LOG_DIR || (process.env.NODE_ENV === 'production' ? '/app/logs' : './logs');
const LOG_FILE = 'server.log';
const ROTATE_BYTES = 10 * 1024 * 1024;
const ROTATE_KEEP = 5;

let logPath = '';
let diskReady = false;

// ANSI escape stripper — keep the on-disk file readable in `tail -f` /
// editors. The dashboard SSE stream still gets the colored text via the
// in-memory buffer.
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function ensureDiskReady(): void {
  if (diskReady) return;
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    logPath = join(LOG_DIR, LOG_FILE);
    diskReady = true;
  } catch {
    diskReady = false;
  }
}

function rotateIfNeeded(): void {
  if (!diskReady) return;
  try {
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size < ROTATE_BYTES) return;
    // Shift .N → .N+1
    for (let i = ROTATE_KEEP - 1; i >= 1; i--) {
      const src = `${logPath}.${i}`;
      const dst = `${logPath}.${i + 1}`;
      if (existsSync(src)) {
        if (i + 1 > ROTATE_KEEP) { try { unlinkSync(src); } catch {} }
        else { try { renameSync(src, dst); } catch {} }
      }
    }
    try { renameSync(logPath, `${logPath}.1`); } catch {}
  } catch { /* swallow rotation errors */ }
}

function writeDisk(line: Line): void {
  if (!diskReady) return;
  try {
    rotateIfNeeded();
    const ts = new Date(line.ts).toISOString();
    const plain = line.text.replace(ANSI_RE, '');
    appendFileSync(logPath, `${ts} ${line.level.toUpperCase()} ${plain}\n`);
  } catch { /* don't blow up the app on disk errors */ }
}

function replayDisk(): void {
  if (!diskReady) return;
  try {
    if (!existsSync(logPath)) return;
    // Read at most last 256 KB — enough for a few thousand lines, fast.
    const stat = statSync(logPath);
    const tailBytes = Math.min(stat.size, 256 * 1024);
    const buf = readFileSync(logPath);
    const tail = buf.slice(buf.length - tailBytes).toString('utf8');
    const lines = tail.split('\n').slice(-MAX_LINES);
    for (const raw of lines) {
      if (!raw.trim()) continue;
      // Format: "2026-04-25T10:00:00.000Z LEVEL message…"
      const m = raw.match(/^(\S+) (LOG|WARN|ERROR) (.*)$/);
      if (!m) continue;
      const ts = Date.parse(m[1]);
      if (!Number.isFinite(ts)) continue;
      const level = m[2].toLowerCase() as Line['level'];
      buffer.push({ ts, level, text: `[replay] ${m[3]}` });
    }
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  } catch { /* corrupt file? ignore — we'll start fresh */ }
}

function push(level: Line['level'], args: unknown[]): void {
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  const line: Line = { ts: Date.now(), level, text };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.shift();
  writeDisk(line);
  for (const cb of subs) {
    try { cb(line); } catch {}
  }
}

let installed = false;
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  ensureDiskReady();
  replayDisk();
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
