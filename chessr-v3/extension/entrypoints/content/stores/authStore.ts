import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SERVER_URL } from '../lib/config';
import { DISPOSABLE_EMAIL_ERROR } from '../lib/emailValidator';
import { getFingerprint } from '../lib/fingerprint';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'unlocker' | 'free';

interface AuthState {
  user: User | null;
  session: Session | null;
  plan: Plan;
  planExpiry: Date | null;
  /** Stamped by the server when the free trial expired; the extension
   *  shows the one-shot "trial ended" modal then acks it (server nulls
   *  the column). Null = nothing pending. */
  freetrialEndedAt: Date | null;
  /** Stamp written (one-shot) when the user accepts the onboarding
   *  "how to stay undetected" guidelines modal. Null = never accepted →
   *  the modal shows once. Lives in the DB (not local storage) so it
   *  survives reinstalls and fresh Chrome profiles. */
  guidelinesAcceptedAt: Date | null;
  /** Whether the 3-day free trial has ever been claimed for this user.
   *  Drives the "claim your free trial" CTA in the system-message
   *  widget — we hide it once burned, even if the user is back to
   *  plan='free' after the trial expired. */
  freetrialUsed: boolean;
  planLoading: boolean;
  initializing: boolean;
  loading: boolean;
  error: string | null;
  /** Set when a sign-in attempt is rejected because the account is
   *  banned (post-Supabase auth check). The form renders a dedicated
   *  ban screen with a Discord appeal link when this is non-null. */
  bannedReason: string | null;
  /** Help / appeal URL displayed alongside auth errors. Used both by
   *  the dedicated ban screen and as a "Need help?" button next to
   *  inline errors (e.g. duplicate-account on signup). */
  appealUrl: string | null;

  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ success: boolean; error?: string; alreadyRegistered?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string; banned?: boolean; emailNotConfirmed?: boolean }>;
  resendConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>;
  /** Clear the ban screen so the form goes back to its normal state. */
  clearBanned: () => void;
  signOut: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  plan: 'free',
  planExpiry: null,
  freetrialEndedAt: null,
  guidelinesAcceptedAt: null,
  freetrialUsed: false,
  planLoading: true,
  initializing: true,
  loading: false,
  error: null,
  bannedReason: null,
  appealUrl: null,

  clearBanned: () => set({ bannedReason: null, appealUrl: null, error: null }),

  initialize: async () => {
    try {
      await new Promise((r) => setTimeout(r, 100));

      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null });
      });

      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;

      if (!session) {
        const stored = await chrome.storage.local.get('chessr-auth');
        const value = stored['chessr-auth'];
        if (value) {
          try {
            const parsed = JSON.parse(value);
            if (parsed?.access_token && parsed?.refresh_token) {
              const { data } = await supabase.auth.setSession({
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token,
              });
              if (data.session) {
                await get().fetchPlan(data.session.user.id);
                set({ session: data.session, user: data.session.user, initializing: false });
                return;
              }
            }
          } catch {}
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
        .select('plan, plan_expiry, freetrial_used, freetrial_ended_at, guidelines_accepted_at')
        .eq('user_id', userId)
        .single();

      if (error) {
        set({ plan: 'free', planExpiry: null, freetrialEndedAt: null, freetrialUsed: false, planLoading: false });
        return;
      }

      const rawPlan = (data?.plan ?? 'free') as Plan;
      const rawExpiry = data?.plan_expiry ? new Date(data.plan_expiry) : null;
      // A freetrial past its expiry is effectively free — the server
      // sweeper can lag up to 15 min behind; don't resurrect premium UI
      // in that window (App's expiry watcher already downgraded locally).
      const effectivePlan: Plan =
        rawPlan === 'freetrial' && rawExpiry && rawExpiry.getTime() <= Date.now() ? 'free' : rawPlan;
      set({
        plan: effectivePlan,
        planExpiry: effectivePlan === rawPlan ? rawExpiry : null,
        freetrialEndedAt: (data as any)?.freetrial_ended_at ? new Date((data as any).freetrial_ended_at) : null,
        guidelinesAcceptedAt: (data as any)?.guidelines_accepted_at ? new Date((data as any).guidelines_accepted_at) : null,
        freetrialUsed: !!data?.freetrial_used,
        planLoading: false,
      });
    } catch {
      set({ plan: 'free', planExpiry: null, freetrialEndedAt: null, freetrialUsed: false, planLoading: false });
    }
  },

  signUp: async (email, password) => {
    set({ loading: true, error: null, bannedReason: null, appealUrl: null });

    // Pre-flight: serveur runs disposable check + multi-account abuse
    // check (fingerprint + IP) in one call. If a banned linked account
    // is found, response carries banReason + appealUrl → render the
    // ban screen. Fail-open on serveur unreachable.
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

    // 3) Create the account.
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: 'https://chessr.io/email-confirmed' },
      });
      if (error) throw error;

      // Supabase anti-enumeration: signUp on an ALREADY-REGISTERED email
      // does not error — it returns a fake success whose user carries an
      // empty identities array (and no confirmation email is sent). Left
      // undetected, we'd show "check your inbox" for an email that will
      // never arrive. Surface it so the form can route to sign-in /
      // password-reset instead.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        set({ loading: false });
        return { success: false, alreadyRegistered: true };
      }

      // 4) Persist fingerprint + signup IP for the new user_id so the
      //    next abuse check has a footprint to match against. Best-
      //    effort, fire-and-forget.
      if (data.user?.id) {
        fetch(`${SERVER_URL}/report-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: data.user.id, email, fingerprint, kind: 'signup' }),
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
    set({ loading: true, error: null, bannedReason: null, appealUrl: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Ban check — supabase auth has no concept of bans, we keep the
      // flag in user_settings. Sign the user back out immediately if
      // banned so no Bearer token leaks into the rest of the app.
      const { data: settings } = await supabase
        .from('user_settings')
        .select('banned, ban_reason')
        .eq('user_id', data.user.id)
        .single();
      if (settings?.banned) {
        const reason = settings.ban_reason || 'This account is banned.';
        const bannedUserId = data.user.id;
        await supabase.auth.signOut();
        // Fire-and-forget admin notif + login_blocked event. We send
        // userId so the audit row is keyed to the banned account, and
        // fingerprint so the dashboard can correlate with signup_ips.
        const fingerprintForBan = await getFingerprint().catch(() => null);
        fetch(`${SERVER_URL}/report-banned-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: bannedUserId,
            email,
            banReason: reason,
            fingerprint: fingerprintForBan,
          }),
        }).catch(() => {});
        set({
          loading: false,
          bannedReason: reason,
          appealUrl: 'https://discord.gg/72j4dUadTu',
          error: reason,
          user: null,
          session: null,
        });
        return { success: false, banned: true, error: reason };
      }

      await get().fetchPlan(data.user.id);
      // Email is necessarily confirmed at this point — drop the pending-
      // confirmation marker so the AuthForm never resurrects that screen.
      browser.storage.local.remove('chessr-pending-confirm-email').catch(() => {});
      // Explicit form login — clear the per-tab login-trigger flag so
      // the system-message widget can re-evaluate the cascade and show
      // a fresh nudge (claim trial / join discord / how-to). Page
      // reloads + session restores DON'T pass through here, so they
      // keep the gate intact (intentional).
      try {
        sessionStorage.removeItem(`chessr:login-trigger-fired:${data.user.id}`);
      } catch { /* sessionStorage blocked — fine */ }

      // Refresh the abuse footprint — login from a new device / IP /
      // browser profile registers a new row in user_fingerprints +
      // signup_ips so future checks see the broader trail. Upsert is
      // idempotent so re-logging from the same machine is a no-op.
      const fingerprint = await getFingerprint().catch(() => null);
      fetch(`${SERVER_URL}/report-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.user.id, email, fingerprint, kind: 'login' }),
      }).catch(() => {});

      set({ user: data.user, session: data.session, loading: false });
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Sign in failed';
      // Unconfirmed email is not a credentials problem — route the form
      // to the pending-confirmation screen (with resend) instead of the
      // cryptic raw error that sends users into a re-signup loop.
      const code = (e as { code?: string })?.code;
      if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
        set({ loading: false, error: null });
        return { success: false, emailNotConfirmed: true };
      }
      set({ loading: false, error: message });
      return { success: false, error: message };
    }
  },

  signOut: async () => {
    set({ loading: true });
    try {
      await supabase.auth.signOut();
      set({ user: null, session: null, plan: 'free', planExpiry: null, freetrialEndedAt: null, guidelinesAcceptedAt: null, freetrialUsed: false, loading: false });
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

  resendConfirmation: async (email) => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: 'https://chessr.io/email-confirmed' },
      });
      if (error) throw error;
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Resend failed' };
    }
  },

  resetPassword: async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://chessr.io/reset-password',
      });
      if (error) throw error;
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Password reset failed';
      return { success: false, error: message };
    }
  },

  clearError: () => set({ error: null, appealUrl: null }),
}));
