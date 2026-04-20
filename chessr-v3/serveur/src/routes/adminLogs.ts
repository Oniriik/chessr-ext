import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { getRecentLines, subscribe } from '../lib/logBuffer.js';

export const adminLogsRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

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
