/**
 * Invite tracking — server-side companion to the bot's
 * inviteCache + guildMemberAdd diff.
 *
 * Endpoints:
 *
 *   POST /admin/invites/use     log a join attributed to an inviter.
 *                               If the inviter has an open giveaway
 *                               registration, also grants them +1 ticket
 *                               and emits the giveaway_ticket_earned
 *                               event so the bot can DM.
 *
 *   GET  /admin/invites/by-inviter
 *        ?inviterDiscordId=&since=&until=
 *                               Used by the giveaway register backfill
 *                               so the bot doesn't have to express the
 *                               SQL itself.
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';

export const adminInviteRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

interface InviteUseInput {
  guildId?: string;
  inviteeDiscordId?: string;
  inviterDiscordId?: string | null;
  inviteCode?: string | null;
}

// ─── POST /admin/invites/use ─────────────────────────────────────────────

adminInviteRoutes.post('/admin/invites/use', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: InviteUseInput;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const guildId = (body.guildId ?? '').trim();
  const invitee = (body.inviteeDiscordId ?? '').trim();
  const inviter = body.inviterDiscordId ? body.inviterDiscordId.trim() : null;
  const code = body.inviteCode ? body.inviteCode.trim() : null;
  if (!guildId || !invitee) return c.json({ error: 'guildId and inviteeDiscordId required' }, 400);

  // ON CONFLICT DO NOTHING + RETURNING gives us the row only when
  // freshly inserted — re-joins after a leave don't re-count.
  const inserted = await dbQuery<{ id: number }>(
    `INSERT INTO invite_uses (guild_id, invitee_discord_id, inviter_discord_id, invite_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, invitee_discord_id) DO NOTHING
     RETURNING id`,
    [guildId, invitee, inviter, code],
  );
  if (inserted.length === 0) {
    return c.json({ logged: true, already: true });
  }

  // Grant a ticket to the inviter on every active giveaway they're
  // registered for, but only when the join is between starts_at and
  // ends_at. A user registered on multiple concurrent giveaways earns
  // one ticket per giveaway — surprising at first but correct: the
  // invite happened during each window.
  let granted = 0;
  if (inviter) {
    const eligible = await dbQuery<{ id: number; starts_at: string; ends_at: string }>(
      `SELECT g.id, g.starts_at::text, g.ends_at::text
         FROM giveaways g
         JOIN giveaway_registrations r
              ON r.giveaway_id = g.id AND r.discord_id = $1
        WHERE g.status = 'scheduled'
          AND now() >= g.starts_at
          AND now() <  g.ends_at`,
      [inviter],
    );
    for (const g of eligible) {
      await dbQuery(
        `INSERT INTO giveaway_tickets
           (giveaway_id, owner_discord_id, source, count, external_ref)
         VALUES ($1, $2, 'invite', 1, $3)`,
        [g.id, inviter, invitee],
      );
      await emitEvent({
        type: 'giveaway_ticket_earned',
        actor_id: null,
        payload: {
          giveawayId: g.id,
          count: 1,
          source: 'invite',
          discordId: inviter,
          inviteeDiscordId: invitee,
        },
      });
      granted++;
    }
  }

  return c.json({ logged: true, already: false, ticketsGranted: granted });
});

// ─── GET /admin/invites/by-inviter ───────────────────────────────────────

adminInviteRoutes.get('/admin/invites/by-inviter', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const inviter = (u.searchParams.get('inviterDiscordId') ?? '').trim();
  const since = u.searchParams.get('since');
  const until = u.searchParams.get('until');
  if (!inviter) return c.json({ error: 'inviterDiscordId required' }, 400);

  const wheres = ['inviter_discord_id = $1'];
  const params: unknown[] = [inviter];
  if (since && !Number.isNaN(Date.parse(since))) {
    params.push(since);
    wheres.push(`joined_at >= $${params.length}`);
  }
  if (until && !Number.isNaN(Date.parse(until))) {
    params.push(until);
    wheres.push(`joined_at <  $${params.length}`);
  }

  const rows = await dbQuery<{ invitee_discord_id: string; invite_code: string | null; joined_at: string }>(
    `SELECT invitee_discord_id, invite_code, joined_at::text
       FROM invite_uses
      WHERE ${wheres.join(' AND ')}
      ORDER BY joined_at DESC`,
    params,
  );
  return c.json({ invites: rows, count: rows.length });
});
