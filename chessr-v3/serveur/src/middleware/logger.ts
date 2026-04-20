import type { Context, Next } from 'hono';

// Noisy polling / health-check paths — skipped to keep the log focused on
// WS activity and user-initiated calls. The WS upgrade handshake already
// has its own structured CONNECTED/DISCONNECTED logs via wsLog.
const SILENCED_PATHS = new Set(['/health', '/ws', '/discord/status']);

export async function loggerMiddleware(c: Context, next: Next) {
  const start = Date.now();
  await next();
  if (SILENCED_PATHS.has(c.req.path)) return;
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} — ${c.res.status} (${ms}ms)`);
}
