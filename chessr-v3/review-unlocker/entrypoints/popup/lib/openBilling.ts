/** Port of chessr-v3/extension/entrypoints/content/lib/openBilling.ts.
 *  Same protocol: POST /api/paddle/billing-link with the auth bearer
 *  token, get a signed billing token back, open chessr.io/checkout. The
 *  checkout page handles BOTH upgrade and manage-subscription flows based
 *  on the user's current plan. */

import { supabase } from './supabase';
import { SERVER_URL } from './config';

export async function openBillingPage(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
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
      window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
      return;
    }

    const { token: billingToken } = await res.json() as { token?: string };
    if (!billingToken) {
      window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
      return;
    }

    const userId = session?.user?.id ?? '';
    // Unlocker extension points at /checkout/unlocker (the focused 1-card
    // billing page). The plug in that page handles the upsell path to
    // /checkout (full Chessr Premium) — same token + uid carried over so
    // the user stays signed in when they navigate. No `discount` param:
    // the Paddle discount ID (earlyaccess) is Premium-only — passing it
    // for the Unlocker product makes Paddle 400 the checkout init.
    const checkoutUrl =
      `https://chessr.io/checkout/unlocker?t=${encodeURIComponent(billingToken)}` +
      `&uid=${encodeURIComponent(userId)}`;

    window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
  } catch {
    window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
  }
}
