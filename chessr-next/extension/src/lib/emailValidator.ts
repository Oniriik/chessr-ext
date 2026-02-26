/**
 * Email Validator
 * Checks if an email uses a disposable/temporary email domain
 * Uses UserCheck API (https://www.usercheck.com/docs/api)
 */

const USERCHECK_API_KEY = 'prd_wAyzZvqbPGE3qb57kZnuHAeDJZdv';

/**
 * Synchronous check — always returns false (no local list anymore).
 * Kept for backward compatibility with login flow.
 */
export function isDisposableEmail(_email: string): boolean {
  return false;
}

/**
 * Async check using UserCheck API (used for signup)
 * Returns true if the email is disposable, a relay, or spam
 */
export async function isDisposableEmailAsync(email: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.usercheck.com/email/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${USERCHECK_API_KEY}` } },
    );

    if (response.status === 429) {
      console.warn('[EmailValidator] UserCheck rate limited, allowing email');
      return false;
    }

    if (!response.ok) {
      console.warn('[EmailValidator] UserCheck error', response.status);
      return false;
    }

    const data = await response.json();

    return data.disposable === true || data.spam === true;
  } catch (error) {
    console.warn('[EmailValidator] UserCheck failed:', error);
    return false;
  }
}

export const DISPOSABLE_EMAIL_ERROR =
  'Disposable email addresses are not allowed. Please use a permanent email address.';
