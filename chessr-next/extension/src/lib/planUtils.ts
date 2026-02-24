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
