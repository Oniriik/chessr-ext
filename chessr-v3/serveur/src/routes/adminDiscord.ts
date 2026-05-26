/**
 * Admin Discord endpoints — DM history, send, channel messages, threads.
 * Auth: x-admin-token (same pattern as adminUsers.ts).
 * Requires DISCORD_BOT_TOKEN in env.
 *
 * Conversation tracking uses discord_dm_threads in local Postgres.
 * The bot has no direct pg access; it reports inbound DMs via
 * POST /internal/dm-received (also here, same auth).
 */

import { Hono, type Context } from 'hono';
import { supabase } from '../lib/supabase.js';
import { dbQuery } from '../lib/db.js';

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

async function upsertThread(
  discordId: string,
  channelId: string,
  direction: 'inbound' | 'outbound',
  preview: string,
): Promise<void> {
  const now = new Date().toISOString();
  const col = direction === 'inbound' ? 'inbound' : 'outbound';
  await dbQuery(
    `INSERT INTO discord_dm_threads
       (discord_id, channel_id, last_${col}_at, last_${col}_preview, updated_at)
     VALUES ($1, $2, $3, $4, $3)
     ON CONFLICT (discord_id) DO UPDATE SET
       channel_id           = EXCLUDED.channel_id,
       last_${col}_at       = EXCLUDED.last_${col}_at,
       last_${col}_preview  = EXCLUDED.last_${col}_preview,
       updated_at           = EXCLUDED.updated_at`,
    [discordId, channelId, now, preview.slice(0, 150)],
  );
}

// ─── Internal: called by the bot when a DM is received ───────────────────

// POST /internal/dm-received
// Body: { discordId, channelId, preview }
adminDiscordRoutes.post('/internal/dm-received', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const body = await c.req.json().catch(() => ({})) as {
    discordId?: string; channelId?: string; preview?: string;
  };
  if (!body.discordId || !body.channelId) return c.json({ error: 'discordId + channelId required' }, 400);
  await upsertThread(body.discordId, body.channelId, 'inbound', body.preview ?? '').catch(console.error);
  return c.json({ ok: true });
});

// ─── Threads list ─────────────────────────────────────────────────────────

type ThreadRow = {
  discord_id: string;
  channel_id: string | null;
  last_inbound_at: string | null;
  last_inbound_preview: string | null;
  last_outbound_at: string | null;
  last_outbound_preview: string | null;
  updated_at: string;
};

// GET /admin/discord/threads
adminDiscordRoutes.get('/admin/discord/threads', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const threads = await dbQuery<ThreadRow>(
    `SELECT discord_id, channel_id,
            last_inbound_at, last_inbound_preview,
            last_outbound_at, last_outbound_preview,
            updated_at
       FROM discord_dm_threads
      ORDER BY updated_at DESC
      LIMIT 200`,
  );

  if (!threads.length) return c.json({ threads: [] });

  // Enrich with user_settings (username, avatar, plan)
  const discordIds = threads.map((t) => t.discord_id);
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, discord_id, discord_username, discord_avatar, plan')
    .in('discord_id', discordIds);

  const settingsMap = new Map(
    (settings ?? []).map((s) => [s.discord_id as string, s]),
  );

  // Enrich with emails — fetch only the specific user_ids we need
  const userIds = [...new Set((settings ?? []).map((s) => s.user_id as string))];
  const emails = new Map<string, string>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      if (data?.user?.email) emails.set(id, data.user.email);
    }),
  );

  const enriched = threads.map((t) => {
    const s = settingsMap.get(t.discord_id);
    const userId = s?.user_id as string | undefined;
    return {
      discordId:           t.discord_id,
      channelId:           t.channel_id,
      lastInboundAt:       t.last_inbound_at,
      lastInboundPreview:  t.last_inbound_preview,
      lastOutboundAt:      t.last_outbound_at,
      lastOutboundPreview: t.last_outbound_preview,
      updatedAt:           t.updated_at,
      discordUsername:     (s?.discord_username as string | null) ?? null,
      discordAvatar:       (s?.discord_avatar  as string | null) ?? null,
      email:               userId ? (emails.get(userId) ?? null) : null,
      plan:                (s?.plan as string | null) ?? 'free',
    };
  });

  return c.json({ threads: enriched });
});

// ─── Mod channels ─────────────────────────────────────────────────────────

// GET /admin/discord/mod-channels
adminDiscordRoutes.get('/admin/discord/mod-channels', (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const channels = Object.entries(MOD_CHANNELS).map(([name, id]) => ({ name, id }));
  return c.json({ channels });
});

// ─── DM history ───────────────────────────────────────────────────────────

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

// ─── DM send ──────────────────────────────────────────────────────────────

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
      // Track outbound DM
      await upsertThread(id, channelId, 'outbound', content.trim()).catch(console.error);
      return id;
    }),
  );

  const sent   = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? discordIds[i] : null))
    .filter(Boolean) as string[];

  return c.json({ sent, failed, total: discordIds.length });
});

// ─── Channel messages ─────────────────────────────────────────────────────

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
