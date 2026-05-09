/**
 * Admin events — proxy + history for the activity feed.
 *
 *   POST /admin/events  → emit a new event (used by the dashboard, which
 *                         can't reach the analytics DB or Redis directly)
 *   GET  /admin/events  → paginated history (dashboard activity page)
 *
 * Both gated by the X-Admin-Token header / `?token=` query param, same
 * as the rest of /admin/*.
 */

import { Hono, type Context } from 'hono';
import { emitEvent, EVENT_KINDS, type EventKind } from '../lib/events.js';
import { dbQuery } from '../lib/db.js';

export const adminEventsRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// POST /admin/events — emit. Body: { type, user_id?, actor_id?, payload? }
adminEventsRoutes.post('/admin/events', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const type = body?.type;
  if (!type || !EVENT_KINDS.includes(type as EventKind)) {
    return c.json({ error: 'Invalid or missing type' }, 400);
  }

  await emitEvent({
    type: type as EventKind,
    user_id: typeof body.user_id === 'string' ? body.user_id : null,
    actor_id: typeof body.actor_id === 'string' ? body.actor_id : null,
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
  });
  return c.json({ ok: true });
});

// GET /admin/events — list. Query: ?type=&user_id=&page=&limit=
// (Activity page in the dashboard pages from `before` for stable
// scrolling under heavy write load — TODO when the volume justifies it.)
adminEventsRoutes.get('/admin/events', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const url = new URL(c.req.url);
  const type = url.searchParams.get('type')?.trim() || '';
  const userId = url.searchParams.get('user_id')?.trim() || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  if (type) {
    if (!EVENT_KINDS.includes(type as EventKind)) {
      return c.json({ error: 'Unknown event type' }, 400);
    }
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    where.push(`user_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Two queries (rows + total) — small enough at our volumes that the
  // simplicity beats a windowed COUNT() per row.
  const rowsParams = [...params, limit, offset];
  const rows = await dbQuery<{
    id: string;
    type: string;
    user_id: string | null;
    actor_id: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT id, type, user_id, actor_id, payload, created_at
     FROM events
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${rowsParams.length - 1} OFFSET $${rowsParams.length}`,
    rowsParams,
  );
  const totalRows = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM events ${whereSql}`,
    params,
  );
  const total = Number(totalRows[0]?.count ?? 0);

  return c.json({
    events: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});
