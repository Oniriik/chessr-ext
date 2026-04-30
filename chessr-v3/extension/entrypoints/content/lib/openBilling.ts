/**
 * openBillingPage — get a signed billing token from the server and open
 * chessr.io/checkout in a new tab. Same protocol as v2's checkoutClient
 * (chessr-next/extension/src/lib/checkoutClient.ts) so the chessr.io
 * server-side handler works for both versions.
 *
 * Used by:
 *   - PanelHeader's "Upgrade" pill (free / freetrial users)
 *   - SettingsScreen's "Manage subscription" / "Upgrade to Premium" CTA
 *
 * The chessr.io/checkout page handles BOTH upgrade AND manage flows
 * server-side based on the user's current plan: free / freetrial users
 * see plan selection (monthly/yearly/lifetime); premium users see the
 * lifetime upgrade option + management actions.
 */

import { supabase } from './supabase';
import { SERVER_URL } from './config';

export async function openBillingPage(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      console.error('[Chessr][billing] no auth session');
      // Fall through to public pricing page so the user sees something.
      window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
      return;
    }

    const res = await fetch(`${SERVER_URL}/api/paddle/billing-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      console.error('[Chessr][billing] billing-link failed:', res.status);
      // Fall back to public pricing.
      window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
      return;
    }

    const { token: billingToken } = await res.json() as { token?: string };
    if (!billingToken) {
      console.error('[Chessr][billing] no token in billing-link response');
      window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
      return;
    }

    const userId = session?.user?.id ?? '';
    const returnUrl = window.location.href;
    const checkoutUrl =
      `https://chessr.io/checkout?t=${encodeURIComponent(billingToken)}` +
      `&discount=earlyaccess` +
      `&uid=${encodeURIComponent(userId)}` +
      `&return=${encodeURIComponent(returnUrl)}`;

    console.log('[Chessr][billing] opening', checkoutUrl);
    window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.error('[Chessr][billing] error:', err);
    // Last-ditch fallback so the click never feels dead.
    window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
  }
}
