/**
 * Zero-decimal currency helpers.
 *
 * Most ISO currencies express amounts in minor units (1/100th of the major
 * unit — "cents"). A handful of currencies have NO minor unit at all — the
 * smallest unit IS the major unit — and both Paddle and Stripe-style APIs
 * return amounts for these currencies as WHOLE numbers, not ×100 scaled.
 * Blindly dividing every amount by 100 silently undercharges/underdisplays
 * these currencies by 100x (e.g. a ¥1,500 quote rendered as ¥15).
 *
 * This set covers the zero-decimal currencies Paddle actually supports today
 * (JPY, KRW). Extend it if Paddle adds support for other zero-decimal ISO
 * currencies (e.g. VND, HUF are zero-decimal at some processors but Paddle
 * currently prices those with minor units — verify before adding).
 */
export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW']);

/** Divisor to convert a processor-reported amount into its major unit.
 *  1 for zero-decimal currencies (amount IS already the major unit), 100
 *  for everything else (amount is in minor units / cents). */
export function minorUnitDivisor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}
