/**
 * Paddle checkout client
 * Calls the server to create a checkout session and opens it in a new tab
 */

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');

export type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

export async function openCheckout(plan: CheckoutPlan, token: string): Promise<void> {
  console.log('[Checkout] Requesting:', SERVER_URL, 'plan:', plan);
  const res = await fetch(`${SERVER_URL}/api/paddle/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });
  console.log('[Checkout] Response status:', res.status);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Checkout failed (${res.status})`);
  }

  const { checkoutUrl } = await res.json();
  window.open(checkoutUrl, '_blank');
}
