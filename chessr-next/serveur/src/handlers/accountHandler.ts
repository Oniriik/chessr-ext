/**
 * accountHandler - WebSocket message handler for linked accounts
 */

import type { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';

export interface Client {
  ws: WebSocket;
  user: {
    id: string;
    email: string;
  };
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ACCOUNTS = process.env.DISCORD_CHANNEL_ACCOUNTS || '1477491006609035395';

// =============================================================================
// Message Types
// =============================================================================

export interface GetLinkedAccountsMessage {
  type: 'get_linked_accounts';
}

export interface LinkAccountMessage {
  type: 'link_account';
  platform: 'chesscom' | 'lichess' | 'worldchess';
  username: string;
  displayName?: string;
  avatarUrl?: string;
  ratingBullet?: number;
  ratingBlitz?: number;
  ratingRapid?: number;
}

export interface UnlinkAccountMessage {
  type: 'unlink_account';
  accountId: string;
}

// =============================================================================
// Response Types
// =============================================================================

interface LinkedAccount {
  id: string;
  platform: 'chesscom' | 'lichess' | 'worldchess';
  platformUsername: string;
  displayName?: string;
  avatarUrl?: string;
  ratingBullet?: number;
  ratingBlitz?: number;
  ratingRapid?: number;
  linkedAt: string;
}

type LinkErrorCode = 'ALREADY_LINKED' | 'UNKNOWN';

// =============================================================================
// Validation Logic
// =============================================================================

interface CanLinkResult {
  ok: boolean;
  error?: string;
  code?: LinkErrorCode;
}

async function canLinkAccount(
  userId: string,
  platform: string,
  username: string
): Promise<CanLinkResult> {
  // 1. Check if already linked to another user
  const { data: existing } = await supabase
    .from('linked_accounts')
    .select('user_id')
    .eq('platform', platform)
    .eq('platform_username', username.toLowerCase())
    .is('unlinked_at', null)
    .single();

  if (existing && existing.user_id !== userId) {
    return {
      ok: false,
      error: 'This account is already linked to another Chessr account',
      code: 'ALREADY_LINKED',
    };
  }

  // If already linked to same user, it's fine
  if (existing && existing.user_id === userId) {
    return {
      ok: false,
      error: 'This account is already linked to your Chessr account',
      code: 'ALREADY_LINKED',
    };
  }

  return { ok: true };
}

// =============================================================================
// Discord Notifications
// =============================================================================

function buildProfileUrl(platform: string, username: string): string {
  if (platform === 'chesscom') return `https://www.chess.com/member/${username}`;
  if (platform === 'lichess') return `https://lichess.org/@/${username}`;
  return username;
}

async function notifyAccountChange(
  action: 'linked' | 'unlinked',
  userEmail: string,
  platform: string,
  username: string,
  userId: string,
  ratings?: { bullet?: number; blitz?: number; rapid?: number },
): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ACCOUNTS) return;

  try {
    const platformName = platform === 'chesscom' ? 'Chess.com' : platform === 'lichess' ? 'Lichess' : 'World Chess';
    const isLinked = action === 'linked';
    const profileUrl = buildProfileUrl(platform, username);
    const profileLink = `[${username}](${profileUrl})`;

    // Get Discord ID for mention
    const { data: settings } = await supabase
      .from('user_settings')
      .select('discord_id')
      .eq('user_id', userId)
      .single();

    const userDisplay = settings?.discord_id
      ? `<@${settings.discord_id}>`
      : userEmail;

    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: '👤 User', value: userDisplay, inline: true },
      { name: '🏰 Platform', value: `${platformName} — ${profileLink}`, inline: true },
    ];

    if (isLinked && ratings) {
      const parts: string[] = [];
      if (ratings.bullet) parts.push(`🎯 ${ratings.bullet}`);
      if (ratings.blitz) parts.push(`⚡ ${ratings.blitz}`);
      if (ratings.rapid) parts.push(`⏱️ ${ratings.rapid}`);
      if (parts.length > 0) {
        fields.push({ name: '📊 Ratings', value: parts.join('  ·  '), inline: false });
      }
    }

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ACCOUNTS}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: isLinked ? '🔗 Account Linked' : '🔓 Account Unlinked',
          color: isLinked ? 0x10b981 : 0x94a3b8,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      }),
    });
  } catch (err) {
    console.error(`[AccountHandler] Failed to send ${action} notification:`, err);
  }
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle get_linked_accounts request
 */
export async function handleGetLinkedAccounts(client: Client): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('linked_accounts')
      .select('id, platform, platform_username, display_name, avatar_url, rating_bullet, rating_blitz, rating_rapid, linked_at')
      .eq('user_id', client.user.id)
      .is('unlinked_at', null)
      .order('linked_at', { ascending: false });

    if (error) {
      console.error('[AccountHandler] Error fetching linked accounts:', error);
      client.ws.send(
        JSON.stringify({
          type: 'linked_accounts_error',
          error: 'Failed to fetch linked accounts',
        })
      );
      return;
    }

    const accounts: LinkedAccount[] = (data || []).map((row) => ({
      id: row.id,
      platform: row.platform,
      platformUsername: row.platform_username,
      displayName: row.display_name || undefined,
      avatarUrl: row.avatar_url,
      ratingBullet: row.rating_bullet,
      ratingBlitz: row.rating_blitz,
      ratingRapid: row.rating_rapid,
      linkedAt: row.linked_at,
    }));

    const needsLinking = accounts.length === 0;

    client.ws.send(
      JSON.stringify({
        type: 'linked_accounts',
        accounts,
        needsLinking,
      })
    );
  } catch (error) {
    console.error('[AccountHandler] Exception in handleGetLinkedAccounts:', error);
    client.ws.send(
      JSON.stringify({
        type: 'linked_accounts_error',
        error: 'Internal server error',
      })
    );
  }
}

/**
 * Handle link_account request
 */
export async function handleLinkAccount(
  message: LinkAccountMessage,
  client: Client
): Promise<void> {
  const { platform, username, displayName, avatarUrl, ratingBullet, ratingBlitz, ratingRapid } = message;

  // Validate required fields
  if (!platform || !username) {
    client.ws.send(
      JSON.stringify({
        type: 'link_account_error',
        error: 'Missing required fields: platform or username',
        code: 'UNKNOWN',
      })
    );
    return;
  }

  // Validate platform
  if (platform !== 'chesscom' && platform !== 'lichess' && platform !== 'worldchess') {
    client.ws.send(
      JSON.stringify({
        type: 'link_account_error',
        error: 'Invalid platform. Must be chesscom, lichess, or worldchess',
        code: 'UNKNOWN',
      })
    );
    return;
  }

  try {
    // Check if can link
    const canLink = await canLinkAccount(client.user.id, platform, username);

    if (!canLink.ok) {
      client.ws.send(
        JSON.stringify({
          type: 'link_account_error',
          error: canLink.error,
          code: canLink.code,
        })
      );
      return;
    }

    // Create the link
    const { data, error } = await supabase
      .from('linked_accounts')
      .insert({
        user_id: client.user.id,
        platform,
        platform_username: username.toLowerCase(),
        display_name: displayName || null,
        avatar_url: avatarUrl,
        rating_bullet: ratingBullet,
        rating_blitz: ratingBlitz,
        rating_rapid: ratingRapid,
      })
      .select('id, platform, platform_username, display_name, avatar_url, rating_bullet, rating_blitz, rating_rapid, linked_at')
      .single();

    if (error) {
      console.error('[AccountHandler] Error creating link:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        client.ws.send(
          JSON.stringify({
            type: 'link_account_error',
            error: 'This account is already linked',
            code: 'ALREADY_LINKED',
          })
        );
        return;
      }

      client.ws.send(
        JSON.stringify({
          type: 'link_account_error',
          error: 'Failed to link account',
          code: 'UNKNOWN',
        })
      );
      return;
    }

    const account: LinkedAccount = {
      id: data.id,
      platform: data.platform,
      platformUsername: data.platform_username,
      displayName: data.display_name || undefined,
      avatarUrl: data.avatar_url,
      ratingBullet: data.rating_bullet,
      ratingBlitz: data.rating_blitz,
      ratingRapid: data.rating_rapid,
      linkedAt: data.linked_at,
    };

    console.log(`[AccountHandler] User ${client.user.email} linked ${platform} account: ${username}`);

    client.ws.send(
      JSON.stringify({
        type: 'link_account_success',
        account,
      })
    );

    // Send Discord notification (non-blocking)
    notifyAccountChange('linked', client.user.email, platform, username, client.user.id, {
      bullet: ratingBullet,
      blitz: ratingBlitz,
      rapid: ratingRapid,
    }).catch(() => {});
  } catch (error) {
    console.error('[AccountHandler] Exception in handleLinkAccount:', error);
    client.ws.send(
      JSON.stringify({
        type: 'link_account_error',
        error: 'Internal server error',
        code: 'UNKNOWN',
      })
    );
  }
}

/**
 * Handle unlink_account request
 */
export async function handleUnlinkAccount(
  message: UnlinkAccountMessage,
  client: Client
): Promise<void> {
  const { accountId } = message;

  if (!accountId) {
    client.ws.send(
      JSON.stringify({
        type: 'unlink_account_error',
        error: 'Missing accountId',
      })
    );
    return;
  }

  try {
    // Verify the account belongs to this user and set unlinked_at
    const { data, error } = await supabase
      .from('linked_accounts')
      .update({ unlinked_at: new Date().toISOString() })
      .eq('id', accountId)
      .eq('user_id', client.user.id)
      .is('unlinked_at', null)
      .select('platform, platform_username')
      .single();

    if (error || !data) {
      console.error('[AccountHandler] Error unlinking account:', error);
      client.ws.send(
        JSON.stringify({
          type: 'unlink_account_error',
          error: 'Account not found or already unlinked',
        })
      );
      return;
    }

    console.log(`[AccountHandler] User ${client.user.email} unlinked ${data.platform} account: ${data.platform_username}`);

    client.ws.send(
      JSON.stringify({
        type: 'unlink_account_success',
        accountId,
      })
    );

    // Send Discord notification (non-blocking)
    notifyAccountChange('unlinked', client.user.email, data.platform, data.platform_username, client.user.id).catch(() => {});
  } catch (error) {
    console.error('[AccountHandler] Exception in handleUnlinkAccount:', error);
    client.ws.send(
      JSON.stringify({
        type: 'unlink_account_error',
        error: 'Internal server error',
      })
    );
  }
}

