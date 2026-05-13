/** Port of chessr-v3/extension/entrypoints/content/lib/openBilling.ts.
 *  Same protocol: POST /api/paddle/billing-link with the auth bearer
 *  token, get a signed billing token back, open chessr.io/checkout. The
 *  checkout page handles BOTH upgrade and manage-subscription flows based
 *  on the user's current plan. */

import { supabase } from './supabase';
import { SERVER_URL } from './config';
import type { Plan } from '../stores/authStore';

/** Decide which checkout page to open based on the user's current plan.
 *  Premium-tier users land on /checkout (full Chessr management);
 *  free / unlocker users land on /checkout/unlocker (subscribe or
 *  manage the unlocker plan, with an upsell plug to /checkout). */
function checkoutPathFor(plan: Plan): string {
  if (plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial') {
    return '/checkout';
  }
  return '/checkout/unlocker';
}

export async function openBillingPage(plan: Plan = 'free'): Promise<void> {
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
    // Premium-tier users (premium / lifetime / beta / freetrial) land on
    // /checkout where they can actually manage their Chessr subscription.
    // Everyone else (free / unlocker) lands on /checkout/unlocker —
    // subscribe to the unlocker plan or manage an existing unlocker sub,
    // with the upsell plug back to /checkout if they want full Premium.
    // No `discount` param: PADDLE_DISCOUNT_ID is Premium-only — passing
    // it for the unlocker product makes Paddle 400 the transaction init.
    const path = checkoutPathFor(plan);
    const checkoutUrl =
      `https://chessr.io${path}?t=${encodeURIComponent(billingToken)}` +
      `&uid=${encodeURIComponent(userId)}`;

    window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
  } catch {
    window.open('https://chessr.io/#pricing', '_blank', 'noopener,noreferrer');
  }
}
