/**
 * Linked Accounts Store (Zustand)
 * Manages linked Chess.com/Lichess accounts state
 */

import { create } from 'zustand';
import type { Platform, PlatformProfile } from '../lib/platformApi';

export interface LinkedAccount {
  id: string;
  platform: Platform;
  platformUsername: string;
  avatarUrl?: string;
  ratingBullet?: number;
  ratingBlitz?: number;
  ratingRapid?: number;
  linkedAt: string;
}

export type LinkErrorCode = 'ALREADY_LINKED' | 'COOLDOWN' | 'LIMIT_REACHED' | 'UNKNOWN';

interface LinkError {
  message: string;
  code: LinkErrorCode;
  hoursRemaining?: number;
}

interface LinkedAccountsState {
  // State
  accounts: LinkedAccount[];
  accountsFetched: boolean; // True once accounts have been fetched from server
  isLoading: boolean;
  needsLinking: boolean;
  linkError: LinkError | null;

  // Profile being linked (for modal display)
  pendingProfile: PlatformProfile | null;

  // Cooldown state (hours remaining, null if no cooldown)
  cooldownHours: number | null;

  // Actions
  setAccounts: (accounts: LinkedAccount[]) => void;
  addAccount: (account: LinkedAccount) => void;
  removeAccount: (id: string) => void;
  setNeedsLinking: (needs: boolean) => void;
  setLoading: (loading: boolean) => void;
  setLinkError: (error: LinkError | null) => void;
  setPendingProfile: (profile: PlatformProfile | null) => void;
  setCooldownHours: (hours: number | null) => void;
  reset: () => void;

  // Computed helpers
  hasLinkedAccount: (platform: Platform) => boolean;
  getLinkedAccount: (platform: Platform) => LinkedAccount | undefined;
}

const initialState = {
  accounts: [] as LinkedAccount[],
  accountsFetched: false,
  isLoading: false,
  needsLinking: false,
  linkError: null,
  pendingProfile: null,
  cooldownHours: null,
};

export const useLinkedAccountsStore = create<LinkedAccountsState>((set, get) => ({
  ...initialState,

  setAccounts: (accounts) => {
    set({ accounts, accountsFetched: true });
  },

  addAccount: (account) => {
    set((state) => ({
      accounts: [...state.accounts, account],
      needsLinking: false,
      linkError: null,
    }));
  },

  removeAccount: (id) => {
    set((state) => ({
      accounts: state.accounts.filter((a) => a.id !== id),
    }));
  },

  setNeedsLinking: (needs) => {
    set({ needsLinking: needs });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setLinkError: (error) => {
    set({ linkError: error });
  },

  setPendingProfile: (profile) => {
    set({ pendingProfile: profile });
  },

  setCooldownHours: (hours) => {
    set({ cooldownHours: hours });
  },

  reset: () => {
    set(initialState);
  },

  hasLinkedAccount: (platform) => {
    return get().accounts.some((a) => a.platform === platform);
  },

  getLinkedAccount: (platform) => {
    return get().accounts.find((a) => a.platform === platform);
  },
}));

// Selector hooks for convenience
export const useLinkedAccounts = () => useLinkedAccountsStore((state) => state.accounts);
export const useAccountsFetched = () => useLinkedAccountsStore((state) => state.accountsFetched);
export const useNeedsLinking = () => useLinkedAccountsStore((state) => state.needsLinking);
export const useLinkError = () => useLinkedAccountsStore((state) => state.linkError);
export const usePendingProfile = () => useLinkedAccountsStore((state) => state.pendingProfile);
export const useIsLinkingLoading = () => useLinkedAccountsStore((state) => state.isLoading);
export const useCooldownHours = () => useLinkedAccountsStore((state) => state.cooldownHours);
