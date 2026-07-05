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

export interface OpenBillingOptions {
  /** Navigate the current tab instead of opening a new one. Used by the
   *  full-screen modals (trial expiry) where the takeover context makes a
   *  same-tab redirect the expected behavior — the checkout page's
   *  `return` param brings the user back here. */
  sameTab?: boolean;
}

export async function openBillingPage(options: OpenBillingOptions = {}): Promise<void> {
  const navigate = (url: string) => {
    if (options.sameTab) {
      window.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      console.error('[Chessr][billing] no auth session');
      // Fall through to public pricing page so the user sees something.
      navigate('https://chessr.io/#pricing');
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
      navigate('https://chessr.io/#pricing');
      return;
    }

    const { token: billingToken } = await res.json() as { token?: string };
    if (!billingToken) {
      console.error('[Chessr][billing] no token in billing-link response');
      navigate('https://chessr.io/#pricing');
      return;
    }

    const userId = session?.user?.id ?? '';
    const returnUrl = window.location.href;
    // No `&discount=...` for now. The query-param machinery is preserved
    // (checkout/page.tsx still reads `discount` and forwards it to
    // Paddle.Checkout.open) so re-enabling a future code only requires
    // appending `&discount=<code>` here. To restore Early Access:
    //   `&discount=earlyaccess`
    const checkoutUrl =
      `https://chessr.io/checkout?t=${encodeURIComponent(billingToken)}` +
      `&uid=${encodeURIComponent(userId)}` +
      `&return=${encodeURIComponent(returnUrl)}`;

    console.log('[Chessr][billing] opening', checkoutUrl);
    navigate(checkoutUrl);
  } catch (err) {
    console.error('[Chessr][billing] error:', err);
    // Last-ditch fallback so the click never feels dead.
    navigate('https://chessr.io/#pricing');
  }
}
