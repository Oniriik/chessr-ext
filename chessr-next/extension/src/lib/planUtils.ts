/**
 * Plan utilities for checking premium features
 */

import { useAuthStore } from '../stores/authStore';
import type { Plan } from '../components/ui/plan-badge';

// Premium plans that have access to all features
const PREMIUM_PLANS: Plan[] = ['lifetime', 'beta', 'premium', 'freetrial'];

// Free plan limits
export const FREE_LIMITS = {
  maxElo: 2000,
  maxRisk: 30,
  maxSkill: 10,
  allowedPersonalities: ['Default', 'Aggressive'] as const,
} as const;

// Free openings (8 hardcoded - 4 white, 4 black)
export const FREE_OPENINGS = [
  // White openings
  { eco: 'C50', name: 'Italian Game', moves: 'e4 e5 Nf3 Nc6 Bc4', category: 'white' as const },
  { eco: 'C60', name: 'Ruy Lopez', moves: 'e4 e5 Nf3 Nc6 Bb5', category: 'white' as const },
  { eco: 'D06', name: "Queen's Gambit", moves: 'd4 d5 c4', category: 'white' as const },
  { eco: 'D02', name: 'London System', moves: 'd4 Nf6 Nf3 e6 Bf4', category: 'white' as const },
  // Black openings
  { eco: 'B20', name: 'Sicilian Defense', moves: 'e4 c5', category: 'black' as const },
  { eco: 'C00', name: 'French Defense', moves: 'e4 e6', category: 'black' as const },
  { eco: 'E60', name: "King's Indian Defense", moves: 'd4 Nf6 c4 g6', category: 'black' as const },
  { eco: 'D10', name: 'Slav Defense', moves: 'd4 d5 c4 c6', category: 'black' as const },
] as const;

export type FreeOpening = typeof FREE_OPENINGS[number];

/**
 * Check if a plan has premium access
 */
export function isPremium(plan: Plan): boolean {
  return PREMIUM_PLANS.includes(plan);
}

/**
 * Hook to check if user has premium access
 */
export function useIsPremium(): boolean {
  const plan = useAuthStore((state) => state.plan);
  return isPremium(plan);
}

/**
 * Hook to get plan-based limits for sliders
 */
export function usePlanLimits() {
  const premium = useIsPremium();

  return {
    maxElo: premium ? 3500 : FREE_LIMITS.maxElo,
    maxRisk: premium ? 100 : FREE_LIMITS.maxRisk,
    maxSkill: premium ? 25 : FREE_LIMITS.maxSkill,
    canUseArmageddon: premium,
    canUsePuzzleHints: premium,
    isPersonalityAllowed: (personality: string) =>
      premium || FREE_LIMITS.allowedPersonalities.includes(personality as typeof FREE_LIMITS.allowedPersonalities[number]),
    // Opening limits
    canUseFullOpeningDatabase: premium,
    canSeeAlternativeOpenings: premium,
    // Accuracy limits
    canSeePhaseAccuracy: premium,
  };
}

/**
 * Validate engine settings against plan limits
 * Returns error message if settings exceed limits, null if OK
 */
export function validateEngineSettings(
  plan: Plan,
  settings: {
    targetElo?: number;
    riskTaking?: number;
    skill?: number;
    personality?: string;
    armageddon?: boolean;
  }
): string | null {
  const premium = isPremium(plan);
  if (premium) return null;

  if (settings.targetElo && settings.targetElo > FREE_LIMITS.maxElo) {
    return `ELO ${settings.targetElo} requires a premium subscription. Free users are limited to ${FREE_LIMITS.maxElo} ELO.`;
  }

  if (settings.personality && !FREE_LIMITS.allowedPersonalities.includes(settings.personality as typeof FREE_LIMITS.allowedPersonalities[number])) {
    return `The "${settings.personality}" personality requires a premium subscription. Free users can use Default or Aggressive.`;
  }

  if (settings.armageddon) {
    return 'Armageddon mode requires a premium subscription.';
  }

  // Risk and Skill are fixed for free users, so we don't need to validate them
  // They should always be sent with the free limit values

  return null;
}

/**
 * Show upgrade required alert
 */
export function showUpgradeAlert(message: string) {
  alert(`🔒 Premium Feature\n\n${message}\n\nUpgrade to unlock all features!`);
}
