/**
 * Subscription Store
 * Manages subscription status and billing information
 */

import { create } from 'zustand';

export type SubscriptionPlan = 'monthly' | 'yearly' | 'lifetime' | null;

interface SubscriptionState {
  // Subscription info
  hasAccess: boolean;
  isBetaTester: boolean;
  plan: SubscriptionPlan;
  loading: boolean;
  error: string | null;

  // Actions
  setSubscription: (data: {
    hasAccess: boolean;
    isBetaTester: boolean;
    plan: SubscriptionPlan;
  }) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  checkSubscription: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  // Initial state
  hasAccess: true, // Default to true for now (no enforcement yet)
  isBetaTester: false,
  plan: null,
  loading: false,
  error: null,

  // Set subscription data
  setSubscription: (data) => set({
    hasAccess: data.hasAccess,
    isBetaTester: data.isBetaTester,
    plan: data.plan,
    error: null,
  }),

  // Set loading state
  setLoading: (loading) => set({ loading }),

  // Set error
  setError: (error) => set({ error, loading: false }),

  // Check subscription status (to be implemented with API call in Phase 4)
  checkSubscription: async () => {
    set({ loading: true });
    try {
      // TODO: Call API endpoint GET /api/subscription/status
      // For now, just set default values
      set({
        hasAccess: true,
        isBetaTester: false,
        plan: null,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to check subscription',
        loading: false,
      });
    }
  },
}));
