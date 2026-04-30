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
