/**
 * Admin Discord endpoints — DM history, send, channel messages.
 * Auth: x-admin-token (same pattern as adminUsers.ts).
 * Requires DISCORD_BOT_TOKEN in env.
 */

import { Hono, type Context } from 'hono';

export const adminDiscordRoutes = new Hono();

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN   = process.env.DISCORD_BOT_TOKEN ?? '';

const MOD_CHANNELS: Record<string, string> = Object.fromEntries(
  [
    ['subscriptions', process.env.DISCORD_MOD_SUBSCRIPTIONS_CHANNEL_ID],
    ['users',         process.env.DISCORD_MOD_USERS_CHANNEL_ID],
    ['security',      process.env.DISCORD_MOD_SECURITY_CHANNEL_ID],
    ['plan-notif',    process.env.DISCORD_PLAN_NOTIF_CHANNEL_ID],
  ].filter(([, id]) => !!id) as [string, string][],
);

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') ?? c.req.query('token') ?? '';
  const expected = process.env.ADMIN_TOKEN ?? '';
  return !!expected && token === expected;
}

async function openDmChannel(discordId: string): Promise<string | null> {
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!res.ok) return null;
  const { id } = await res.json() as { id: string };
  return id ?? null;
}

// GET /admin/discord/mod-channels
adminDiscordRoutes.get('/admin/discord/mod-channels', (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const channels = Object.entries(MOD_CHANNELS).map(([name, id]) => ({ name, id }));
  return c.json({ channels });
});

// GET /admin/discord/dm-history?discordId=xxx[&before=messageId]
adminDiscordRoutes.get('/admin/discord/dm-history', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  if (!BOT_TOKEN) return c.json({ error: 'Bot token not configured' }, 503);

  const discordId = c.req.query('discordId') ?? '';
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const before = c.req.query('before') ?? '';

  const channelId = await openDmChannel(discordId);
  if (!channelId) return c.json({ error: 'Could not open DM channel' }, 502);

  const qs = new URLSearchParams({ limit: '50' });
  if (before) qs.set('before', before);

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?${qs}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });
  if (!res.ok) {
    console.warn('[adminDiscord] dm-history', res.status, discordId);
    return c.json({ messages: [], channelId });
  }
  const messages = await res.json();
  return c.json({ messages, channelId });
});

// POST /admin/discord/dm-send
// Body: { discordIds: string[], content: string }
adminDiscordRoutes.post('/admin/discord/dm-send', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  if (!BOT_TOKEN) return c.json({ error: 'Bot token not configured' }, 503);

  const body = await c.req.json().catch(() => ({})) as {
    discordIds?: string[];
    content?: string;
  };
  const { discordIds, content } = body;

  if (!Array.isArray(discordIds) || discordIds.length === 0)
    return c.json({ error: 'discordIds required' }, 400);
  if (!content?.trim())
    return c.json({ error: 'content required' }, 400);

  const results = await Promise.allSettled(
    discordIds.map(async (id) => {
      const channelId = await openDmChannel(id);
      if (!channelId) throw new Error('channel open failed');
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return id;
    }),
  );

  const sent   = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? discordIds[i] : null))
    .filter(Boolean) as string[];

  return c.json({ sent, failed, total: discordIds.length });
});

// GET /admin/discord/channel-messages?channelId=xxx
adminDiscordRoutes.get('/admin/discord/channel-messages', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  if (!BOT_TOKEN) return c.json({ error: 'Bot token not configured' }, 503);

  const channelId = c.req.query('channelId') ?? '';
  if (!channelId) return c.json({ error: 'channelId required' }, 400);

  const before = c.req.query('before') ?? '';
  const qs = new URLSearchParams({ limit: '25' });
  if (before) qs.set('before', before);

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?${qs}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });
  if (!res.ok) return c.json({ error: `Discord ${res.status}` }, 502);
  const messages = await res.json();
  return c.json({ messages });
});
