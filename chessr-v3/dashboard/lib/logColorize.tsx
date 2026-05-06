import type { ReactNode } from 'react';
import { ansiToReact } from './ansi';

/**
 * Client-side log line colorizer.
 *
 * The serveur sometimes emits ANSI escapes (wsLog connect/disconnect),
 * sometimes not (replay-style structured lines like
 * `[replay] [user@x.com] [requestId] [START] [suggestion] source=wasm engine=komodo …`).
 * For ANSI lines we delegate to `ansiToReact`; for the rest we tokenize
 * and apply colors based on shape so the dashboard reads at a glance.
 *
 * Color scheme matches the rest of the admin UI (extension-aligned):
 *   - status tokens (START/END/OK/FAIL/ERROR) tinted by severity
 *   - action-type tokens ([suggestion]/[analysis]/[eval]/...) magenta
 *   - emails cyan
 *   - key=value gets gray key + white value
 *   - bare numbers (durations, counts) yellow
 *   - long alphanumeric IDs muted
 */

const STATUS_COLOR: Record<string, string> = {
  // Successes / positive
  START:        '#86efac', // emerald-300
  END:          '#7dd3fc', // sky-300
  OK:           '#4ade80',
  DONE:         '#4ade80',
  CONNECTED:    '#4ade80',
  READY:        '#4ade80',
  HEALTHY:      '#4ade80',
  // Warnings
  WARN:         '#fbbf24',
  WARNING:      '#fbbf24',
  DISCONNECTED: '#fbbf24',
  TIMEOUT:      '#fbbf24',
  RETRY:        '#fbbf24',
  // Errors
  ERROR:        '#f87171',
  ERR:          '#f87171',
  FAIL:         '#f87171',
  FAILED:       '#f87171',
  CRASH:        '#f87171',
  ABORT:        '#f87171',
};

// Action / category bracketed tags — magenta-ish so they stand out from
// status. Anything bracketed that's NOT in STATUS_COLOR falls back here.
const ACTION_COLOR = '#f9a8d4'; // pink-300

const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;
const BRACKETED_RE = /^\[[^\]]+\]$/;
const KV_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:ms|s|kb|mb|gb|%|cp|cps)?$/i;
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;

/** Tokenize on whitespace + brackets while keeping the delimiters so we
 *  can render them inline with their original spacing. */
function tokenize(line: string): string[] {
  // Split on bracketed tokens AND whitespace runs, keeping both as tokens.
  // This way `[user@x.com] [START] foo` becomes
  //   ['[user@x.com]', ' ', '[START]', ' ', 'foo']
  return line.split(/(\[[^\]]+\]|\s+)/).filter(Boolean);
}

function classifyToken(token: string): { color?: string; bold?: boolean } {
  // Pure whitespace — leave untouched.
  if (/^\s+$/.test(token)) return {};

  if (BRACKETED_RE.test(token)) {
    const inner = token.slice(1, -1);
    // 1. Status keywords (case-sensitive uppercase signal)
    const upper = inner.toUpperCase();
    if (STATUS_COLOR[upper]) return { color: STATUS_COLOR[upper], bold: true };
    // 2. Email inside brackets — common pattern `[user@x.com]`
    if (EMAIL_RE.test(inner)) return { color: '#67e8f9' };  // cyan-300
    // 3. Long alphanumeric (likely a request id)
    if (ID_RE.test(inner)) return { color: '#94a3b8' };  // slate-400
    // 4. Otherwise: action / category tag
    return { color: ACTION_COLOR };
  }

  if (EMAIL_RE.test(token)) return { color: '#67e8f9' };

  if (KV_RE.test(token)) return {};  // handled in render (split key/value)

  if (NUMBER_RE.test(token)) return { color: '#fde68a' };  // amber-200

  if (ID_RE.test(token)) return { color: '#94a3b8' };

  return {};
}

function renderToken(token: string, key: number): ReactNode {
  // Whitespace stays as-is.
  if (/^\s+$/.test(token)) return token;

  // key=value → gray key, white value
  const kv = token.match(KV_RE);
  if (kv) {
    return (
      <span key={key}>
        <span style={{ color: '#94a3b8' }}>{kv[1]}</span>
        <span style={{ color: '#cbd5e1' }}>=</span>
        <span style={{ color: '#f8fafc' }}>{kv[2]}</span>
      </span>
    );
  }

  const cls = classifyToken(token);
  if (!cls.color && !cls.bold) return token;
  return (
    <span key={key} style={{ color: cls.color, fontWeight: cls.bold ? 600 : undefined }}>
      {token}
    </span>
  );
}

export function colorizeLogLine(line: string): ReactNode {
  // ANSI takes priority — server already chose colors, respect them.
  if (line.includes('\x1b[')) return ansiToReact(line);

  const tokens = tokenize(line);
  return tokens.map((t, i) => renderToken(t, i));
}
