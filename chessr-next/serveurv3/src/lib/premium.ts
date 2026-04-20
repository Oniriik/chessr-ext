import { supabase } from './supabase.js';

export const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];

type CacheEntry = { plan: string; ts: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 1 min — plan changes propagate within a minute

export async function getUserPlan(userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.plan;

  const { data } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();

  const plan = data?.plan || 'free';
  cache.set(userId, { plan, ts: Date.now() });
  return plan;
}

export async function isUserPremium(userId: string): Promise<boolean> {
  if (!userId || userId === 'anonymous') return false;
  const plan = await getUserPlan(userId);
  return PREMIUM_PLANS.includes(plan);
}

export function invalidatePlanCache(userId: string): void {
  cache.delete(userId);
}
