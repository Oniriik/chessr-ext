/**
 * Quota + review-cache HTTP endpoints surfaced to the chessr-v3 Next.js
 * web app (app.chessr.io). These wrap the analyticsRepo functions so the
 * app no longer has to talk to Supabase for user_activity / game_reviews
 * reads — Supabase has been truncated and the live data lives on the
 * local Postgres (see USE_LOCAL_DB).
 *
 *   - GET /api/review-limit              — bearer auth, daily game_review cap
 *   - GET /api/profile-analysis-limit    — bearer auth, weekly profile_analysis cap
 *   - GET /api/review-cache?id=&coach=   — no auth, public cache check
 *
 * Mirrors the contract of the old app/api/<feature>/route.ts handlers
 * so the frontend can swap base URL without payload changes.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { countUserActivitySince, getCachedReview } from '../lib/analyticsRepo.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const DAILY_REVIEW_LIMIT = 5;
const WEEKLY_PROFILE_LIMIT = 3;

const PREMIUM_TIERS = new Set(['premium', 'lifetime', 'beta', 'freetrial']);
const REVIEW_UNLIMITED_TIERS = new Set([...PREMIUM_TIERS, 'unlocker']);

export const limitsRoutes = new Hono();

async function verifyBearer(c: Context): Promise<{ userId: string } | null> {
  const authHeader = c.req.header('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

async function getPlan(userId: string): Promise<string> {
  const { data } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();
  return data?.plan || 'free';
}

// ─── GET /api/review-limit ──────────────────────────────────────────────
// Returns { isLimited, dailyUsage, dailyLimit } — same shape as the old
// app/api/review-limit route. Fails open (isLimited:false) on errors so
// the UI doesn't break if the serveur is unreachable.
limitsRoutes.get('/api/review-limit', async (c) => {
  try {
    const auth = await verifyBearer(c);
    if (!auth) return c.json({ isLimited: false, dailyUsage: 0, dailyLimit: null });
    const plan = await getPlan(auth.userId);
    if (REVIEW_UNLIMITED_TIERS.has(plan)) {
      return c.json({ isLimited: false, dailyUsage: 0, dailyLimit: null });
    }
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const dailyUsage = await countUserActivitySince(auth.userId, 'game_review', todayUTC.toISOString());
    return c.json({ isLimited: true, dailyUsage, dailyLimit: DAILY_REVIEW_LIMIT });
  } catch {
    return c.json({ isLimited: false, dailyUsage: 0, dailyLimit: null });
  }
});

// ─── GET /api/profile-analysis-limit ────────────────────────────────────
// Weekly window (7 days). Profile analysis is a Premium-only feature;
// 'unlocker' does NOT get unlimited access here. Same response shape as
// the old app/api/profile-analysis-limit route.
limitsRoutes.get('/api/profile-analysis-limit', async (c) => {
  try {
    const auth = await verifyBearer(c);
    if (!auth) return c.json({ isLimited: false, weeklyUsage: 0, weeklyLimit: null });
    const plan = await getPlan(auth.userId);
    if (PREMIUM_TIERS.has(plan)) {
      return c.json({ isLimited: false, weeklyUsage: 0, weeklyLimit: null });
    }
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weeklyUsage = await countUserActivitySince(auth.userId, 'profile_analysis', weekAgo.toISOString());
    return c.json({ isLimited: true, weeklyUsage, weeklyLimit: WEEKLY_PROFILE_LIMIT });
  } catch {
    return c.json({ isLimited: false, weeklyUsage: 0, weeklyLimit: null });
  }
});

// ─── GET /api/review-cache ──────────────────────────────────────────────
// Public — no auth. Returns the cached analysis JSON for a game so the
// app can render the review page without re-running the engine. Caller
// must pass id and coach (defaults to 'Generic_coach' on miss).
limitsRoutes.get('/api/review-cache', async (c) => {
  try {
    const gameId = c.req.query('id') || '';
    const coachId = c.req.query('coach') || 'Generic_coach';
    if (!gameId) return c.json({ error: 'Missing game id' }, 400);
    const row = await getCachedReview(gameId, 'chesscom', coachId);
    if (row?.analysis) return c.json({ cached: true, analysis: row.analysis });
    return c.json({ cached: false });
  } catch {
    return c.json({ cached: false });
  }
});
