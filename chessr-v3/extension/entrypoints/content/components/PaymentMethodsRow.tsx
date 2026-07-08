/**
 * PaymentMethodsRow — compact reassurance row of accepted payment methods at
 * the bottom of the price-increase modal. Visa / Mastercard / PayPal use the
 * official brand logos from `react-svg-credit-card-payment-icons` (each ships
 * its own white rounded background); Apple Pay is a small inline mark on a
 * dark chip (the lib has no Apple Pay logo); then "& more" + a crypto marker.
 */

import { VisaLogoIcon } from 'react-svg-credit-card-payment-icons/visa';
import { MastercardLogoIcon } from 'react-svg-credit-card-payment-icons/mastercard';
import { PayPalLogoIcon } from 'react-svg-credit-card-payment-icons/paypal';

export default function PaymentMethodsRow() {
  return (
    <div className="trial-modal-paymethods">
      <VisaLogoIcon width={30} height={20} />
      <MastercardLogoIcon width={30} height={20} />
      <PayPalLogoIcon width={30} height={20} />
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
