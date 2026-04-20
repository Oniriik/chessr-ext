import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';

const app = new Hono();

app.post('/accounts/link', async (c) => {
  const { userId, platform, username, avatarUrl, ratingBullet, ratingBlitz, ratingRapid } =
    await c.req.json() as {
      userId: string;
      platform: string;
      username: string;
      avatarUrl?: string;
      ratingBullet?: number;
      ratingBlitz?: number;
      ratingRapid?: number;
    };

  if (!userId || !platform || !username) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Check if already linked to another user
  const { data: existing } = await supabase
    .from('linked_accounts')
    .select('user_id')
    .eq('platform', platform)
    .eq('platform_username', username.toLowerCase())
    .is('unlinked_at', null)
    .maybeSingle();

  if (existing && existing.user_id !== userId) {
    return c.json({ error: 'ALREADY_LINKED' }, 409);
  }

  if (existing && existing.user_id === userId) {
    return c.json({ error: 'Already linked to your account' }, 409);
  }

  const { data, error } = await supabase
    .from('linked_accounts')
    .insert({
      user_id: userId,
      platform,
      platform_username: username.toLowerCase(),
      display_name: username,
      avatar_url: avatarUrl || null,
      rating_bullet: ratingBullet || null,
      rating_blitz: ratingBlitz || null,
      rating_rapid: ratingRapid || null,
      linked_at: new Date().toISOString(),
    })
    .select('id, platform, platform_username, avatar_url')
    .single();

  if (error) return c.json({ error: 'Failed to link' }, 500);

  return c.json({ success: true, account: data });
});

app.post('/accounts/unlink', async (c) => {
  const { userId, accountId } = await c.req.json() as { userId: string; accountId: string };

  if (!userId || !accountId) return c.json({ error: 'Missing userId or accountId' }, 400);

  // Verify the account belongs to the user
  const { data: account } = await supabase
    .from('linked_accounts')
    .select('user_id')
    .eq('id', accountId)
    .single();

  if (!account || account.user_id !== userId) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const { error } = await supabase
    .from('linked_accounts')
    .update({ unlinked_at: new Date().toISOString() })
    .eq('id', accountId);

  if (error) return c.json({ error: 'Failed to unlink' }, 500);

  return c.json({ success: true });
});

export { app as accountRoutes };
