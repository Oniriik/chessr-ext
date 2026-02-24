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

// =============================================================================
// Message Types
// =============================================================================

export interface GetLinkedAccountsMessage {
  type: 'get_linked_accounts';
}

export interface LinkAccountMessage {
  type: 'link_account';
  platform: 'chesscom' | 'lichess';
  username: string;
  avatarUrl?: string;
  ratingBullet?: number;
  ratingBlitz?: number;
  ratingRapid?: number;
}

export interface UnlinkAccountMessage {
  type: 'unlink_account';
  accountId: string;
}

export interface CheckCooldownMessage {
  type: 'check_cooldown';
  platform: 'chesscom' | 'lichess';
  username: string;
}

// =============================================================================
// Response Types
// =============================================================================

interface LinkedAccount {
  id: string;
  platform: 'chesscom' | 'lichess';
  platformUsername: string;
  avatarUrl?: string;
  ratingBullet?: number;
  ratingBlitz?: number;
  ratingRapid?: number;
  linkedAt: string;
}

type LinkErrorCode = 'ALREADY_LINKED' | 'COOLDOWN' | 'LIMIT_REACHED' | 'UNKNOWN';

// =============================================================================
// Plan Helpers
// =============================================================================

type UserPlan = 'free' | 'freetrial' | 'premium' | 'lifetime' | 'beta';

interface UserPlanInfo {
  plan: UserPlan;
}

async function getUserPlan(userId: string): Promise<UserPlanInfo> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { plan: 'free' };
  }

  return { plan: data.plan || 'free' };
}

function isPremiumPlan(plan: UserPlan): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta';
}

// =============================================================================
// Validation Logic
// =============================================================================

interface CanLinkResult {
  ok: boolean;
  error?: string;
  code?: LinkErrorCode;
  hoursRemaining?: number;
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

  // 2. Get user plan
  const userPlanInfo = await getUserPlan(userId);
  const isPremium = isPremiumPlan(userPlanInfo.plan);

  // 3. Check cooldown (48h after unlink) - only for non-premium users
  if (!isPremium) {
    const { data: recentUnlink } = await supabase
      .from('linked_accounts')
      .select('unlinked_at')
      .eq('platform', platform)
      .eq('platform_username', username.toLowerCase())
      .not('unlinked_at', 'is', null)
      .order('unlinked_at', { ascending: false })
      .limit(1)
      .single();

    if (recentUnlink?.unlinked_at) {
      const unlinkedAt = new Date(recentUnlink.unlinked_at);
      const hoursSince = (Date.now() - unlinkedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSince < 48) {
        const hoursRemaining = Math.ceil(48 - hoursSince);
        return {
          ok: false,
          error: `This account was recently unlinked. Please wait ${hoursRemaining}h before linking again.`,
          code: 'COOLDOWN',
          hoursRemaining,
        };
      }
    }
  }

  // 4. Check linking limit (free/freetrial = 1, premium = unlimited)
  const { data: currentLinks } = await supabase
    .from('linked_accounts')
    .select('id')
    .eq('user_id', userId)
    .is('unlinked_at', null);

  const maxLinks = isPremium ? Infinity : 1;
  const currentCount = currentLinks?.length || 0;

  if (currentCount >= maxLinks) {
    return {
      ok: false,
      error: 'You have reached your account linking limit. Upgrade to Premium for unlimited links.',
      code: 'LIMIT_REACHED',
    };
  }

  return { ok: true };
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Handle get_linked_accounts request
 */
export async function handleGetLinkedAccounts(client: Client): Promise<void> {
  try {
    // Debug: First fetch ALL accounts for this user to see what's in the DB
    const { data: allAccounts } = await supabase
      .from('linked_accounts')
      .select('id, platform, platform_username, unlinked_at')
      .eq('user_id', client.user.id);

    console.log(`[AccountHandler] All accounts for user ${client.user.email}:`, JSON.stringify(allAccounts, null, 2));

    const { data, error } = await supabase
      .from('linked_accounts')
      .select('id, platform, platform_username, avatar_url, rating_bullet, rating_blitz, rating_rapid, linked_at')
      .eq('user_id', client.user.id)
      .is('unlinked_at', null)
      .order('linked_at', { ascending: false });

    console.log(`[AccountHandler] Filtered accounts (unlinked_at IS NULL):`, JSON.stringify(data, null, 2));

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
      avatarUrl: row.avatar_url,
      ratingBullet: row.rating_bullet,
      ratingBlitz: row.rating_blitz,
      ratingRapid: row.rating_rapid,
      linkedAt: row.linked_at,
    }));

    // Check if user needs linking (free/freetrial with no linked accounts)
    const userPlan = await getUserPlan(client.user.id);
    const needsLinking = !isPremiumPlan(userPlan.plan) && accounts.length === 0;

    console.log(`[AccountHandler] Sending ${accounts.length} accounts, plan=${userPlan.plan}, needsLinking=${needsLinking}`);

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
  const { platform, username, avatarUrl, ratingBullet, ratingBlitz, ratingRapid } = message;

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
  if (platform !== 'chesscom' && platform !== 'lichess') {
    client.ws.send(
      JSON.stringify({
        type: 'link_account_error',
        error: 'Invalid platform. Must be chesscom or lichess',
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
          hoursRemaining: canLink.hoursRemaining,
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
        avatar_url: avatarUrl,
        rating_bullet: ratingBullet,
        rating_blitz: ratingBlitz,
        rating_rapid: ratingRapid,
      })
      .select('id, platform, platform_username, avatar_url, rating_bullet, rating_blitz, rating_rapid, linked_at')
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

/**
 * Handle check_cooldown request
 * Checks if there's a cooldown preventing linking this account
 */
export async function handleCheckCooldown(
  message: CheckCooldownMessage,
  client: Client
): Promise<void> {
  const { platform, username } = message;

  if (!platform || !username) {
    client.ws.send(
      JSON.stringify({
        type: 'cooldown_status',
        hasCooldown: false,
      })
    );
    return;
  }

  try {
    // Get user plan
    const userPlanInfo = await getUserPlan(client.user.id);
    const isPremium = isPremiumPlan(userPlanInfo.plan);

    // Premium users don't have cooldown
    if (isPremium) {
      client.ws.send(
        JSON.stringify({
          type: 'cooldown_status',
          hasCooldown: false,
        })
      );
      return;
    }

    // Check if already linked to another user
    const { data: existing } = await supabase
      .from('linked_accounts')
      .select('user_id')
      .eq('platform', platform)
      .eq('platform_username', username.toLowerCase())
      .is('unlinked_at', null)
      .single();

    if (existing && existing.user_id !== client.user.id) {
      client.ws.send(
        JSON.stringify({
          type: 'cooldown_status',
          hasCooldown: false,
          isAlreadyLinked: true,
        })
      );
      return;
    }

    // Check cooldown (48h after unlink)
    const { data: recentUnlink } = await supabase
      .from('linked_accounts')
      .select('unlinked_at')
      .eq('platform', platform)
      .eq('platform_username', username.toLowerCase())
      .not('unlinked_at', 'is', null)
      .order('unlinked_at', { ascending: false })
      .limit(1)
      .single();

    if (recentUnlink?.unlinked_at) {
      const unlinkedAt = new Date(recentUnlink.unlinked_at);
      const hoursSince = (Date.now() - unlinkedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSince < 48) {
        const hoursRemaining = Math.ceil(48 - hoursSince);
        client.ws.send(
          JSON.stringify({
            type: 'cooldown_status',
            hasCooldown: true,
            hoursRemaining,
          })
        );
        return;
      }
    }

    client.ws.send(
      JSON.stringify({
        type: 'cooldown_status',
        hasCooldown: false,
      })
    );
  } catch (error) {
    console.error('[AccountHandler] Exception in handleCheckCooldown:', error);
    client.ws.send(
      JSON.stringify({
        type: 'cooldown_status',
        hasCooldown: false,
      })
    );
  }
}
