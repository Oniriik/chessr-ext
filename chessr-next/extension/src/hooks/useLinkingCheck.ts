/**
 * useLinkingCheck - Hook to check if user needs to link their platform account
 */

import { useEffect, useRef } from 'react';
import { useLinkedAccountsStore, useNeedsLinking, usePendingProfile, useAccountsFetched } from '../stores/linkedAccountsStore';
import { useAuthStore } from '../stores/authStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { webSocketManager } from '../lib/webSocket';
import { detectPlatform } from '../platforms';
import { getRealHref } from '../content/anonymousBlur';
import { getChessComUsername } from '../lib/chesscom/username';
import { getLichessUsername } from '../lib/lichess/username';
import { getWorldChessUsername } from '../lib/worldchess/username';
import { fetchPlatformProfile, type Platform } from '../lib/platformApi';
import { logger } from '../lib/logger';

/**
 * Detects the current platform and username
 */
function detectCurrentPlatformUser(): { platform: Platform; username: string } | null {
  const url = new URL(getRealHref());
  const platformInfo = detectPlatform(url);

  if (!platformInfo) {
    return null;
  }

  const platformId = platformInfo.id as Platform;

  let username: string | null = null;

  if (platformId === 'chesscom') {
    username = getChessComUsername();
  } else if (platformId === 'lichess') {
    username = getLichessUsername();
  } else if (platformId === 'worldchess') {
    username = getWorldChessUsername();
  }

  if (!username) {
    return null;
  }

  return { platform: platformId, username };
}

/**
 * Hook that manages the linking check flow
 */
// Check if plan is premium (no linking required, no cooldown)
function isPremiumPlan(plan: string): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta';
}

export function useLinkingCheck() {
  const { user, plan } = useAuthStore();
  const { isConnected } = useWebSocketStore();
  const needsLinking = useNeedsLinking();
  const pendingProfile = usePendingProfile();
  const accountsFetched = useAccountsFetched();
  const {
    accounts,
    setLoading,
    setPendingProfile,
    setNeedsLinking,
    setCooldownHours,
    reset: resetLinkedAccountsStore,
  } = useLinkedAccountsStore();

  const hasFetchedRef = useRef(false);
  const hasCheckedLinkingRef = useRef(false);
  const prevAccountsLengthRef = useRef(accounts.length);

  // Reset check flag when accounts change (link or unlink happened)
  useEffect(() => {
    if (accounts.length !== prevAccountsLengthRef.current) {
      hasCheckedLinkingRef.current = false;
    }
    prevAccountsLengthRef.current = accounts.length;
  }, [accounts.length]);

  // Fetch linked accounts when connected
  useEffect(() => {
    if (!user || !isConnected) {
      hasFetchedRef.current = false;
      hasCheckedLinkingRef.current = false;
      // Reset store state when user logs out or disconnects
      resetLinkedAccountsStore();
      return;
    }

    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setLoading(true);
    webSocketManager.send({ type: 'get_linked_accounts' });
  }, [user, isConnected, setLoading, resetLinkedAccountsStore]);

  // Check if linking is needed after accounts are fetched
  useEffect(() => {
    if (!user || !isConnected || hasCheckedLinkingRef.current) return;
    if (!accountsFetched) return;

    // Detect current platform user
    const platformUser = detectCurrentPlatformUser();
    if (!platformUser) {
      if (accounts.length === 0) setNeedsLinking(true);
      return;
    }

    // Check if THIS SPECIFIC platform/username is linked
    const currentPlatformLinked = accounts.find(
      (a) => a.platform === platformUser.platform && a.platformUsername.toLowerCase() === platformUser.username.toLowerCase()
    );

    if (currentPlatformLinked) {
      setNeedsLinking(false);
      return;
    }

    // Current platform not linked - needs linking
    hasCheckedLinkingRef.current = true;
    setNeedsLinking(true);
    fetchAndShowProfile(platformUser.platform, platformUser.username);
  }, [user, isConnected, accounts, accountsFetched, plan, setNeedsLinking]);

  // Function to fetch profile and show modal
  const fetchAndShowProfile = async (platform: Platform, username: string) => {
    setLoading(true);

    try {
      const profile = await fetchPlatformProfile(platform, username);
      if (profile) {
        setPendingProfile(profile);

        // Check cooldown status for this account (only for non-premium users)
        // Premium users don't have cooldowns
        if (!isPremiumPlan(plan)) {
          webSocketManager.send({
            type: 'check_cooldown',
            platform,
            username,
          });
          // Note: setLoading(false) will be called when cooldown_status response arrives
          return;
        }
        // Premium users: ensure cooldown is cleared (no cooldown for them)
        setCooldownHours(null);
        setLoading(false);
        return;
      } else {
        logger.error('Failed to fetch profile');
      }
    } catch (error) {
      logger.error('Error fetching profile:', error);
    }
    setLoading(false);
  };

  // Re-detect and show modal when needsLinking becomes true after unlink
  useEffect(() => {
    // Only trigger if needsLinking is true but no pendingProfile (e.g., after unlink)
    if (!needsLinking || pendingProfile) return;
    if (!user || !isConnected) return;

    // Detect current platform user
    const platformUser = detectCurrentPlatformUser();
    if (!platformUser) return;

    // Verify the current platform is actually not linked
    const currentPlatformLinked = accounts.find(
      (a) => a.platform === platformUser.platform && a.platformUsername.toLowerCase() === platformUser.username.toLowerCase()
    );

    if (currentPlatformLinked) {
      // Current platform is still linked, no need to show modal
      setNeedsLinking(false);
      return;
    }

    fetchAndShowProfile(platformUser.platform, platformUser.username);
  }, [needsLinking, pendingProfile, user, isConnected, accounts, setNeedsLinking]);

  // Return whether we should show the link modal
  const shouldShowLinkModal = needsLinking && pendingProfile !== null;

  return {
    shouldShowLinkModal,
    needsLinking,
  };
}
