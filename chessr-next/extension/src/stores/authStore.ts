/**
 * Auth Store (Zustand)
 * Manages authentication state with Supabase
 */

import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Plan } from '../components/ui/plan-badge';
import { useEngineStore } from './engineStore';

interface AuthState {
  // User state
  user: User | null;
  session: Session | null;
  plan: Plan;
  planExpiry: Date | null;
  initializing: boolean; // true only during initial auth check
  loading: boolean; // true during actions (login, signup, etc.)
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  resendConfirmationEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  plan: 'free',
  planExpiry: null,
  initializing: true,
  loading: false,
  error: null,

  initialize: async () => {
    try {
      // Small delay to ensure Chrome storage is ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if there's a session in storage first
      const storageKey = 'chessr-auth';
      const stored = await chrome.storage.local.get(storageKey);
      const hasStoredSession = !!stored[storageKey];

      // Listen for auth changes first (important for session restoration)
      supabase.auth.onAuthStateChange((event, session) => {
        // Only update user/session on actual sign in/out events, not during signup
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          set({
            session,
            user: session?.user ?? null,
          });
        }
      });

      // Get current session
      let { data: { session }, error } = await supabase.auth.getSession();

      // If no session but we have stored data, try to manually restore
      if (!session && hasStoredSession && !error) {
        try {
          const storedData = JSON.parse(stored[storageKey]);
          if (storedData?.access_token && storedData?.refresh_token) {
            const { data, error: setError } = await supabase.auth.setSession({
              access_token: storedData.access_token,
              refresh_token: storedData.refresh_token,
            });
            if (!setError && data.session) {
              session = data.session;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (error) throw error;

      set({
        session,
        user: session?.user ?? null,
      });

      // Fetch plan status if user is logged in, then set initializing to false
      if (session?.user) {
        await get().fetchPlan(session.user.id);
      }

      set({ initializing: false });

    } catch {
      set({ initializing: false, error: 'Failed to initialize auth' });
    }
  },

  fetchPlan: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('plan, plan_expiry')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('[Auth] fetchPlan error:', error);
        set({ plan: 'free', planExpiry: null });
        useEngineStore.getState().enforcePlanLimits('free');
        return;
      }

      const plan = data?.plan ?? 'free';
      set({
        plan,
        planExpiry: data?.plan_expiry ? new Date(data.plan_expiry) : null,
      });

      // Enforce plan limits on engine settings
      useEngineStore.getState().enforcePlanLimits(plan);
    } catch (e) {
      console.error('[Auth] fetchPlan error:', e);
      set({ plan: 'free', planExpiry: null });
      useEngineStore.getState().enforcePlanLimits('free');
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: 'https://chessr.io/email-confirmed',
        },
      });

      if (error) throw error;

      // Don't set user/session - wait for email confirmation
      set({ loading: false });

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign up failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signIn: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      set({
        user: data.user,
        session: data.session,
        loading: false,
      });

      // Fetch plan status
      get().fetchPlan(data.user.id);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signOut: async () => {
    set({ loading: true });

    try {
      await supabase.auth.signOut();
      set({
        user: null,
        session: null,
        plan: 'free',
        planExpiry: null,
        loading: false,
      });
      // Enforce free limits after sign out
      useEngineStore.getState().enforcePlanLimits('free');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sign out failed';
      set({ loading: false, error: message });
    }
  },

  resetPassword: async (email) => {
    set({ loading: true, error: null });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://chessr.io/reset-password',
      });

      if (error) throw error;

      set({ loading: false });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Password reset failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    set({ loading: true, error: null });

    try {
      const { user } = useAuthStore.getState();
      if (!user?.email) throw new Error('No user logged in');

      // Re-authenticate with old password to verify it
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword,
      });

      if (signInError) throw new Error('Current password is incorrect');

      // Update to new password
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      set({ loading: false });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Password change failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  resendConfirmationEmail: async (email) => {
    set({ loading: true, error: null });

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });

      if (error) throw error;

      set({ loading: false });
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to resend email';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  clearError: () => set({ error: null }),
}));
