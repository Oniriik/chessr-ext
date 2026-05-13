/**
 * Admin endpoints for per-user maintenance ops that need the bot in the
 * loop. Currently only one — force a Discord role re-sync. Lives here
 * (not on the dashboard's Next.js routes) because role syncing requires
 * emitting an internal event the bot listens on, which only the chessr
 * serveur has access to.
 *
 * Auth: x-admin-token. The dashboard route layer enforces super_admin.
 */

import { Hono, type Context } from 'hono';
import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/events.js';

export const adminUsersRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// ─── POST /admin/users/:userId/sync-discord-roles ──────────────────────
// Force-emit a `plan_changed` event with newPlan = current plan so the
// bot's planSync handler re-evaluates the Discord role (plan tier + ELO
// bracket). Used when a role drifted out of sync (e.g. bot was down at
// the time of the original event, or the user manually meddled with
// their roles).
//
// Returns: { ok, plan, discordId } on success, { error } when the user
// has no linked Discord or no user_settings row.

adminUsersRoutes.post('/admin/users/:userId/sync-discord-roles', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const userId = c.req.param('userId') || '';
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const { data, error } = await supabase
    .from('user_settings')
    .select('plan, discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'user_settings_missing' }, 404);

  const discordId = (data.discord_id as string | null) ?? null;
  if (!discordId) return c.json({ error: 'no_discord_link' }, 409);
  const plan = (data.plan as string | null) ?? 'free';

  // Same shape as the legitimate plan_changed events so the bot handler
  // doesn't need a new branch. oldPlan = newPlan signals a re-sync
  // intent rather than a real transition; the handler doesn't care.
  await emitEvent({
    type: 'plan_changed',
    user_id: userId,
    payload: {
      oldPlan: plan,
      newPlan: plan,
      discordId,
      reason: 'admin_force_sync',
    },
  });

  return c.json({ ok: true, plan, discordId });
});
