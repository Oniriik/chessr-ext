/**
 * Paddle checkout client
 * Opens the checkout in a new tab via the engine's hosted checkout page
 */

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');

export type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

export async function openCheckout(plan: CheckoutPlan, token: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/paddle/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(data.error || `Checkout failed (${res.status})`);
  }

  const { transactionId } = await res.json();
  window.open(`${SERVER_URL}/checkout?txn=${transactionId}`, '_blank');
}
