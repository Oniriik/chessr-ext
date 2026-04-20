import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { SERVER_URL } from '../lib/config';
import type { PlatformProfile } from '../lib/platformApi';

export interface LinkedAccount {
  id: string;
  platform: 'chesscom' | 'lichess' | 'worldchess';
  username: string;
  avatar?: string | null;
}

interface LinkedAccountsState {
  accounts: LinkedAccount[];
  loading: boolean;
  needsLinking: boolean;
  pendingProfile: PlatformProfile | null;

  fetchAccounts: (userId: string) => Promise<void>;
  linkAccount: (userId: string, profile: PlatformProfile) => Promise<{ success: boolean; error?: string }>;
  unlinkAccount: (accountId: string, userId: string) => Promise<void>;
  setNeedsLinking: (needs: boolean, profile?: PlatformProfile | null) => void;
}

export const useLinkedAccountsStore = create<LinkedAccountsState>((set) => ({
  accounts: [],
  loading: true,
  needsLinking: false,
  pendingProfile: null,

  fetchAccounts: async (userId) => {
    set({ loading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        set({ loading: false });
        return;
      }

      const { data } = await supabase
        .from('linked_accounts')
        .select('id, platform, platform_username, avatar_url')
        .eq('user_id', userId)
        .is('unlinked_at', null);

      const accounts: LinkedAccount[] = (data || []).map((row: any) => ({
        id: row.id,
        platform: row.platform,
        username: row.platform_username,
        avatar: row.avatar_url,
      }));

      set({ accounts, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  linkAccount: async (userId, profile) => {
    try {
      const res = await fetch(`${SERVER_URL}/accounts/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          platform: profile.platform,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
          ratingBullet: profile.ratings.bullet,
          ratingBlitz: profile.ratings.blitz,
          ratingRapid: profile.ratings.rapid,
        }),
      });

      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error };

      set((state) => ({
        accounts: [...state.accounts, {
          id: data.account.id,
          platform: data.account.platform,
          username: data.account.platform_username,
          avatar: data.account.avatar_url,
        }],
        needsLinking: false,
        pendingProfile: null,
      }));

      return { success: true };
    } catch {
      return { success: false, error: 'Failed to link' };
    }
  },

  unlinkAccount: async (accountId, userId) => {
    try {
      const res = await fetch(`${SERVER_URL}/accounts/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, accountId }),
      });
      if (!res.ok) return;

      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== accountId),
      }));
    } catch {}
  },

  setNeedsLinking: (needs, profile = null) => {
    set({ needsLinking: needs, pendingProfile: profile });
  },
}));
