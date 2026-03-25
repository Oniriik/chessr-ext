/**
 * Checkout client
 * Opens the extension's billing page where Polar handles the checkout
 */

export type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

export function openBillingPage(): void {
  try {
    const billingUrl = chrome.runtime.getURL('billing.html');
    console.log('[Billing] Opening:', billingUrl);
    window.open(billingUrl, '_blank');
  } catch (err) {
    console.error('[Billing] Error:', err);
    // Fallback: ask background to open the tab
    chrome.runtime.sendMessage({ type: 'open_billing' });
  }
}
