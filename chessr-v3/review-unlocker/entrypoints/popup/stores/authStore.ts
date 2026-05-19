import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SERVER_URL } from '../lib/config';
import { getFingerprint } from '../lib/fingerprint';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'unlocker' | 'free';

// Kept inline (not imported from the main extension) so the unlocker
// stays self-contained — no cross-package import boundary to cross.
const DISPOSABLE_EMAIL_ERROR =
  'Disposable email addresses are not allowed. Please use a permanent email address.';

interface AuthState {
  user: User | null;
  session: Session | null;
  plan: Plan;
  initializing: boolean;
  loading: boolean;
  error: string | null;
  bannedReason: string | null;
  appealUrl: string | null;

  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
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
  bannedReason: null,
  appealUrl: null,

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
    set({ loading: true, error: null, bannedReason: null, appealUrl: null });

    // Pre-flight: serveur runs disposable check + multi-account abuse
    // check (fingerprint + IP) in one call. Mirrors the main extension's
    // signup flow so unlocker accounts populate `user_fingerprints` and
    // get blocked when they collide with a banned linked account.
    // Fail-open on serveur unreachable — same policy as the main ext.
    const fingerprint = await getFingerprint();
    try {
      const checkRes = await fetch(`${SERVER_URL}/check-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint, email }),
      });
      if (checkRes.ok) {
        const payload = await checkRes.json() as {
          allowed: boolean;
          reason?: string;
          banReason?: string;
          appealUrl?: string;
          message?: string;
        };
        if (!payload.allowed) {
          if (payload.reason === 'banned') {
            const reason = payload.banReason || 'This account is banned.';
            set({
              loading: false,
              bannedReason: reason,
              appealUrl: payload.appealUrl ?? null,
              error: reason,
            });
            return { success: false, error: reason };
          }
          const msg = payload.message ||
            (payload.reason === 'disposable' ? DISPOSABLE_EMAIL_ERROR : 'Sign up not allowed.');
          set({ loading: false, error: msg, appealUrl: payload.appealUrl ?? null });
          return { success: false, error: msg };
        }
      }
    } catch { /* serveur unreachable → fail-open */ }

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

      // Persist fingerprint + signup IP for the new user_id so the next
      // abuse check has a footprint to match against, and tag the user
      // with signup_source='unlocker' on user_settings so the Discord
      // #users channel shows "via 🔓 Review Unlocker".
      //
      // AWAITED (unlike the main extension's fire-and-forget): a popup
      // closes the moment the user clicks outside (e.g. to go check
      // their inbox), which aborts in-flight fetches. Without the
      // await, /report-signup gets cancelled mid-request — Discord
      // notifs go missing AND the user_fingerprints row never lands,
      // breaking detection for any follow-up multi-account signup.
      // 4s timeout caps the worst-case UX delay on serveur trouble.
      if (data.user?.id) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          await fetch(`${SERVER_URL}/report-signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: data.user.id,
              email,
              fingerprint,
              source: 'unlocker',
              kind: 'signup',
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
        } catch { /* serveur down / timeout — proceed anyway */ }
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

  resetPassword: async (email) => {
    set({ loading: true, error: null });
    try {
      // Supabase sends an email with a recovery token. The link lands on
      // chessr.io/reset-password (existing landing page) where the user
      // picks a new password via supabase.auth.updateUser. The unlocker
      // popup can't host the form itself — it closes on tab change.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://chessr.io/reset-password',
      });
      if (error) throw error;
      set({ loading: false });
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Reset password failed';
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, plan: 'free', bannedReason: null, appealUrl: null });
  },

  clearError: () => set({ error: null, bannedReason: null, appealUrl: null }),
}));
