/**
 * Ticket lifecycle endpoints — bot calls these on every transition so
 * the DB stays in sync with Discord. Endpoints are intentionally thin;
 * the bot owns the Discord side (channel create, perms, rename, move,
 * delete) and tells us what just happened.
 *
 *   POST /admin/tickets/open    → mints a new id, returns ticket number
 *   POST /admin/tickets/:id/close
 *   POST /admin/tickets/:id/reopen
 *   POST /admin/tickets/:id/delete
 *   GET  /admin/tickets/by-channel/:channelId
 *   GET  /admin/tickets/open-for-opener/:discordId
 *   GET  /admin/tickets/info?discordId=…   → all the lookup data the
 *                                            bot's Info button surfaces
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';

export const adminTicketRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

interface TicketRow {
  id: number;
  opener_discord_id: string;
  opener_username: string | null;
  channel_id: string;
  status: 'open' | 'closed' | 'deleted';
  opened_at: string;
  closed_at: string | null;
  closed_by_discord_id: string | null;
  deleted_at: string | null;
  deleted_by_discord_id: string | null;
}

// ─── POST /admin/tickets/open ────────────────────────────────────────────
// Bot calls this BEFORE creating the Discord channel — gives us a
// stable id that the bot uses both for the channel name (#0001) and
// the topic. If channel creation fails afterwards, the row is still
// there but with no real channel; the bot's "did this opener already
// have an open ticket?" check uses opener_discord_id + status, not
// the channel, so the row doesn't poison future opens.

adminTicketRoutes.post('/admin/tickets/open', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { openerDiscordId?: string; openerUsername?: string; channelId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const opener = (body.openerDiscordId ?? '').trim();
  const username = (body.openerUsername ?? '').trim() || null;
  const channelId = (body.channelId ?? '').trim();
  if (!opener || !channelId) return c.json({ error: 'openerDiscordId and channelId required' }, 400);

  const rows = await dbQuery<{ id: number }>(
    `INSERT INTO tickets (opener_discord_id, opener_username, channel_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [opener, username, channelId],
  );
  return c.json({ id: rows[0].id });
});

// ─── POST /admin/tickets/:id/close ───────────────────────────────────────

adminTicketRoutes.post('/admin/tickets/:id/close', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { closedByDiscordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const rows = await dbQuery<{ id: number }>(
    `UPDATE tickets SET status = 'closed', closed_at = now(), closed_by_discord_id = $1
      WHERE id = $2 AND status = 'open'
     RETURNING id`,
    [body.closedByDiscordId ?? null, id],
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_already_closed' }, 404);
  return c.json({ closed: true });
});

// ─── POST /admin/tickets/:id/reopen ──────────────────────────────────────

adminTicketRoutes.post('/admin/tickets/:id/reopen', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  const rows = await dbQuery<{ id: number }>(
    `UPDATE tickets SET status = 'open', closed_at = NULL, closed_by_discord_id = NULL
      WHERE id = $1 AND status = 'closed'
     RETURNING id`,
    [id],
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_not_closed' }, 404);
  return c.json({ reopened: true });
});

// ─── POST /admin/tickets/:id/delete ──────────────────────────────────────

adminTicketRoutes.post('/admin/tickets/:id/delete', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { deletedByDiscordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const rows = await dbQuery<{ id: number }>(
    `UPDATE tickets
        SET status = 'deleted', deleted_at = now(), deleted_by_discord_id = $1
      WHERE id = $2 AND status IN ('open', 'closed')
     RETURNING id`,
    [body.deletedByDiscordId ?? null, id],
  );
  if (rows.length === 0) return c.json({ error: 'not_found_or_already_deleted' }, 404);
  return c.json({ deleted: true });
});

// ─── GET /admin/tickets/by-channel/:channelId ────────────────────────────

adminTicketRoutes.get('/admin/tickets/by-channel/:channelId', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const channelId = c.req.param('channelId');
  const rows = await dbQuery<TicketRow>(
    `SELECT * FROM tickets WHERE channel_id = $1`, [channelId],
  );
  if (rows.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json(rows[0]);
});

// ─── GET /admin/tickets/open-for-opener/:discordId ───────────────────────

adminTicketRoutes.get('/admin/tickets/open-for-opener/:discordId', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const opener = c.req.param('discordId');
  const rows = await dbQuery<TicketRow>(
    `SELECT * FROM tickets WHERE opener_discord_id = $1 AND status = 'open' LIMIT 1`,
    [opener],
  );
  if (rows.length === 0) return c.json({ open: false });
  return c.json({ open: true, ticket: rows[0] });
});

// ─── GET /admin/tickets/info?discordId=… ─────────────────────────────────
// Aggregates the per-user data the Info button surfaces. Bot just
// renders the embed; all the Supabase joins live here so we don't
// duplicate the query layer.

adminTicketRoutes.get('/admin/tickets/info', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const discordId = (new URL(c.req.url).searchParams.get('discordId') ?? '').trim();
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const sb = supabase;

  // 1) user_settings keyed on discord_id — gives us the user_id needed
  //    for every other lookup. Missing row = unlinked Discord user.
  const settingsRes = await sb
    .from('user_settings')
    .select('user_id, plan, freetrial_used, discord_id, discord_username, banned, ban_reason')
    .eq('discord_id', discordId)
    .maybeSingle();

  if (settingsRes.error) return c.json({ error: settingsRes.error.message }, 500);
  if (!settingsRes.data) return c.json({ linked: false, discordId });

  const userId = settingsRes.data.user_id as string;
  const settings = settingsRes.data;

  // 2) Email via auth admin API.
  const authRes = await sb.auth.admin.getUserById(userId);
  const email = authRes.data?.user?.email ?? null;

  // 3) linked_accounts (chess.com / lichess / worldchess).
  const linkedRes = await sb
    .from('linked_accounts')
    .select('platform, platform_username, rating_bullet, rating_blitz, rating_rapid')
    .eq('user_id', userId)
    .is('unlinked_at', null);

  // 4) fingerprints / ips — same pattern as v2 bot.
  const [fpRes, ipRes] = await Promise.all([
    sb.from('user_fingerprints').select('fingerprint').eq('user_id', userId),
    sb.from('signup_ips').select('ip_address, country').eq('user_id', userId),
  ]);

  return c.json({
    linked: true,
    discordId,
    userId,
    email,
    plan: settings.plan,
    freetrialUsed: settings.freetrial_used,
    discordUsername: settings.discord_username,
    banned: settings.banned,
    banReason: settings.ban_reason,
    linkedAccounts: linkedRes.data ?? [],
    fingerprints: (fpRes.data ?? []).map((r: { fingerprint: string }) => r.fingerprint),
    ips: (ipRes.data ?? []).map((r: { ip_address: string; country: string | null }) => ({
      ip: r.ip_address, country: r.country,
    })),
  });
});
