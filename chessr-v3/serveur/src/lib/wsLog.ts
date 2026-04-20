/**
 * Structured WebSocket message logger.
 *
 * Format: [email | requestId | START|END | type] extra
 * START records a perf.now() stamp keyed by requestId so END can print the
 * elapsed time without callers having to thread it through.
 */

import { supabase } from './supabase.js';

type Phase = 'START' | 'END';

const emailCache = new Map<string, string>();
const EMAIL_TTL_MS = 5 * 60_000;
const emailCacheTs = new Map<string, number>();

const startedAt = new Map<string, number>();

async function resolveEmail(userId: string): Promise<string> {
  if (!userId || userId === 'anonymous') return 'anonymous';
  const ts = emailCacheTs.get(userId) || 0;
  if (emailCache.has(userId) && Date.now() - ts < EMAIL_TTL_MS) {
    return emailCache.get(userId)!;
  }
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    const email = error ? userId.slice(0, 8) : (data.user?.email || userId.slice(0, 8));
    emailCache.set(userId, email);
    emailCacheTs.set(userId, Date.now());
    return email;
  } catch {
    return userId.slice(0, 8);
  }
}

function fmt(email: string, requestId: string | undefined, phase: Phase, type: string, extra?: string): string {
  const req = (requestId || '—').padEnd(18).slice(0, 18);
  return `[${email} | ${req} | ${phase.padEnd(5)} | ${type}]${extra ? ' ' + extra : ''}`;
}

export async function logStart(
  userId: string,
  requestId: string | undefined,
  type: string,
  extra?: string,
): Promise<void> {
  const email = await resolveEmail(userId);
  if (requestId) startedAt.set(requestId, performance.now());
  console.log(fmt(email, requestId, 'START', type, extra));
}

export async function logEnd(
  userId: string,
  requestId: string | undefined,
  type: string,
  extra?: string,
): Promise<void> {
  const email = await resolveEmail(userId);
  let duration = '';
  if (requestId && startedAt.has(requestId)) {
    const ms = Math.round(performance.now() - startedAt.get(requestId)!);
    startedAt.delete(requestId);
    duration = `${ms}ms`;
  }
  const merged = [duration, extra].filter(Boolean).join(' · ');
  console.log(fmt(email, requestId, 'END', type, merged));
}
