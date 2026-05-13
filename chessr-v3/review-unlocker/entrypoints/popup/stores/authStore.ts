import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SERVER_URL } from '../lib/config';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'unlocker' | 'free';

interface AuthState {
  user: User | null;
  session: Session | null;
  plan: Plan;
  initializing: boolean;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  plan: 'free',
  initializing: true,
  loading: false,
  error: null,

  initialize: async () => {
    try {
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null });
        if (session?.user) get().fetchPlan(session.user.id);
      });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await get().fetchPlan(session.user.id);
      set({ session, user: session?.user ?? null, initializing: false });
    } catch {
      set({ initializing: false, error: 'Failed to initialize auth' });
    }
  },

  fetchPlan: async (userId) => {
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('plan')
        .eq('user_id', userId)
        .single();
      set({ plan: (data?.plan ?? 'free') as Plan });
    } catch {
      set({ plan: 'free' });
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: 'https://chessr.io/email-confirmed',
          // Redundant tag in auth.users.raw_user_meta_data so the source
          // survives even if the /report-signup call below fails (e.g.
          // serveur unreachable). The DB column on user_settings is the
          // primary source of truth for analytics queries.
          data: { signup_source: 'unlocker' },
        },
      });
      if (error) throw error;

      // Best-effort: tag the user with signup_source='unlocker' on
      // user_settings + emit signup_success with source so the Discord
      // #users channel shows "via 🔓 Review Unlocker". Fire-and-forget;
      // we don't want a serveur outage to break sign-up.
      if (data.user?.id) {
        fetch(`${SERVER_URL}/report-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: data.user.id,
            email,
            source: 'unlocker',
            kind: 'signup',
          }),
        }).catch(() => {});
      }

      set({ loading: false });
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Sign up failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signIn: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      set({ loading: false });
      return { success: true };
    } catch (e: unknown) {
      // Supabase returns the generic "Invalid login credentials" for BOTH
      // wrong password and unverified email (anti-enumeration). Surface a
      // hint about verification so freshly-signed-up users don't think the
      // creds are wrong. The explicit "Email not confirmed" string is what
      // you get when the project's anti-enumeration setting is off.
      const raw = e instanceof Error ? e.message : 'Sign in failed';
      let message = raw;
      const lower = raw.toLowerCase();
      if (lower.includes('invalid login') || lower.includes('email not confirmed') || lower.includes('not confirmed')) {
        message = 'Verify your email first — check your inbox (and spam folder). If you already did, your password may be wrong.';
      }
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, plan: 'free' });
  },

  clearError: () => set({ error: null }),
}));
