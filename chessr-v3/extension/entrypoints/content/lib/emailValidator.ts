/**
 * Disposable email detection — UserCheck API.
 *
 * Run on signup before we even hand the email to Supabase. We allow
 * the signup if UserCheck is unreachable / rate-limits us / errors —
 * the goal is to filter throwaway addresses, not block real users on
 * a third-party hiccup.
 *
 * https://www.usercheck.com/docs/api
 */

const USERCHECK_API_KEY = 'prd_wAyzZvqbPGE3qb57kZnuHAeDJZdv';

export const DISPOSABLE_EMAIL_ERROR =
  'Disposable email addresses are not allowed. Please use a permanent email address.';

export async function isDisposableEmail(email: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.usercheck.com/email/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${USERCHECK_API_KEY}` } },
    );
    if (res.status === 429) {
      console.warn('[emailValidator] UserCheck rate limited — allowing email');
      return false;
    }
    if (!res.ok) {
      console.warn('[emailValidator] UserCheck error', res.status);
      return false;
    }
    const data = await res.json() as { disposable?: boolean; spam?: boolean };
    return data.disposable === true || data.spam === true;
  } catch (err) {
    console.warn('[emailValidator] UserCheck failed:', err);
    return false;
  }
}
