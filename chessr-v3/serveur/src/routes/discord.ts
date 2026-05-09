import { Hono } from 'hono';
import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/events.js';

const app = new Hono();

const DISCORD_API = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;
// Auto-join: when set, the OAuth callback PUTs the user into this guild
// using the bot token. Optional — if either of these is unset, we just
// skip the join and the link still completes.
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Nonce store — 5 min TTL
const nonces = new Map<string, { userId: string; returnUrl: string; createdAt: number }>();

// Cleanup expired nonces every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of nonces) {
    if (now - val.createdAt > 5 * 60 * 1000) nonces.delete(key);
  }
}, 60_000);

// Initiate Discord OAuth — called by extension
app.get('/discord/link', (c) => {
  const userId = c.req.query('userId');
  const returnUrl = c.req.query('returnUrl') || 'https://chess.com';

  if (!userId) return c.json({ error: 'Missing userId' }, 400);

  const nonce = crypto.randomBytes(32).toString('hex');
  nonces.set(nonce, { userId, returnUrl, createdAt: Date.now() });

  const state = Buffer.from(JSON.stringify({ n: nonce, r: returnUrl })).toString('base64url');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    // identify: read the user's profile (id, username, avatar).
    // guilds.join: lets us PUT the user into the configured guild via
    // the bot token after the callback. Discord requires the user to
    // grant this scope explicitly during consent.
    scope: 'identify guilds.join',
    state,
  });

  return c.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

// Discord OAuth callback
app.get('/discord/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state');

  if (!code || !stateParam) return c.text('Missing code or state', 400);

  // Decode state
  let nonce: string;
  let returnUrl: string;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
    nonce = decoded.n;
    returnUrl = decoded.r;
  } catch {
    return c.text('Invalid state', 400);
  }

  // Validate nonce
  const nonceData = nonces.get(nonce);
  if (!nonceData) return c.redirect(`${returnUrl}?discord_error=expired`);
  nonces.delete(nonce);

  const { userId } = nonceData;

  // Exchange code for token
  let accessToken: string;
  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) return c.redirect(`${returnUrl}?discord_error=token_failed`);
    accessToken = tokenData.access_token;
  } catch {
    return c.redirect(`${returnUrl}?discord_error=token_failed`);
  }

  // Fetch Discord user
  let discordUser: { id: string; username: string; avatar: string | null };
  try {
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    discordUser = await userRes.json() as typeof discordUser;
    if (!discordUser.id) return c.redirect(`${returnUrl}?discord_error=unknown`);
  } catch {
    return c.redirect(`${returnUrl}?discord_error=unknown`);
  }

  // Check if discord_id already linked to another user
  const { data: existing } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('discord_id', discordUser.id)
    .neq('user_id', userId)
    .maybeSingle();

  if (existing) return c.redirect(`${returnUrl}?discord_error=already_linked`);

  // Build avatar URL
  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
    : null;

  // Save to DB
  const { error } = await supabase
    .from('user_settings')
    .update({
      discord_id: discordUser.id,
      discord_username: discordUser.username,
      discord_avatar: avatarUrl,
      discord_linked_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) return c.redirect(`${returnUrl}?discord_error=save_failed`);

  // Auto-join the configured guild. Best-effort — a 204 means "already
  // a member" (success), 201 means "added", anything else just gets
  // logged and the link still completes. Only runs when both vars are
  // set so this stays optional per environment.
  if (GUILD_ID && BOT_TOKEN) {
    try {
      const joinRes = await fetch(`${DISCORD_API}/guilds/${GUILD_ID}/members/${discordUser.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      });
      if (joinRes.status !== 201 && joinRes.status !== 204) {
        const body = await joinRes.text().catch(() => '');
        console.warn('[discord] guilds.add failed', joinRes.status, body);
      }
    } catch (err) {
      console.warn('[discord] guilds.add threw:', err instanceof Error ? err.message : err);
    }
  }

  await emitEvent({
    type: 'discord_linked',
    user_id: userId,
    payload: { discordId: discordUser.id, discordUsername: discordUser.username },
  });

  return c.redirect(`${returnUrl}?discord_linked=true`);
});

// Unlink Discord
app.post('/discord/unlink', async (c) => {
  const { userId } = await c.req.json() as { userId: string };
  if (!userId) return c.json({ error: 'Missing userId' }, 400);

  // Capture the discord_id BEFORE clearing it — the bot needs it in the
  // event payload to strip the plan role from the now-orphaned Discord
  // member (otherwise an unlinked user keeps their Premium role forever).
  const { data: prev } = await supabase
    .from('user_settings')
    .select('discord_id')
    .eq('user_id', userId)
    .maybeSingle();

  const { error } = await supabase
    .from('user_settings')
    .update({
      discord_id: null,
      discord_username: null,
      discord_avatar: null,
      discord_linked_at: null,
    })
    .eq('user_id', userId);

  if (error) return c.json({ error: 'Failed to unlink' }, 500);

  await emitEvent({
    type: 'discord_unlinked',
    user_id: userId,
    payload: prev?.discord_id ? { discordId: prev.discord_id } : {},
  });

  return c.json({ success: true });
});

// Get Discord link status
app.get('/discord/status', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'Missing userId' }, 400);

  const { data } = await supabase
    .from('user_settings')
    .select('discord_id, discord_username, discord_avatar')
    .eq('user_id', userId)
    .single();

  return c.json({
    linked: !!data?.discord_id,
    username: data?.discord_username || null,
    avatar: data?.discord_avatar || null,
  });
});

export { app as discordRoutes };
