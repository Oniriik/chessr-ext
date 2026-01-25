/**
 * Presentation: Auth Store (Zustand)
 */

import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../../infrastructure/supabase/client';

interface AuthState {
  // User state
  user: User | null;
  session: Session | null;
  initializing: boolean; // true only during initial auth check
  loading: boolean; // true during actions (login, signup, etc.)
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  resendConfirmationEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
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
        initializing: false,
      });

    } catch {
      set({ initializing: false, error: 'Failed to initialize auth' });
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      // Don't set user/session - wait for email confirmation
      set({ loading: false });

      return { success: true };
    } catch (error: any) {
      const message = error.message || 'Sign up failed';
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

      return { success: true };
    } catch (error: any) {
      const message = error.message || 'Sign in failed';
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
        loading: false,
      });
    } catch (error: any) {
      set({ loading: false, error: error.message });
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
    } catch (error: any) {
      const message = error.message || 'Password reset failed';
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
    } catch (error: any) {
      const message = error.message || 'Failed to resend email';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  clearError: () => set({ error: null }),
}));
