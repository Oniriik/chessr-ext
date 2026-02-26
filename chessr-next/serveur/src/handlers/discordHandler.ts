/**
 * discordHandler - WebSocket + HTTP handler for Discord OAuth linking
 */

import type { WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';

export interface Client {
  ws: WebSocket;
  user: {
    id: string;
    email: string;
  };
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI!;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_LINK_CHANNEL_ID = process.env.DISCORD_LINK_CHANNEL_ID;

// =============================================================================
// Nonce store: maps nonce → userId with 5-minute TTL
// =============================================================================

interface NonceEntry {
  userId: string;
  userEmail: string;
  createdAt: number;
}

const NONCE_TTL = 5 * 60 * 1000; // 5 minutes
const nonceStore = new Map<string, NonceEntry>();

// Cleanup expired nonces every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of nonceStore) {
    if (now - entry.createdAt > NONCE_TTL) {
      nonceStore.delete(nonce);
    }
  }
}, 60_000);

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// State encoding/decoding (nonce + returnUrl in base64url)
// =============================================================================

function encodeState(nonce: string, returnUrl: string): string {
  const json = JSON.stringify({ n: nonce, r: returnUrl });
  return Buffer.from(json).toString('base64url');
}

function decodeState(state: string): { nonce: string; returnUrl: string } | null {
  try {
    const json = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
    if (typeof json.n === 'string' && typeof json.r === 'string') {
      return { nonce: json.n, returnUrl: json.r };
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Message Types
// =============================================================================

export interface InitDiscordLinkMessage {
  type: 'init_discord_link';
  returnUrl: string;
}

// =============================================================================
// WebSocket Handler: init_discord_link
// =============================================================================

export function handleInitDiscordLink(
  message: InitDiscordLinkMessage,
  client: Client,
): void {
  const { returnUrl } = message;

  if (!returnUrl || typeof returnUrl !== 'string') {
    client.ws.send(
      JSON.stringify({
        type: 'discord_link_error',
        error: 'Missing returnUrl',
      }),
    );
    return;
  }

  // Generate nonce and store mapping
  const nonce = generateNonce();
  nonceStore.set(nonce, {
    userId: client.user.id,
    userEmail: client.user.email,
    createdAt: Date.now(),
  });

  // Build Discord OAuth URL
  const state = encodeState(nonce, returnUrl);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

  client.ws.send(
    JSON.stringify({
      type: 'discord_link_url',
      url,
    }),
  );
}

// =============================================================================
// HTTP Handler: GET /discord/callback
// =============================================================================

export async function handleDiscordCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Discord returned an error (user denied, etc.)
  if (error) {
    const decoded = stateParam ? decodeState(stateParam) : null;
    const returnUrl = decoded?.returnUrl || 'https://chess.com';
    redirect(res, returnUrl, 'discord_error=denied');
    return;
  }

  if (!code || !stateParam) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code or state');
    return;
  }

  // Decode and validate state
  const decoded = decodeState(stateParam);
  if (!decoded) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid state');
    return;
  }

  const { nonce, returnUrl } = decoded;

  // Look up nonce
  const nonceEntry = nonceStore.get(nonce);
  if (!nonceEntry) {
    redirect(res, returnUrl, 'discord_error=expired');
    return;
  }

  // Consume nonce (one-time use)
  nonceStore.delete(nonce);

  // Check TTL
  if (Date.now() - nonceEntry.createdAt > NONCE_TTL) {
    redirect(res, returnUrl, 'discord_error=expired');
    return;
  }

  const { userId, userEmail } = nonceEntry;

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[Discord] Token exchange failed:', await tokenRes.text());
      redirect(res, returnUrl, 'discord_error=token_failed');
      return;
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error('[Discord] User fetch failed:', await userRes.text());
      redirect(res, returnUrl, 'discord_error=fetch_failed');
      return;
    }

    const discordUser = await userRes.json();
    const discordId: string = discordUser.id;
    const discordUsername: string = discordUser.username;
    const discordAvatar: string | null = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : null;

    // Check if user is in our Discord server
    let inGuild = false;
    if (DISCORD_GUILD_ID) {
      try {
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (guildsRes.ok) {
          const guilds = await guildsRes.json();
          inGuild = guilds.some((g: { id: string }) => g.id === DISCORD_GUILD_ID);
        }
      } catch {
        // Non-critical, default to false
      }
    }

    // Check if this Discord account is already linked to another user
    const { data: existing } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('discord_id', discordId)
      .neq('user_id', userId)
      .single();

    if (existing) {
      console.log(`[Discord] Discord ${discordId} already linked to user ${existing.user_id}`);
      redirect(res, returnUrl, 'discord_error=already_linked');
      return;
    }

    // Get current user settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('plan, freetrial_used')
      .eq('user_id', userId)
      .single();

    // Build update payload
    const updateData: Record<string, unknown> = {
      discord_id: discordId,
      discord_username: discordUsername,
      discord_avatar: discordAvatar,
      discord_linked_at: new Date().toISOString(),
      discord_in_guild: inGuild,
    };

    // Activate free trial if eligible
    let planChanged = false;
    if (settings?.plan === 'free' && !settings?.freetrial_used) {
      const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      updateData.plan = 'freetrial';
      updateData.plan_expiry = expiry;
      updateData.freetrial_used = true;
      planChanged = true;

      // Log plan change
      await supabase.from('plan_activity_logs').insert({
        user_id: userId,
        user_email: userEmail,
        action_type: 'discord_link',
        old_plan: 'free',
        new_plan: 'freetrial',
        old_expiry: null,
        new_expiry: expiry,
        reason: `Discord linked: ${discordUsername} (${discordId})`,
      });
    } else if (!settings?.freetrial_used) {
      // User is on another plan, just mark freetrial as not used yet (keep default)
    }

    // Update user_settings
    const { error: updateError } = await supabase
      .from('user_settings')
      .update(updateData)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[Discord] Update failed:', updateError.message);
      redirect(res, returnUrl, 'discord_error=save_failed');
      return;
    }

    console.log(
      `[Discord] User ${userEmail} linked Discord: ${discordUsername} (${discordId})${planChanged ? ' → freetrial activated' : ''}`,
    );

    // Send notification to Discord channel (fire and forget)
    notifyDiscordLink(userEmail, discordUsername, discordAvatar, inGuild, planChanged);

    // Redirect back to the original page
    redirect(res, returnUrl, 'discord_linked=true');
  } catch (err) {
    console.error('[Discord] Callback error:', err);
    redirect(res, returnUrl, 'discord_error=unknown');
  }
}

// =============================================================================
// WebSocket Handler: unlink_discord
// =============================================================================

export async function handleUnlinkDiscord(client: Client): Promise<void> {
  const userId = client.user.id;

  try {
    const { error } = await supabase
      .from('user_settings')
      .update({
        discord_id: null,
        discord_username: null,
        discord_avatar: null,
        discord_linked_at: null,
        discord_in_guild: false,
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[Discord] Unlink failed:', error.message);
      client.ws.send(JSON.stringify({ type: 'discord_unlink_error', error: 'Failed to unlink' }));
      return;
    }

    console.log(`[Discord] User ${client.user.email} unlinked Discord`);
    client.ws.send(JSON.stringify({ type: 'discord_unlink_success' }));
  } catch (err) {
    console.error('[Discord] Unlink error:', err);
    client.ws.send(JSON.stringify({ type: 'discord_unlink_error', error: 'Unknown error' }));
  }
}

// =============================================================================
// Discord Notification
// =============================================================================

async function notifyDiscordLink(
  userEmail: string,
  discordUsername: string,
  discordAvatar: string | null,
  inGuild: boolean,
  planChanged: boolean,
): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_LINK_CHANNEL_ID) return;

  try {
    const fields = [
      { name: '📧 Chessr Email', value: userEmail, inline: true },
      { name: '🎮 Discord', value: discordUsername, inline: true },
      { name: '📡 In Server', value: inGuild ? '✅ Yes' : '❌ No', inline: true },
    ];

    if (planChanged) {
      fields.push({ name: '🎁 Free Trial', value: 'Activated (3 days)', inline: true });
    }

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_LINK_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: '🔗 Discord Account Linked',
          color: 0x5865f2,
          fields,
          thumbnail: discordAvatar ? { url: discordAvatar } : undefined,
          timestamp: new Date().toISOString(),
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      }),
    });
  } catch (err) {
    console.error('[Discord] Failed to send link notification:', err);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function redirect(res: ServerResponse, baseUrl: string, queryParam: string): void {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${separator}${queryParam}`;
  res.writeHead(302, { Location: url });
  res.end();
}
