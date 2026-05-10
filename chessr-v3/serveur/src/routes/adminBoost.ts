/**
 * Idempotency claim for the Discord-boost reward.
 *
 * The bot detects a boost via guildMemberUpdate, then calls this
 * endpoint to grab a (discord_id, premium_since) slot in the local
 * `discord_boosts` table. If the slot was already claimed (Discord
 * fired a duplicate event, or the user clicked the claim button
 * twice), we tell the bot so it can skip the actual reward.
 *
 *   POST /admin/boost/claim
 *     body:    { discordId, premiumSince, userId?, rewardPath, rewardDays? }
 *     returns: { claimed: bool, alreadyGranted: bool }
 *
 *   DELETE /admin/boost/claim
 *     body:    { discordId, premiumSince }
 *     returns: { released: bool }
 *
 * The DELETE exists so the bot can release a claim it took if the
 * subsequent extension fails — without a release the user would be
 * stuck unable to retry until a fresh boost.
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';

export const adminBoostRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

adminBoostRoutes.post('/admin/boost/claim', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: {
    discordId?: string;
    premiumSince?: string;
    userId?: string | null;
    rewardPath?: string;
    rewardDays?: number;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body.discordId || !body.premiumSince || !body.rewardPath) {
    return c.json({ error: 'discordId, premiumSince, rewardPath required' }, 400);
  }

  // INSERT ... ON CONFLICT DO NOTHING. RETURNING tells us whether the
  // row was actually written or skipped.
  const rows = await dbQuery<{ discord_id: string }>(
    `INSERT INTO discord_boosts
       (discord_id, premium_since, user_id, reward_path, reward_days)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_id, premium_since) DO NOTHING
     RETURNING discord_id`,
    [
      body.discordId,
      body.premiumSince,
      body.userId ?? null,
      body.rewardPath,
      body.rewardDays ?? 15,
    ],
  );

  return c.json({ claimed: rows.length > 0, alreadyGranted: rows.length === 0 });
});

adminBoostRoutes.delete('/admin/boost/claim', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; premiumSince?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body.discordId || !body.premiumSince) {
    return c.json({ error: 'discordId, premiumSince required' }, 400);
  }

  const rows = await dbQuery<{ discord_id: string }>(
    `DELETE FROM discord_boosts
     WHERE discord_id = $1 AND premium_since = $2
     RETURNING discord_id`,
    [body.discordId, body.premiumSince],
  );

  return c.json({ released: rows.length > 0 });
});
