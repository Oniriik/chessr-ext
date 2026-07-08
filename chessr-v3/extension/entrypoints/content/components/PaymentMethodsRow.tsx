/**
 * PaymentMethodsRow — a compact reassurance row of accepted payment methods
 * shown at the bottom of the price-increase modal: card brands (Visa,
 * Mastercard, PayPal, Apple Pay) + "& more", and a crypto marker. Inline
 * SVGs (the extension bundle has no payment-icon lib) kept small and muted.
 */

export default function PaymentMethodsRow() {
  return (
    <div className="trial-modal-paymethods">
      <span className="trial-modal-paychip">
        <svg width="26" height="9" viewBox="0 0 48 16" aria-label="Visa">
          <text x="0" y="13" fontFamily="Arial, sans-serif" fontSize="15" fontWeight="700" fontStyle="italic" fill="#1434CB">VISA</text>
        </svg>
      </span>
      <span className="trial-modal-paychip">
        <svg width="22" height="14" viewBox="0 0 30 18" aria-label="Mastercard">
          <circle cx="12" cy="9" r="8" fill="#EB001B" />
          <circle cx="20" cy="9" r="8" fill="#F79E1B" fillOpacity="0.9" />
          <path d="M16 2.6a8 8 0 0 1 0 12.8 8 8 0 0 1 0-12.8z" fill="#FF5F00" />
        </svg>
      </span>
      <span className="trial-modal-paychip">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-label="PayPal">
          <path fill="#003087" d="M7.4 21.3H4.6c-.3 0-.5-.3-.5-.6L6.9 3.4c.1-.4.4-.6.8-.6h6.5c2.9 0 4.9 1.9 4.5 4.7-.5 3.2-3 5.1-6.2 5.1H9.7c-.4 0-.7.3-.8.7l-1 6.7c-.1.4-.3.6-.5.6z" />
          <path fill="#009CDE" d="M18.7 8.1c-.5 3.2-3 5.1-6.2 5.1h-1.8c-.4 0-.7.3-.8.7l-1 6.7c-.1.4-.4.7-.8.7H5.6c-.3 0-.5-.3-.4-.6l.3-1.7h1.5c.4 0 .7-.2.8-.6l1-6.7c.1-.4.4-.7.8-.7h1.8c3.2 0 5.7-1.9 6.2-5.1.1-.6.1-1.1 0-1.6 1 .6 1.5 1.7 1.1 3.8z" />
        </svg>
      </span>
      <span className="trial-modal-paychip trial-modal-paychip--apple">
        <svg width="30" height="13" viewBox="0 0 40 17" aria-label="Apple Pay">
          <path transform="translate(1,1) scale(0.03)" fill="#fff" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
          <text x="17" y="13" fontFamily="-apple-system, 'Segoe UI', sans-serif" fontSize="11" fontWeight="600" fill="#fff">Pay</text>
        </svg>
      </span>
      <span className="trial-modal-pay-more">&amp; more</span>
      <span className="trial-modal-pay-sep" aria-hidden="true">·</span>
      <span className="trial-modal-pay-crypto">₿ Crypto</span>
    </div>
  );
}
