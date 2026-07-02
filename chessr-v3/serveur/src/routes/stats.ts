/**
 * Public stats — consumed by the landing page (chessr.io) to show the
 * live player count in the hero. No auth: exposes a single aggregate
 * number, nothing sensitive. Cached in memory so Supabase sees at most
 * one count query per TTL regardless of landing traffic.
 *
 *   GET /stats/public → { players: number }
 */

import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';

export const statsRoutes = new Hono();

const TTL_MS = 10 * 60 * 1000;
let cache: { players: number; at: number } | null = null;

statsRoutes.get('/stats/public', async (c) => {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return c.json({ players: cache.players });
  }

  const { count, error } = await supabase
    .from('user_settings')
    .select('*', { count: 'exact', head: true });

  if (error || count == null) {
    // Serve the stale cache if we have one — better than an error.
    if (cache) return c.json({ players: cache.players });
    return c.json({ error: 'count unavailable' }, 503);
  }

  cache = { players: count, at: Date.now() };
  return c.json({ players: count });
});
