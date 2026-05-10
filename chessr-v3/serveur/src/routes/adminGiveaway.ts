/**
 * Giveaway admin endpoints.
 *
 * The dashboard owns the UI; this module owns the storage. Three
 * concepts mirror the schema:
 *
 *   giveaways         — header (name, ends_at, status)
 *   giveaway_prizes   — ordered prize list per giveaway
 *   giveaway_tickets  — earning events; SUM(count) gives a user's
 *                       total tickets for a giveaway
 *
 * Endpoints:
 *
 *   POST   /admin/giveaway                       create
 *   GET    /admin/giveaways                      list (filter by status)
 *   GET    /admin/giveaway/current               currently-active scheduled giveaway
 *   GET    /admin/giveaway/:id                   detail (with prizes + counts)
 *   PATCH  /admin/giveaway/:id                   edit name / ends_at
 *   POST   /admin/giveaway/:id/cancel            status='cancelled'
 *   PUT    /admin/giveaway/:id/prizes            replace prize list atomically
 *   POST   /admin/giveaway/:id/tickets/grant     grant N tickets (1 row, 1 event)
 *   GET    /admin/giveaway/:id/leaderboard       SUM(count) DESC
 *   GET    /admin/giveaway/:id/me                tickets + rank for one Discord ID
 *   GET    /admin/giveaway/:id/tickets           full ticket history (admin)
 *
 * Auth: x-admin-token. The dashboard route layer does the super_admin
 * check on mutations.
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';

export const adminGiveawayRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// ─── Types echoed back to the dashboard ──────────────────────────────────

interface GiveawayRow {
  id: number;
  name: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  created_at: string;
  created_by_user_id: string | null;
  drawn_at: string | null;
}

interface PrizeRow {
  id: number;
  giveaway_id: number;
  position: number;
  prize_kind: 'plan' | 'token';
  plan_kind: 'lifetime' | 'premium' | null;
  plan_days: number | null;
  token_count: number | null;
  winner_discord_id: string | null;
  winner_user_id: string | null;
}

interface PrizeInput {
  position: number;
  prize_kind: 'plan' | 'token';
  plan_kind?: 'lifetime' | 'premium' | null;
  plan_days?: number | null;
  token_count?: number | null;
}

/** Reject malformed prizes early so we don't trust a CHECK violation
 *  to surface the bug to the user. */
function validatePrize(p: PrizeInput): string | null {
  if (!Number.isFinite(p.position) || p.position < 1) return 'invalid position';
  if (p.prize_kind === 'plan') {
    if (p.plan_kind !== 'lifetime' && p.plan_kind !== 'premium') return 'plan_kind must be lifetime or premium';
    if (p.plan_kind === 'lifetime' && p.plan_days != null) return 'lifetime cannot set plan_days';
    if (p.plan_kind === 'premium' && (!Number.isFinite(p.plan_days) || (p.plan_days as number) <= 0)) {
      return 'plan_days must be > 0 for premium';
    }
    if (p.token_count != null) return 'token_count must be null for plan prize';
  } else if (p.prize_kind === 'token') {
    if (!Number.isFinite(p.token_count) || (p.token_count as number) <= 0) return 'token_count must be > 0';
    if (p.plan_kind != null || p.plan_days != null) return 'plan fields must be null for token prize';
  } else {
    return 'prize_kind must be plan or token';
  }
  return null;
}

// ─── POST /admin/giveaway ────────────────────────────────────────────────

adminGiveawayRoutes.post('/admin/giveaway', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { name?: string; endsAt?: string; createdByUserId?: string; prizes?: PrizeInput[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const name = (body.name ?? '').trim();
  const endsAt = body.endsAt;
  if (!name) return c.json({ error: 'name required' }, 400);
  if (!endsAt || Number.isNaN(Date.parse(endsAt))) return c.json({ error: 'endsAt invalid' }, 400);

  const prizes = body.prizes ?? [];
  for (const p of prizes) {
    const err = validatePrize(p);
    if (err) return c.json({ error: `prize ${p.position ?? '?'}: ${err}` }, 400);
  }

  // Insert giveaway + prizes in a single transaction so a partial
  // create can't leak into the DB.
  const created = await dbQuery<{ id: number }>(
    `INSERT INTO giveaways (name, ends_at, created_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [name, endsAt, body.createdByUserId ?? null],
  );
  const giveawayId = created[0].id;

  for (const p of prizes) {
    await dbQuery(
      `INSERT INTO giveaway_prizes
         (giveaway_id, position, prize_kind, plan_kind, plan_days, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [giveawayId, p.position, p.prize_kind, p.plan_kind ?? null, p.plan_days ?? null, p.token_count ?? null],
    );
  }

  return c.json({ id: giveawayId });
});

// ─── GET /admin/giveaways ────────────────────────────────────────────────

adminGiveawayRoutes.get('/admin/giveaways', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const status = u.searchParams.get('status');
  const where = status && ['scheduled', 'cancelled', 'completed'].includes(status)
    ? `WHERE status = '${status}'`
    : '';

  const rows = await dbQuery<GiveawayRow & { tickets: string; prize_count: string }>(
    `SELECT g.*,
            COALESCE(SUM(t.count), 0)::text AS tickets,
            (SELECT COUNT(*)::text FROM giveaway_prizes p WHERE p.giveaway_id = g.id) AS prize_count
       FROM giveaways g
       LEFT JOIN giveaway_tickets t ON t.giveaway_id = g.id
       ${where}
      GROUP BY g.id
      ORDER BY g.ends_at DESC`,
  );

  return c.json({
    giveaways: rows.map((r) => ({
      ...r,
      tickets: Number(r.tickets),
      prize_count: Number(r.prize_count),
    })),
  });
});

// ─── GET /admin/giveaway/current ─────────────────────────────────────────
// "Active" = scheduled with the soonest ends_at. Used by the bot's
// /giveaway and /giveaway-leaderboard so they always target the current
// period without having to know an ID. 404 when no scheduled giveaway —
// the bot turns that into a friendly "no giveaway right now" message.

adminGiveawayRoutes.get('/admin/giveaway/current', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const giveaway = await dbQuery<GiveawayRow>(
    `SELECT * FROM giveaways
      WHERE status = 'scheduled'
      ORDER BY ends_at ASC
      LIMIT 1`,
  );
  if (giveaway.length === 0) return c.json({ error: 'no_active_giveaway' }, 404);

  const id = giveaway[0].id;
  const prizes = await dbQuery<PrizeRow>(
    `SELECT * FROM giveaway_prizes WHERE giveaway_id = $1 ORDER BY position ASC`, [id],
  );
  const stats = await dbQuery<{ tickets: string; participants: string }>(
    `SELECT COALESCE(SUM(count), 0)::text AS tickets,
            COUNT(DISTINCT owner_discord_id)::text AS participants
       FROM giveaway_tickets WHERE giveaway_id = $1`, [id],
  );

  return c.json({
    giveaway: giveaway[0],
    prizes,
    stats: {
      tickets: Number(stats[0]?.tickets ?? 0),
      participants: Number(stats[0]?.participants ?? 0),
    },
  });
});

// ─── GET /admin/giveaway/:id ─────────────────────────────────────────────

adminGiveawayRoutes.get('/admin/giveaway/:id', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const giveaway = await dbQuery<GiveawayRow>(
    `SELECT * FROM giveaways WHERE id = $1`, [id],
  );
  if (giveaway.length === 0) return c.json({ error: 'not_found' }, 404);

  const prizes = await dbQuery<PrizeRow>(
    `SELECT * FROM giveaway_prizes WHERE giveaway_id = $1 ORDER BY position ASC`, [id],
  );

  const stats = await dbQuery<{ tickets: string; participants: string }>(
    `SELECT COALESCE(SUM(count), 0)::text AS tickets,
            COUNT(DISTINCT owner_discord_id)::text AS participants
       FROM giveaway_tickets WHERE giveaway_id = $1`, [id],
  );

  return c.json({
    giveaway: giveaway[0],
    prizes,
    stats: {
      tickets: Number(stats[0]?.tickets ?? 0),
      participants: Number(stats[0]?.participants ?? 0),
    },
  });
});

// ─── PATCH /admin/giveaway/:id ───────────────────────────────────────────

adminGiveawayRoutes.patch('/admin/giveaway/:id', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { name?: string; endsAt?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const fields: string[] = [];
  const params: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    params.push(body.name.trim());
    fields.push(`name = $${params.length}`);
  }
  if (typeof body.endsAt === 'string' && !Number.isNaN(Date.parse(body.endsAt))) {
    params.push(body.endsAt);
    fields.push(`ends_at = $${params.length}`);
  }
  if (fields.length === 0) return c.json({ error: 'no fields to update' }, 400);

  params.push(id);
  const rows = await dbQuery<{ id: number }>(
    `UPDATE giveaways SET ${fields.join(', ')}
      WHERE id = $${params.length} AND status = 'scheduled'
     RETURNING id`,
    params,
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_locked' }, 404);
  return c.json({ updated: true });
});

// ─── POST /admin/giveaway/:id/cancel ─────────────────────────────────────

adminGiveawayRoutes.post('/admin/giveaway/:id/cancel', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const rows = await dbQuery<{ id: number }>(
    `UPDATE giveaways SET status = 'cancelled'
      WHERE id = $1 AND status = 'scheduled'
     RETURNING id`,
    [id],
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_locked' }, 404);
  return c.json({ cancelled: true });
});

// ─── PUT /admin/giveaway/:id/prizes ──────────────────────────────────────
// Replace the prize list atomically. Simpler than diffing rows for a
// reorder + add/remove combo.

adminGiveawayRoutes.put('/admin/giveaway/:id/prizes', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { prizes?: PrizeInput[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const prizes = body.prizes ?? [];
  for (const p of prizes) {
    const err = validatePrize(p);
    if (err) return c.json({ error: `prize ${p.position ?? '?'}: ${err}` }, 400);
  }
  // Reject duplicate positions early — UNIQUE would catch it but with
  // a worse error.
  const positions = new Set(prizes.map((p) => p.position));
  if (positions.size !== prizes.length) {
    return c.json({ error: 'duplicate position' }, 400);
  }

  // Lock the giveaway row first so a concurrent draw can't fire mid-write.
  const exists = await dbQuery<{ id: number }>(
    `SELECT id FROM giveaways WHERE id = $1 AND status = 'scheduled' FOR UPDATE`,
    [id],
  );
  if (exists.length === 0) return c.json({ error: 'not_found_or_locked' }, 404);

  await dbQuery(`DELETE FROM giveaway_prizes WHERE giveaway_id = $1`, [id]);
  for (const p of prizes) {
    await dbQuery(
      `INSERT INTO giveaway_prizes
         (giveaway_id, position, prize_kind, plan_kind, plan_days, token_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, p.position, p.prize_kind, p.plan_kind ?? null, p.plan_days ?? null, p.token_count ?? null],
    );
  }
  return c.json({ replaced: prizes.length });
});

// ─── POST /admin/giveaway/:id/tickets/grant ──────────────────────────────
// Single row, single event for any count. The bot reads the event and
// sends a single DM downstream.

adminGiveawayRoutes.post('/admin/giveaway/:id/tickets/grant', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { discordId?: string; count?: number; reason?: string; actorUserId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const discordId = (body.discordId ?? '').trim();
  const count = Math.floor(Number(body.count ?? 1));
  const reason = (body.reason ?? '').trim() || null;
  if (!discordId) return c.json({ error: 'discordId required' }, 400);
  if (!Number.isFinite(count) || count < 1 || count > 1000) {
    return c.json({ error: 'count must be 1..1000' }, 400);
  }

  // Reject grants on cancelled / completed giveaways — only scheduled
  // accept new tickets.
  const giveaway = await dbQuery<{ id: number; status: string }>(
    `SELECT id, status FROM giveaways WHERE id = $1`, [id],
  );
  if (giveaway.length === 0) return c.json({ error: 'not_found' }, 404);
  if (giveaway[0].status !== 'scheduled') {
    return c.json({ error: 'giveaway_locked', status: giveaway[0].status }, 409);
  }

  const inserted = await dbQuery<{ id: number }>(
    `INSERT INTO giveaway_tickets
       (giveaway_id, owner_discord_id, source, count, granted_by_user_id, reason)
     VALUES ($1, $2, 'admin_grant', $3, $4, $5)
     RETURNING id`,
    [id, discordId, count, body.actorUserId ?? null, reason],
  );

  await emitEvent({
    type: 'giveaway_ticket_earned',
    actor_id: body.actorUserId ?? null,
    payload: {
      giveawayId: id,
      count,
      source: 'admin_grant',
      reason,
      discordId,
      ticketRowId: inserted[0].id,
    },
  });

  return c.json({ granted: true, ticketRowId: inserted[0].id, count });
});

// ─── GET /admin/giveaway/:id/leaderboard ─────────────────────────────────

adminGiveawayRoutes.get('/admin/giveaway/:id/leaderboard', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const limit = Math.min(50, Math.max(1, Number(new URL(c.req.url).searchParams.get('limit') ?? '10')));

  const rows = await dbQuery<{ owner_discord_id: string; tickets: string }>(
    `SELECT owner_discord_id, SUM(count)::text AS tickets
       FROM giveaway_tickets
      WHERE giveaway_id = $1
      GROUP BY owner_discord_id
      ORDER BY SUM(count) DESC
      LIMIT ${limit}`,
    [id],
  );

  return c.json({
    leaderboard: rows.map((r) => ({
      discord_id: r.owner_discord_id,
      tickets: Number(r.tickets),
    })),
  });
});

// ─── GET /admin/giveaway/:id/me?discordId=X ──────────────────────────────
// Used by the bot's /giveaway command. Returns the caller's tickets +
// rank for this giveaway in one round-trip. Rank is dense (ties share a
// rank) so two users with the same SUM(count) both show as "#3".

adminGiveawayRoutes.get('/admin/giveaway/:id/me', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const discordId = (new URL(c.req.url).searchParams.get('discordId') ?? '').trim();
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const totals = await dbQuery<{ tickets: string; participants: string }>(
    `SELECT COALESCE(SUM(count), 0)::text AS tickets,
            COUNT(DISTINCT owner_discord_id)::text AS participants
       FROM giveaway_tickets WHERE giveaway_id = $1`, [id],
  );

  const mine = await dbQuery<{ tickets: string }>(
    `SELECT COALESCE(SUM(count), 0)::text AS tickets
       FROM giveaway_tickets
      WHERE giveaway_id = $1 AND owner_discord_id = $2`, [id, discordId],
  );
  const myTickets = Number(mine[0]?.tickets ?? 0);

  // Dense rank: how many distinct users have STRICTLY MORE tickets than me?
  // My rank is that count + 1. If I have 0 tickets, rank is null (not playing).
  let rank: number | null = null;
  if (myTickets > 0) {
    const ahead = await dbQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT owner_discord_id, SUM(count) AS s
           FROM giveaway_tickets
          WHERE giveaway_id = $1
          GROUP BY owner_discord_id
         HAVING SUM(count) > $2
       ) sub`, [id, myTickets],
    );
    rank = Number(ahead[0]?.n ?? 0) + 1;
  }

  return c.json({
    tickets: myTickets,
    rank,
    total_tickets: Number(totals[0]?.tickets ?? 0),
    total_participants: Number(totals[0]?.participants ?? 0),
  });
});

// ─── GET /admin/giveaway/:id/tickets ─────────────────────────────────────
// Full ticket-grant history for a giveaway. Used by the admin "Tickets"
// tab on the detail page.

adminGiveawayRoutes.get('/admin/giveaway/:id/tickets', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const u = new URL(c.req.url);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? '50')));
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? '0'));

  const rows = await dbQuery(
    `SELECT id, owner_discord_id, source, count, earned_at::text,
            granted_by_user_id, reason, external_ref
       FROM giveaway_tickets
      WHERE giveaway_id = $1
      ORDER BY earned_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [id],
  );
  const total = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text n FROM giveaway_tickets WHERE giveaway_id = $1`, [id],
  );

  return c.json({ tickets: rows, total: Number(total[0]?.n ?? 0), limit, offset });
});
