/**
 * Discord-boost reward bookkeeping for the bot.
 *
 * Stage-1 (record): bot detects a boost via guildMemberUpdate and
 * stores a row keyed (discord_id, done_at). granted_at stays NULL
 * until the reward is actually applied — so a user who boosts before
 * linking Discord still leaves a trace, and the link callback can
 * replay it.
 *
 *   POST /admin/boost/record   { discordId, doneAt, userId? }
 *     → { recorded: bool }       — false when row already existed
 *
 *   POST /admin/boost/grant    { discordId, doneAt, userId, rewardPath }
 *     → { granted: bool }        — false when row already had a granted_at
 *
 *   GET  /admin/boost/pending?discordId=X
 *     → { pending: [{ discord_id, done_at, reward_days }, …] }
 *        Only rows with granted_at IS NULL — used by the link callback
 *        to replay every outstanding reward for a freshly-linked user.
 *
 *   DELETE /admin/boost/grant   { discordId, doneAt }
 *     → { released: bool }       — clears granted_at so the bot can
 *                                  retry on the next click / event
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';

export const adminBoostRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// ─── POST /admin/boost/record ────────────────────────────────────────────
adminBoostRoutes.post('/admin/boost/record', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; doneAt?: string; userId?: string | null; rewardDays?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body.discordId || !body.doneAt) {
    return c.json({ error: 'discordId, doneAt required' }, 400);
  }

  const rows = await dbQuery<{ discord_id: string }>(
    `INSERT INTO discord_boosts (discord_id, done_at, user_id, reward_days)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (discord_id, done_at) DO NOTHING
     RETURNING discord_id`,
    [body.discordId, body.doneAt, body.userId ?? null, body.rewardDays ?? 15],
  );

  return c.json({ recorded: rows.length > 0 });
});

// ─── POST /admin/boost/grant ─────────────────────────────────────────────
adminBoostRoutes.post('/admin/boost/grant', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; doneAt?: string; userId?: string; rewardPath?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body.discordId || !body.doneAt || !body.userId || !body.rewardPath) {
    return c.json({ error: 'discordId, doneAt, userId, rewardPath required' }, 400);
  }

  // Only stamp granted_at on still-pending rows so concurrent grant
  // attempts can't double-spend the reward.
  const rows = await dbQuery<{ discord_id: string }>(
    `UPDATE discord_boosts
       SET granted_at = now(),
           user_id = $3,
           reward_path = $4
     WHERE discord_id = $1
       AND done_at = $2
       AND granted_at IS NULL
     RETURNING discord_id`,
    [body.discordId, body.doneAt, body.userId, body.rewardPath],
  );

  return c.json({ granted: rows.length > 0 });
});

// ─── DELETE /admin/boost/grant (rollback) ────────────────────────────────
adminBoostRoutes.delete('/admin/boost/grant', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; doneAt?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body.discordId || !body.doneAt) {
    return c.json({ error: 'discordId, doneAt required' }, 400);
  }

  const rows = await dbQuery<{ discord_id: string }>(
    `UPDATE discord_boosts
       SET granted_at = NULL,
           reward_path = NULL
     WHERE discord_id = $1
       AND done_at = $2
     RETURNING discord_id`,
    [body.discordId, body.doneAt],
  );

  return c.json({ released: rows.length > 0 });
});

// ─── GET /admin/boost/pending?discordId=X ────────────────────────────────
adminBoostRoutes.get('/admin/boost/pending', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const discordId = c.req.query('discordId');
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const rows = await dbQuery<{
    discord_id: string;
    done_at: string;
    reward_days: number;
  }>(
    `SELECT discord_id, done_at, reward_days
       FROM discord_boosts
      WHERE discord_id = $1
        AND granted_at IS NULL
      ORDER BY done_at ASC`,
    [discordId],
  );

  return c.json({ pending: rows });
});
