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
const DISCORD_CHANNEL_DISCORD = process.env.DISCORD_CHANNEL_DISCORD;
const DISCORD_CHANNEL_PLANS = process.env.DISCORD_CHANNEL_PLANS;
const DISCORD_CHANNEL_ACCOUNTS = process.env.DISCORD_CHANNEL_ACCOUNTS;

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
    // Check both user-level flag AND Discord-level history (prevents re-link abuse)
    let planChanged = false;
    if (settings?.plan === 'free' && !settings?.freetrial_used) {
      // Check if this Discord account was already used for a freetrial on ANY Chessr account
      const { data: discordHistory } = await supabase
        .from('discord_freetrial_history')
        .select('discord_id')
        .eq('discord_id', discordId)
        .single();

      if (!discordHistory) {
        // Discord never used for a trial → grant it
        const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        updateData.plan = 'freetrial';
        updateData.plan_expiry = expiry;
        updateData.freetrial_used = true;
        planChanged = true;

        // Record in Discord freetrial history
        await supabase.from('discord_freetrial_history').insert({
          discord_id: discordId,
          user_id: userId,
        });

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
      } else {
        console.log(`[Discord] Discord ${discordId} already used freetrial, skipping trial for ${userEmail}`);
      }
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

    // Send notification to Discord channel
    try {
      await notifyDiscordLink(userEmail, discordUsername, discordId, discordAvatar, inGuild);
      if (planChanged) {
        await notifyFreeTrialActivated(userEmail, discordId);
      }
    } catch (err) {
      console.error('[Discord] Failed to send link notifications:', err);
    }

    // Assign Discord roles immediately if user is in the guild
    if (inGuild) {
      const plan = planChanged ? 'freetrial' : (settings?.plan || 'free');
      assignDiscordRoles(discordId, userId, plan).catch((err) =>
        console.error('[Discord] Failed to assign roles on link:', err),
      );
    }

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
    // Fetch current Discord info before clearing (for notification)
    const { data: settings } = await supabase
      .from('user_settings')
      .select('discord_id, discord_username')
      .eq('user_id', userId)
      .single();

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

    // Send notification (non-blocking)
    notifyDiscordUnlink(
      client.user.email,
      settings?.discord_username || null,
      settings?.discord_id || null,
      'Extension',
    ).catch((err) => console.error('[Discord] Failed to send unlink notification:', err));
  } catch (err) {
    console.error('[Discord] Unlink error:', err);
    client.ws.send(JSON.stringify({ type: 'discord_unlink_error', error: 'Unknown error' }));
  }
}

// =============================================================================
// Discord Notification
// =============================================================================

/**
 * Send embed to a Discord channel via Bot API.
 */
async function sendToChannel(channelId: string, embed: Record<string, unknown>): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !channelId) return;
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

/**
 * Notify #discord-infos when a user links their Discord account.
 */
async function notifyDiscordLink(
  userEmail: string,
  discordUsername: string,
  discordId: string,
  discordAvatar: string | null,
  inGuild: boolean,
): Promise<void> {
  const channelId = DISCORD_CHANNEL_DISCORD || DISCORD_LINK_CHANNEL_ID;
  if (!channelId) return;

  try {
    await sendToChannel(channelId, {
      title: '🔗 Discord Account Linked',
      color: 0x5865f2,
      fields: [
        { name: '📧 Email', value: userEmail, inline: true },
        { name: '🎮 Discord', value: `<@${discordId}>`, inline: true },
        { name: '📡 In Server', value: inGuild ? '✅ Yes' : '❌ No', inline: true },
      ],
      thumbnail: discordAvatar ? { url: discordAvatar } : undefined,
      timestamp: new Date().toISOString(),
      footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
    });
  } catch (err) {
    console.error('[Discord] Failed to send link notification:', err);
  }
}

/**
 * Notify #plan-infos when a free trial is activated via Discord link.
 */
async function notifyFreeTrialActivated(
  userEmail: string,
  discordId: string,
): Promise<void> {
  const channelId = DISCORD_CHANNEL_PLANS || DISCORD_LINK_CHANNEL_ID;
  if (!channelId) return;

  try {
    await sendToChannel(channelId, {
      title: '🎁 Free Trial Activated',
      color: 0x10b981,
      fields: [
        { name: '📧 Email', value: userEmail, inline: true },
        { name: '🎮 Discord', value: `<@${discordId}>`, inline: true },
        { name: '⏱️ Duration', value: '3 days', inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
    });
  } catch (err) {
    console.error('[Discord] Failed to send free trial notification:', err);
  }
}

/**
 * Notify #discord-infos when a user unlinks their Discord account.
 */
async function notifyDiscordUnlink(
  userEmail: string,
  discordUsername: string | null,
  discordId: string | null,
  source: 'Extension' | 'Admin',
): Promise<void> {
  const channelId = DISCORD_CHANNEL_DISCORD || DISCORD_LINK_CHANNEL_ID;
  if (!channelId) return;

  try {
    const fields = [
      { name: '📧 Email', value: userEmail, inline: true },
    ];
    if (discordId) {
      fields.push({ name: '🎮 Discord', value: `<@${discordId}>`, inline: true });
    } else if (discordUsername) {
      fields.push({ name: '🎮 Discord', value: discordUsername, inline: true });
    }
    fields.push({ name: '📌 Source', value: source, inline: true });

    await sendToChannel(channelId, {
      title: '🔓 Discord Unlinked',
      color: 0x94a3b8,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
    });
  } catch (err) {
    console.error('[Discord] Failed to send unlink notification:', err);
  }
}

// =============================================================================
// Role Assignment on Link
// =============================================================================

const PLAN_ROLES: Record<string, string> = {
  free: '1476673977899286548',
  freetrial: '1476674000674623600',
  premium: '1476674055435452698',
  lifetime: '1476674087831998464',
  beta: '1476674108841525340',
};

const ELO_BRACKETS = [
  { maxElo: 799,      roleId: '1476674389540864145' },
  { maxElo: 999,      roleId: '1476674464920895601' },
  { maxElo: 1199,     roleId: '1476674513440735343' },
  { maxElo: 1399,     roleId: '1476674570873471077' },
  { maxElo: 1599,     roleId: '1476674628641488976' },
  { maxElo: 1799,     roleId: '1476674961299996847' },
  { maxElo: 1999,     roleId: '1476674691098869810' },
  { maxElo: Infinity, roleId: '1476674811416809566' },
];

async function assignDiscordRoles(discordId: string, userId: string, plan: string): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;

  try {
    // Fetch guild member
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
    );
    if (!memberRes.ok) return;

    const member = await memberRes.json();
    const currentRoles: string[] = member.roles || [];
    const allPlanRoleIds = Object.values(PLAN_ROLES);
    const allEloRoleIds = ELO_BRACKETS.map((b) => b.roleId);

    // --- Plan role ---
    const targetPlanRole = PLAN_ROLES[plan];
    const planRolesToRemove = currentRoles.filter((r) => allPlanRoleIds.includes(r) && r !== targetPlanRole);
    const planRolesToAdd = targetPlanRole && !currentRoles.includes(targetPlanRole) ? [targetPlanRole] : [];

    // --- ELO role ---
    // Get highest rating across all time controls and linked accounts
    const { data: accounts } = await supabase
      .from('linked_accounts')
      .select('rating_bullet, rating_blitz, rating_rapid')
      .eq('user_id', userId)
      .is('unlinked_at', null);

    let targetEloRole: string | null = null;
    if (accounts && accounts.length > 0) {
      const maxElo = Math.max(
        ...accounts.flatMap((a) => [a.rating_bullet ?? 0, a.rating_blitz ?? 0, a.rating_rapid ?? 0]),
      );
      if (maxElo > 0) {
        const bracket = ELO_BRACKETS.find((b) => maxElo <= b.maxElo);
        if (bracket) targetEloRole = bracket.roleId;
      }
    }

    const eloRolesToRemove = currentRoles.filter((r) => allEloRoleIds.includes(r) && r !== targetEloRole);
    const eloRolesToAdd = targetEloRole && !currentRoles.includes(targetEloRole) ? [targetEloRole] : [];

    // Apply changes
    const toRemove = [...planRolesToRemove, ...eloRolesToRemove];
    const toAdd = [...planRolesToAdd, ...eloRolesToAdd];

    for (const roleId of toRemove) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
      );
    }
    for (const roleId of toAdd) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
      );
    }

    if (toRemove.length > 0 || toAdd.length > 0) {
      console.log(`[Discord] Roles assigned for ${discordId}: +${toAdd.length} -${toRemove.length}`);
    }
  } catch (err) {
    console.error('[Discord] Role assignment error:', err);
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
