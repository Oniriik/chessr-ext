/**
 * Wheel-of-fortune outcome distribution.
 *
 * Lives on the serveur (not the bot) so a compromised bot can't mint
 * lifetime grants by lying about the result. /admin/wheel/spin rolls
 * here and writes the row in the same transaction that consumes the
 * token.
 *
 * Total weight = 1000 → each unit = 0.1%. Tweaking probabilities is
 * editing weights in this file; nothing else changes.
 */

export type WheelOutcome =
  | { kind: 'days'; value: number; weight: number }
  | { kind: 'lifetime'; weight: number };

export const WHEEL_OUTCOMES: readonly WheelOutcome[] = [
  // Mass-market tier — 60% combined, slightly under the safe option
  // would have been (10d). The wheel's appeal is the upside, not the
  // floor.
  { kind: 'days', value: 5,   weight: 300 },  // 30%
  { kind: 'days', value: 7,   weight: 300 },  // 30%
  // "Fair" tier — equals or beats the safe.
  { kind: 'days', value: 10,  weight: 220 },  // 22%
  { kind: 'days', value: 15,  weight: 100 },  // 10%
  // Big wins.
  { kind: 'days', value: 30,  weight: 50  },  // 5%   (1 month)
  { kind: 'days', value: 60,  weight: 20  },  // 2%   (2 months)
  // Mythic.
  { kind: 'days', value: 365, weight: 9   },  // 0.9% (1 year)
  { kind: 'lifetime',         weight: 1   },  // 0.1% (1 in 1000)
];

const TOTAL_WEIGHT = WHEEL_OUTCOMES.reduce((s, o) => s + o.weight, 0);

if (TOTAL_WEIGHT !== 1000) {
  // Boot-time guard: if someone edits weights and the total drifts, we
  // want to know immediately rather than silently skewing odds.
  throw new Error(`Wheel weights must sum to 1000, got ${TOTAL_WEIGHT}`);
}

/** Pick one outcome uniformly weighted. Uses Math.random — fine for a
 *  reward wheel where Discord is already the trust root. If we ever
 *  need cryptographic fairness, swap to crypto.randomInt. */
export function rollWheel(): WheelOutcome {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const outcome of WHEEL_OUTCOMES) {
    r -= outcome.weight;
    if (r <= 0) return outcome;
  }
  // Floating-point rounding fallback — happens once in a blue moon when
  // r === TOTAL_WEIGHT exactly.
  return WHEEL_OUTCOMES[WHEEL_OUTCOMES.length - 1];
}
