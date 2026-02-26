/**
 * Email Validator
 * Checks if an email uses a disposable/temporary email domain
 * Uses Abstract API + npm static list + custom blocklist
 */

import domains from 'disposable-email-domains';

const disposableDomains = new Set(domains);
const ABSTRACT_API_KEY = '6fe42580b93443d792a2ce3a5a34031a';

// Our custom blocklist for domains not in the public lists
const CUSTOM_BLOCKLIST = new Set([
  'seaswar.com',
]);

/**
 * Synchronous check using static list + custom blocklist (used for login)
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return disposableDomains.has(domain) || CUSTOM_BLOCKLIST.has(domain);
}

/**
 * Async check using Abstract API with fallback to static lists (used for signup)
 * If API is rate limited (429), ignores API response and relies on static + custom lists only
 */
export async function isDisposableEmailAsync(email: string): Promise<boolean> {
  // Check custom blocklist first (instant)
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain && CUSTOM_BLOCKLIST.has(domain)) {
    return true;
  }

  try {
    const response = await fetch(
      `https://emailreputation.abstractapi.com/v1/?api_key=${ABSTRACT_API_KEY}&email=${encodeURIComponent(email)}`
    );

    // If rate limited (429), ignore API and use static lists only
    if (response.status === 429) {
      console.warn('[EmailValidator] Abstract API rate limited, using static lists only');
      return isDisposableEmail(email);
    }

    // Other API errors, fallback to static list
    if (!response.ok) {
      console.warn('[EmailValidator] Abstract API error, falling back to static list');
      return isDisposableEmail(email);
    }

    const data = await response.json();

    // Check if the email is disposable according to Abstract API
    if (data.email_quality?.is_disposable === true) {
      return true;
    }

    // Also fallback check with static list for extra safety
    return isDisposableEmail(email);
  } catch (error) {
    console.warn('[EmailValidator] Abstract API failed, falling back to static list:', error);
    return isDisposableEmail(email);
  }
}

export const DISPOSABLE_EMAIL_ERROR =
  'Disposable email addresses are not allowed. Please use a permanent email address.';
