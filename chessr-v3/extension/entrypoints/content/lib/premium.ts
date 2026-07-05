/**
 * Premium plan check — single source of truth across the codebase.
 *
 * Returns true for any paying / privileged tier; false for `free` and
 * unknown plans. Use this in every gate — no hardcoded `return true`
 * overrides scattered across components.
 *
 * Engine selection has its own additional rule (Komodo + Stockfish are
 * free-tier; Maia 2 / Maia 3 require premium) — see SettingsScreen.
 */

const PREMIUM_PLANS = new Set(['premium', 'lifetime', 'beta', 'freetrial']);

export function isPremium(plan: string | undefined): boolean {
  return PREMIUM_PLANS.has(plan ?? '');
}

/** Alias for callsites that historically used `isPremiumPlan` naming. */
export const isPremiumPlan = isPremium;

/**
 * Whether we can offer the 3-day free trial to this user — drives every
 * "Start your free trial" CTA on premium walls. True only for a settled
 * (`!planLoading`) free-plan account that never claimed a trial. The
 * server enforces the same gates (plus the Discord anti-abuse check) in
 * claimFreeTrial; this is just the display condition.
 */
export function canOfferTrial(plan: string | undefined, freetrialUsed: boolean, planLoading: boolean): boolean {
  return plan === 'free' && !freetrialUsed && !planLoading;
}
