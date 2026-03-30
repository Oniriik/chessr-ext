/**
 * Checkout client
 * Gets a billing token from the server, then opens chessr.io/checkout
 * where the user selects a plan and completes payment via Paddle.
 */

import { supabase } from './supabase';

export type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');

export async function openBillingPage(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      console.error('[Billing] No auth session');
      return;
    }

    // Get a signed billing token from the server
    const res = await fetch(`${SERVER_URL}/api/paddle/billing-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      console.error('[Billing] Failed to get billing link:', res.status);
      return;
    }

    const { token: billingToken } = await res.json();

    // Build the checkout URL (include userId for signup-country-based pricing)
    const returnUrl = window.location.href;
    const userId = session?.user?.id || '';
    const checkoutUrl = `https://chessr.io/checkout?t=${encodeURIComponent(billingToken)}&discount=earlyaccess&uid=${encodeURIComponent(userId)}&return=${encodeURIComponent(returnUrl)}`;

    console.log('[Billing] Opening:', checkoutUrl);
    window.location.href = checkoutUrl;
  } catch (err) {
    console.error('[Billing] Error:', err);
  }
}
