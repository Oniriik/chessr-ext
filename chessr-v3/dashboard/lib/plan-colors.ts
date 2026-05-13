/**
 * Plan color tokens — one source of truth for plan badges across the
 * dashboard. Picked to mirror the Chessr Discord role swatches (solid
 * variants, ignoring the gradient role styling) so a user's plan looks
 * the same in Discord and the admin UI.
 *
 *   free      → gold        (#EAB308)
 *   freetrial → red         (#DC2626)
 *   premium   → blue        (#60A5FA)
 *   lifetime  → cyan        (#67E8F9)
 *   beta      → violet      (#A78BFA)
 *   unlocker  → teal        (#22D3EE)  — distinct from lifetime cyan
 *
 * `bg` is the same hue at ~15% opacity for the tinted Badge background.
 * `text` is the brighter variant so text reads against the dim bg on
 * dark backgrounds. `dot` is for inline indicators where we want the
 * solid color (e.g. legend bullets).
 */

import type { CSSProperties } from 'react';

export type Plan = 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime' | 'unlocker';

export const PLAN_COLORS: Record<Plan, { bg: string; text: string; dot: string }> = {
  free:      { bg: 'rgba(234, 179, 8, 0.15)',  text: '#FACC15', dot: '#EAB308' },
  freetrial: { bg: 'rgba(220, 38, 38, 0.18)',  text: '#F87171', dot: '#DC2626' },
  premium:   { bg: 'rgba(96, 165, 250, 0.15)', text: '#93C5FD', dot: '#60A5FA' },
  lifetime:  { bg: 'rgba(103, 232, 249, 0.15)', text: '#67E8F9', dot: '#67E8F9' },
  beta:      { bg: 'rgba(167, 139, 250, 0.15)', text: '#C4B5FD', dot: '#A78BFA' },
  unlocker:  { bg: 'rgba(34, 211, 238, 0.15)', text: '#67E8F9', dot: '#22D3EE' },
};

const FALLBACK = PLAN_COLORS.free;

export function planColor(plan: string): { bg: string; text: string; dot: string } {
  return PLAN_COLORS[plan as Plan] ?? FALLBACK;
}

/** Inline style for Badge — apply alongside `border-transparent` on the
 *  element so the cva default border doesn't peek through. */
export function planBadgeStyle(plan: string): CSSProperties {
  const c = planColor(plan);
  return { backgroundColor: c.bg, color: c.text };
}
