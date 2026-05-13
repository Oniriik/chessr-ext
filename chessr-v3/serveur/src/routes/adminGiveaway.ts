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
import { forceDrawGiveaway } from '../jobs/giveawayDraw.js';
import { supabase } from '../lib/supabase.js';

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
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled' | 'completed';
  announce_channel_id: string | null;
  announce_message_id: string | null;
  announced_at: string | null;
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

  let body: {
    name?: string;
    startsAt?: string;
    endsAt?: string;
    announceChannelId?: string | null;
    createdByUserId?: string;
    prizes?: PrizeInput[];
  };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const name = (body.name ?? '').trim();
  const startsAt = body.startsAt;
  const endsAt = body.endsAt;
  if (!name) return c.json({ error: 'name required' }, 400);
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return c.json({ error: 'startsAt invalid' }, 400);
  if (!endsAt || Number.isNaN(Date.parse(endsAt))) return c.json({ error: 'endsAt invalid' }, 400);
  if (Date.parse(startsAt) >= Date.parse(endsAt)) return c.json({ error: 'startsAt must be before endsAt' }, 400);

  const announceChannelId = (body.announceChannelId ?? '').toString().trim() || null;

  const prizes = body.prizes ?? [];
  for (const p of prizes) {
    const err = validatePrize(p);
    if (err) return c.json({ error: `prize ${p.position ?? '?'}: ${err}` }, 400);
  }

  // Insert giveaway + prizes in a single transaction so a partial
  // create can't leak into the DB.
  const created = await dbQuery<{ id: number }>(
    `INSERT INTO giveaways (name, starts_at, ends_at, announce_channel_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, startsAt, endsAt, announceChannelId, body.createdByUserId ?? null],
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

  let body: { name?: string; startsAt?: string; endsAt?: string; announceChannelId?: string | null };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const fields: string[] = [];
  const params: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    params.push(body.name.trim());
    fields.push(`name = $${params.length}`);
  }
  if (typeof body.startsAt === 'string' && !Number.isNaN(Date.parse(body.startsAt))) {
    params.push(body.startsAt);
    fields.push(`starts_at = $${params.length}`);
  }
  if (typeof body.endsAt === 'string' && !Number.isNaN(Date.parse(body.endsAt))) {
    params.push(body.endsAt);
    fields.push(`ends_at = $${params.length}`);
  }
  if (body.announceChannelId !== undefined) {
    const normalized = body.announceChannelId === null ? null
      : (body.announceChannelId.toString().trim() || null);
    params.push(normalized);
    fields.push(`announce_channel_id = $${params.length}`);
  }
  if (fields.length === 0) return c.json({ error: 'no fields to update' }, 400);

  params.push(id);
  const rows = await dbQuery<{ id: number; announce_message_id: string | null }>(
    `UPDATE giveaways SET ${fields.join(', ')}
      WHERE id = $${params.length} AND status = 'scheduled'
     RETURNING id, announce_message_id`,
    params,
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_locked' }, 404);

  // Already announced → ask the bot to re-render the embed so the
  // channel stays in sync with whatever the admin just changed.
  if (rows[0].announce_message_id) {
    await emitEvent({ type: 'giveaway_updated', actor_id: null, payload: { giveawayId: id } });
  }
  return c.json({ updated: true });
});

// ─── GET /admin/giveaways/pending-announce ───────────────────────────────
// Bot's tick: every N seconds, ask "what scheduled giveaways have started
// but haven't been announced yet?" — bot posts the embed + Register button
// and then calls /announce to mark the row.

adminGiveawayRoutes.get('/admin/giveaways/pending-announce', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const rows = await dbQuery<GiveawayRow>(
    `SELECT * FROM giveaways
      WHERE status = 'scheduled'
        AND announce_message_id IS NULL
        AND starts_at <= now()
        AND ends_at   >  now()
      ORDER BY starts_at ASC
      LIMIT 20`,
  );

  // Need prizes too so the bot can render the embed in one go.
  const ids = rows.map((r) => r.id);
  const prizes = ids.length === 0 ? [] : await dbQuery<PrizeRow>(
    `SELECT * FROM giveaway_prizes
      WHERE giveaway_id = ANY($1::bigint[])
      ORDER BY giveaway_id, position ASC`,
    [ids],
  );
  const prizesByGid = new Map<number, PrizeRow[]>();
  for (const p of prizes) {
    const arr = prizesByGid.get(p.giveaway_id) ?? [];
    arr.push(p);
    prizesByGid.set(p.giveaway_id, arr);
  }

  return c.json({
    giveaways: rows.map((g) => ({ ...g, prizes: prizesByGid.get(g.id) ?? [] })),
  });
});

// ─── POST /admin/giveaway/:id/announce ───────────────────────────────────
// Bot calls this once it's posted the announcement message; we record
// the message id so a restart of the bot doesn't double-post.

adminGiveawayRoutes.post('/admin/giveaway/:id/announce', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { messageId?: string; channelId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const messageId = (body.messageId ?? '').trim();
  const channelId = (body.channelId ?? '').trim();
  if (!messageId || !channelId) return c.json({ error: 'messageId and channelId required' }, 400);

  // Only flip rows that haven't been announced yet — race-safe across
  // multiple bot replicas.
  const rows = await dbQuery<{ id: number }>(
    `UPDATE giveaways
        SET announce_message_id = $1,
            announce_channel_id = COALESCE(announce_channel_id, $2),
            announced_at = now()
      WHERE id = $3 AND status = 'scheduled' AND announce_message_id IS NULL
      RETURNING id`,
    [messageId, channelId, id],
  );
  if (rows.length === 0) return c.json({ error: 'already_announced_or_locked' }, 409);
  return c.json({ announced: true });
});

// ─── POST /admin/giveaway/:id/register ───────────────────────────────────
// Idempotent. First call inserts the registration row + grants 1 ticket
// (source='registration'). Subsequent calls return { already: true }.

adminGiveawayRoutes.post('/admin/giveaway/:id/register', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { discordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const discordId = (body.discordId ?? '').trim();
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  // Reject registration if the giveaway is locked / not open yet / over.
  // The bot's button shouldn't show outside [starts_at, ends_at) but we
  // double-check server-side.
  const gw = await dbQuery<{ id: number; status: string; starts_at: string; ends_at: string }>(
    `SELECT id, status, starts_at::text, ends_at::text FROM giveaways WHERE id = $1`, [id],
  );
  if (gw.length === 0) return c.json({ error: 'not_found' }, 404);
  if (gw[0].status !== 'scheduled') return c.json({ error: 'giveaway_locked', status: gw[0].status }, 409);
  const now = Date.now();
  if (Date.parse(gw[0].starts_at) > now) return c.json({ error: 'not_started' }, 409);
  if (Date.parse(gw[0].ends_at)   <= now) return c.json({ error: 'ended' }, 409);

  // Block excluded users from earning anything via the Register button.
  // The bot can surface a friendly message; status 409 keeps the
  // existing front-end error-handling shape.
  if (await isExcluded(id, discordId)) {
    return c.json({ error: 'excluded' }, 409);
  }

  // ON CONFLICT DO NOTHING + RETURNING gives us the row only when newly
  // inserted — perfect for the "grant ticket once" branch.
  const inserted = await dbQuery<{ id: number }>(
    `INSERT INTO giveaway_registrations (giveaway_id, discord_id)
     VALUES ($1, $2)
     ON CONFLICT (giveaway_id, discord_id) DO NOTHING
     RETURNING id`,
    [id, discordId],
  );
  if (inserted.length === 0) {
    return c.json({ registered: true, already: true, registrationTickets: 0, inviteBackfillTickets: 0 });
  }

  await dbQuery(
    `INSERT INTO giveaway_tickets (giveaway_id, owner_discord_id, source, count)
     VALUES ($1, $2, 'registration', 1)`,
    [id, discordId],
  );
  await emitEvent({
    type: 'giveaway_ticket_earned',
    actor_id: null,
    payload: { giveawayId: id, count: 1, source: 'registration', discordId },
  });

  // Backfill: count invites this user generated during [starts_at, NOW()]
  // (clipped at ends_at) and grant them as a single grouped row. The
  // table is shared with future-period grants done via the realtime
  // path, so we limit the count to invites that actually fall inside
  // this giveaway's window.
  const backfill = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM invite_uses
      WHERE inviter_discord_id = $1
        AND joined_at >= $2::timestamptz
        AND joined_at <  LEAST($3::timestamptz, now())`,
    [discordId, gw[0].starts_at, gw[0].ends_at],
  );
  const backfillCount = Number(backfill[0]?.n ?? 0);
  if (backfillCount > 0) {
    await dbQuery(
      `INSERT INTO giveaway_tickets
         (giveaway_id, owner_discord_id, source, count, reason)
       VALUES ($1, $2, 'invite', $3, 'registration_backfill')`,
      [id, discordId, backfillCount],
    );
    await emitEvent({
      type: 'giveaway_ticket_earned',
      actor_id: null,
      payload: {
        giveawayId: id,
        count: backfillCount,
        source: 'invite',
        discordId,
        backfill: true,
      },
    });
  }

  return c.json({
    registered: true,
    already: false,
    registrationTickets: 1,
    inviteBackfillTickets: backfillCount,
  });
});

// ─── POST /admin/giveaway/:id/draw ───────────────────────────────────────
// Manual override of the scheduled draw. Picks winners + mints
// deliverables right now regardless of ends_at. Atomic-flips status to
// 'completed' so the cron tick won't double-draw.

adminGiveawayRoutes.post('/admin/giveaway/:id/draw', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  try {
    await forceDrawGiveaway(id);
    return c.json({ drawn: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'draw_failed';
    if (msg === 'not_found_or_locked') return c.json({ error: msg }, 404);
    console.error(`[giveaway] force draw failed for ${id}:`, err);
    return c.json({ error: 'draw_failed' }, 500);
  }
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

  // Re-render the live embed if the giveaway has already been announced.
  const announced = await dbQuery<{ announce_message_id: string | null }>(
    `SELECT announce_message_id FROM giveaways WHERE id = $1`, [id],
  );
  if (announced[0]?.announce_message_id) {
    await emitEvent({ type: 'giveaway_updated', actor_id: null, payload: { giveawayId: id } });
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

  // Defensive: admin grants from the dashboard should never bypass the
  // exclusion list. The dashboard already filters the picker but a
  // direct API call could still try — bail with a clear error.
  if (await isExcluded(id, discordId)) {
    return c.json({ error: 'user_excluded' }, 409);
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

// ─── POST /admin/giveaway/:id/migrate-v2 ─────────────────────────────────
// One-shot recovery for tickets earned on the v2 invite-based giveaway
// (giveaway_periods + invite_events in Supabase). Walks the v2
// invite_events table for the period window, aggregates per
// inviter_discord_id (only `still_in_guild = true` so kicked invites
// don't count), and grants those counts on the target v3 giveaway as
// admin_grant rows with reason='v2_migration'.
//
// Idempotency: the endpoint refuses to run twice on the same v3
// giveaway by checking for any existing reason='v2_migration' rows.
// Use ?force=1 to override (won't dedup — will double-grant).
//
// Body: { startsAt: ISO, endsAt: ISO, dryRun?: boolean }
adminGiveawayRoutes.post('/admin/giveaway/:id/migrate-v2', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { startsAt?: string; endsAt?: string; dryRun?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const startsAt = (body.startsAt ?? '').trim();
  const endsAt = (body.endsAt ?? '').trim();
  const dryRun = !!body.dryRun;
  if (!startsAt || !endsAt) return c.json({ error: 'startsAt + endsAt required (ISO 8601)' }, 400);
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
    return c.json({ error: 'startsAt / endsAt must parse as ISO 8601' }, 400);
  }

  const giveaway = await dbQuery<{ id: number; status: string }>(
    `SELECT id, status FROM giveaways WHERE id = $1`, [id],
  );
  if (giveaway.length === 0) return c.json({ error: 'not_found' }, 404);
  if (giveaway[0].status !== 'scheduled') {
    return c.json({ error: 'giveaway_locked', status: giveaway[0].status }, 409);
  }

  const force = c.req.query('force') === '1';
  if (!dryRun && !force) {
    const existing = await dbQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM giveaway_tickets
        WHERE giveaway_id = $1 AND reason = 'v2_migration'`,
      [id],
    );
    if (Number(existing[0]?.n ?? 0) > 0) {
      return c.json({
        error: 'already_migrated',
        message: 'v2 tickets already migrated for this giveaway. Append ?force=1 to bypass (will double-grant).',
      }, 409);
    }
  }

  // Pull every invite_events row in the window. Pagination via
  // .range() in case the period collected thousands of invites — the
  // Supabase JS client defaults to 1000 rows max per query.
  type InviteRow = { inviter_discord_id: string; still_in_guild: boolean | null };
  const PAGE = 1000;
  const rows: InviteRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invite_events')
      .select('inviter_discord_id, still_in_guild')
      .gte('created_at', startsAt)
      .lt('created_at', endsAt)
      .range(from, from + PAGE - 1);
    if (error) return c.json({ error: 'supabase_query_failed', detail: error.message }, 500);
    if (!data || data.length === 0) break;
    rows.push(...(data as InviteRow[]));
    if (data.length < PAGE) break;
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.inviter_discord_id) continue;
    if (r.still_in_guild === false) continue; // kicked → doesn't count
    counts.set(r.inviter_discord_id, (counts.get(r.inviter_discord_id) ?? 0) + 1);
  }
  const users = [...counts.entries()]
    .map(([discordId, count]) => ({ discordId, count }))
    .sort((a, b) => b.count - a.count);
  const totalTickets = users.reduce((s, u) => s + u.count, 0);

  if (dryRun) {
    return c.json({
      dryRun: true,
      window: { startsAt, endsAt },
      invitesScanned: rows.length,
      users,
      summary: { distinctUsers: users.length, totalTickets },
    });
  }

  // Apply. One INSERT + one event per user. Same shape as the
  // realtime admin_grant path so the bot's #users embed + DM trigger
  // automatically via the existing event forwarder.
  let granted = 0;
  let failed = 0;
  for (const u of users) {
    try {
      const ins = await dbQuery<{ id: number }>(
        `INSERT INTO giveaway_tickets
           (giveaway_id, owner_discord_id, source, count, granted_by_user_id, reason)
         VALUES ($1, $2, 'admin_grant', $3, NULL, 'v2_migration')
         RETURNING id`,
        [id, u.discordId, u.count],
      );
      await emitEvent({
        type: 'giveaway_ticket_earned',
        actor_id: null,
        payload: {
          giveawayId: id,
          count: u.count,
          source: 'admin_grant',
          reason: 'v2_migration',
          discordId: u.discordId,
          ticketRowId: ins[0].id,
        },
      });
      granted++;
    } catch (err) {
      console.warn(`[migrate-v2] grant failed for ${u.discordId}:`, err);
      failed++;
    }
  }

  return c.json({
    migrated: true,
    window: { startsAt, endsAt },
    invitesScanned: rows.length,
    summary: { distinctUsers: users.length, totalTickets, granted, failed },
  });
});

// ─── Exclusions helpers ────────────────────────────────────────────────
// Per-giveaway block list. Used to keep the chessr team from winning
// their own giveaways and to retroactively scrub bad-faith accounts
// before a draw. Checked on every ticket-earning path (register / grant
// / invite) and filtered out of the draw pool inside giveawayDraw.ts.

async function isExcluded(giveawayId: number, discordId: string): Promise<boolean> {
  const rows = await dbQuery<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM giveaway_excluded_users
        WHERE giveaway_id = $1 AND discord_id = $2
     ) AS exists`,
    [giveawayId, discordId],
  );
  return !!rows[0]?.exists;
}

// ─── GET /admin/giveaway/:id/excluded ──────────────────────────────────
// Returns the per-giveaway exclusion list with audit fields. Admin-only.

adminGiveawayRoutes.get('/admin/giveaway/:id/excluded', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const rows = await dbQuery<{
    discord_id: string;
    reason: string | null;
    excluded_by_user_id: string | null;
    excluded_at: string;
  }>(
    `SELECT discord_id, reason, excluded_by_user_id, excluded_at::text
       FROM giveaway_excluded_users
      WHERE giveaway_id = $1
      ORDER BY excluded_at DESC`,
    [id],
  );

  return c.json({ excluded: rows });
});

// ─── POST /admin/giveaway/:id/exclude ──────────────────────────────────
// Body: { discordId, reason?, actorUserId? }. Idempotent — ON CONFLICT
// DO NOTHING means re-adding an existing exclusion is a no-op. Does NOT
// retroactively remove tickets already earned: admins should clear
// those by hand if needed (or the draw filters them out anyway).

adminGiveawayRoutes.post('/admin/giveaway/:id/exclude', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { discordId?: string; reason?: string; actorUserId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const discordId = (body.discordId ?? '').trim();
  const reason = (body.reason ?? '').trim() || null;
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const gw = await dbQuery<{ id: number }>(
    `SELECT id FROM giveaways WHERE id = $1`, [id],
  );
  if (gw.length === 0) return c.json({ error: 'not_found' }, 404);

  const inserted = await dbQuery<{ id: number }>(
    `INSERT INTO giveaway_excluded_users
       (giveaway_id, discord_id, reason, excluded_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (giveaway_id, discord_id) DO NOTHING
     RETURNING id`,
    [id, discordId, reason, body.actorUserId ?? null],
  );

  return c.json({ excluded: true, already: inserted.length === 0 });
});

// ─── DELETE /admin/giveaway/:id/exclude/:discordId ─────────────────────
// Lift an exclusion. Future ticket-earning paths will resume granting
// normally. Existing tickets (if any) become eligible for the draw
// again on the next cron tick.

adminGiveawayRoutes.delete('/admin/giveaway/:id/exclude/:discordId', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const discordId = (c.req.param('discordId') ?? '').trim();
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const deleted = await dbQuery<{ id: number }>(
    `DELETE FROM giveaway_excluded_users
      WHERE giveaway_id = $1 AND discord_id = $2
     RETURNING id`,
    [id, discordId],
  );
  return c.json({ removed: deleted.length > 0 });
});

// ─── GET /admin/giveaway/:id/participants ──────────────────────────────
// Full participants list: every Discord user with at least one ticket
// for this giveaway, sorted by ticket count DESC. Differs from the
// leaderboard endpoint by returning the whole population (no LIMIT)
// and flagging excluded users so the dashboard can mark them visually.

adminGiveawayRoutes.get('/admin/giveaway/:id/participants', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const rows = await dbQuery<{
    discord_id: string;
    tickets: string;
    is_excluded: boolean;
  }>(
    `SELECT t.owner_discord_id AS discord_id,
            SUM(t.count)::text AS tickets,
            EXISTS (
              SELECT 1 FROM giveaway_excluded_users e
               WHERE e.giveaway_id = t.giveaway_id
                 AND e.discord_id = t.owner_discord_id
            ) AS is_excluded
       FROM giveaway_tickets t
      WHERE t.giveaway_id = $1
      GROUP BY t.owner_discord_id, t.giveaway_id
      ORDER BY SUM(t.count) DESC`,
    [id],
  );

  return c.json({
    participants: rows.map((r) => ({
      discord_id: r.discord_id,
      tickets: Number(r.tickets),
      is_excluded: !!r.is_excluded,
    })),
  });
});

// ─── GET /admin/discord-users/resolve?ids=A,B,C ────────────────────────
// Batch lookup of Discord profile info for a list of discord_ids.
// Source is user_settings on Supabase — only users who linked their
// Discord via OAuth have a row. Unlinked IDs are returned with
// username: null so callers can fall back to the raw ID.
//
// Lives under the giveaway admin module since that's the only caller
// today (participants / excluded panels). Will hoist to its own route
// file if other admin pages need it.
//
// Capped to 200 IDs per call to keep the Supabase round-trip predictable.

adminGiveawayRoutes.get('/admin/discord-users/resolve', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const raw = (new URL(c.req.url).searchParams.get('ids') ?? '').trim();
  if (!raw) return c.json({ users: [] });
  const ids = Array.from(new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => /^\d{17,20}$/.test(s)),
  )).slice(0, 200);
  if (ids.length === 0) return c.json({ users: [] });

  const { data } = await supabase
    .from('user_settings')
    .select('discord_id, discord_username, discord_avatar')
    .in('discord_id', ids);

  const rowByDiscord = new Map<string, { discord_username: string | null; discord_avatar: string | null }>();
  for (const row of (data ?? [])) {
    if (row.discord_id) {
      rowByDiscord.set(String(row.discord_id), {
        discord_username: (row.discord_username as string | null) ?? null,
        discord_avatar:   (row.discord_avatar   as string | null) ?? null,
      });
    }
  }
  // Always return every requested id so the caller can render a
  // consistent row even when we have no profile (returns nulls).
  return c.json({
    users: ids.map((id) => ({
      discord_id: id,
      username: rowByDiscord.get(id)?.discord_username ?? null,
      avatar:   rowByDiscord.get(id)?.discord_avatar   ?? null,
    })),
  });
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
