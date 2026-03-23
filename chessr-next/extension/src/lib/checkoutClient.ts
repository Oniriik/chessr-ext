/**
 * Paddle checkout client
 * Injects Paddle.js into the page and opens the checkout overlay inline
 */

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');

// Sandbox or production Paddle.js
const PADDLE_ENV = 'sandbox'; // Change to 'production' when ready
const PADDLE_JS_URL = PADDLE_ENV === 'sandbox'
  ? 'https://sandbox-cdn.paddle.com/paddle/v2/paddle.js'
  : 'https://cdn.paddle.com/paddle/v2/paddle.js';
const PADDLE_CLIENT_TOKEN = 'test_15a202d45e46070cf61d95f9727';

export type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

declare global {
  interface Window {
    Paddle?: {
      Initialize: (config: any) => void;
      Checkout: { open: (config: any) => void };
    };
  }
}

let paddleLoaded = false;

function loadPaddleJs(): Promise<void> {
  if (paddleLoaded && window.Paddle) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.Paddle) {
      paddleLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = PADDLE_JS_URL;
    script.async = true;
    script.onload = () => {
      if (window.Paddle) {
        window.Paddle.Initialize({
          token: PADDLE_CLIENT_TOKEN,
          ...(PADDLE_ENV === 'sandbox' ? { environment: 'sandbox' } : {}),
          checkout: {
            settings: {
              theme: 'dark',
            },
          },
        });
        paddleLoaded = true;
        resolve();
      } else {
        reject(new Error('Paddle.js loaded but Paddle object not found'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load Paddle.js'));
    document.head.appendChild(script);
  });
}

export async function openCheckout(plan: CheckoutPlan, token: string): Promise<void> {
  console.log('[Checkout] Requesting:', SERVER_URL, 'plan:', plan);

  // Request transaction from server
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

  const { transactionId } = await res.json();
  console.log('[Checkout] Transaction ID:', transactionId);

  // Load Paddle.js and open checkout overlay
  await loadPaddleJs();

  window.Paddle!.Checkout.open({
    transactionId,
  });
}
