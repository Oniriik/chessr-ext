import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { getRecentLines, subscribe } from '../lib/logBuffer.js';
import { getLatestMetrics } from '../lib/sysMetrics.js';
import { getConnectedUsers } from './ws.js';
import { supabase } from '../lib/supabase.js';

export const adminLogsRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// Lightweight email cache shared with wsLog for admin endpoints.
const emailCache = new Map<string, { email: string; ts: number }>();
const EMAIL_TTL_MS = 5 * 60_000;

async function resolveEmail(userId: string): Promise<string | null> {
  const c = emailCache.get(userId);
  if (c && Date.now() - c.ts < EMAIL_TTL_MS) return c.email;
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const email = data.user?.email || null;
    if (email) emailCache.set(userId, { email, ts: Date.now() });
    return email;
  } catch {
    return null;
  }
}

// GET /admin/metrics — current CPU / RAM / load for the host + process
adminLogsRoutes.get('/admin/metrics', (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  return c.json(getLatestMetrics());
});

// GET /admin/users/connected — list currently connected WS users with email + connect time
adminLogsRoutes.get('/admin/users/connected', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const connected = getConnectedUsers();
  const users = await Promise.all(
    connected.map(async ({ userId, connectedAt }) => ({
      userId,
      email: await resolveEmail(userId),
      connectedAt,
    })),
  );
  // Most recent first
  users.sort((a, b) => b.connectedAt - a.connectedAt);
  return c.json({ count: users.length, users });
});

// SSE stream of live log lines. Sends recent buffer first, then tails live.
adminLogsRoutes.get('/admin/logs/stream', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no'); // disable nginx buffering

  return stream(c, async (s) => {
    // Initial buffer dump
    for (const line of getRecentLines()) {
      await s.write(`data: ${line.text.replace(/\n/g, '\\n')}\n\n`);
    }

    // Live subscription
    let closed = false;
    const unsub = subscribe(async (line) => {
      if (closed) return;
      try {
        await s.write(`data: ${line.text.replace(/\n/g, '\\n')}\n\n`);
      } catch {
        closed = true;
      }
    });

    // Keep the stream alive until the client disconnects
    await new Promise<void>((resolve) => {
      s.onAbort(() => { closed = true; unsub(); resolve(); });
    });
  });
});
