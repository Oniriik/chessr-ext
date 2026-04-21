import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'free';

interface AuthState {
  user: User | null;
  session: Session | null;
  plan: Plan;
  planExpiry: Date | null;
  planLoading: boolean;
  initializing: boolean;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  plan: 'free',
  planExpiry: null,
  planLoading: true,
  initializing: true,
  loading: false,
  error: null,

  initialize: async () => {
    try {
      await new Promise((r) => setTimeout(r, 100));

      supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Chessr][auth] onAuthStateChange', event, 'user=', session?.user?.id ?? null);
        set({ session, user: session?.user ?? null });
      });

      const { data: { session }, error } = await supabase.auth.getSession();
      console.log('[Chessr][auth] getSession →', { hasSession: !!session, userId: session?.user?.id ?? null, error: error?.message });
      if (error) throw error;

      if (!session) {
        const stored = await chrome.storage.local.get('chessr-auth');
        const value = stored['chessr-auth'];
        console.log('[Chessr][auth] fallback chrome.storage.local[chessr-auth] →', {
          present: !!value,
          type: typeof value,
        });
        if (value) {
          try {
            const parsed = JSON.parse(value);
            if (parsed?.access_token && parsed?.refresh_token) {
              const { data } = await supabase.auth.setSession({
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token,
              });
              if (data.session) {
                console.log('[Chessr][auth] fallback restored session for', data.session.user.id);
                await get().fetchPlan(data.session.user.id);
                set({ session: data.session, user: data.session.user, initializing: false });
                return;
              }
            }
          } catch (e) {
            console.log('[Chessr][auth] fallback JSON.parse failed', e);
          }
        }
      }

      if (session?.user) {
        await get().fetchPlan(session.user.id);
      }

      set({ session, user: session?.user ?? null, initializing: false });
    } catch {
      set({ initializing: false, error: 'Failed to initialize auth' });
    }
  },

  fetchPlan: async (userId) => {
    set({ planLoading: true });
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('plan, plan_expiry')
        .eq('user_id', userId)
        .single();

      if (error) {
        set({ plan: 'free', planExpiry: null, planLoading: false });
        return;
      }

      set({
        plan: (data?.plan ?? 'free') as Plan,
        planExpiry: data?.plan_expiry ? new Date(data.plan_expiry) : null,
        planLoading: false,
      });
    } catch {
      set({ plan: 'free', planExpiry: null, planLoading: false });
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: 'https://chessr.io/email-confirmed' },
      });
      if (error) throw error;
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
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await get().fetchPlan(data.user.id);
      set({ user: data.user, session: data.session, loading: false });
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Sign in failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signOut: async () => {
    set({ loading: true });
    try {
      await supabase.auth.signOut();
      set({ user: null, session: null, plan: 'free', planExpiry: null, loading: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Sign out failed';
      set({ loading: false, error: message });
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    try {
      const { user } = get();
      if (!user?.email) throw new Error('No user logged in');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword,
      });
      if (signInError) throw new Error('Current password is incorrect');

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Password change failed';
      return { success: false, error: message };
    }
  },

  clearError: () => set({ error: null }),
}));
