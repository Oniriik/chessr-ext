/**
 * GET /engine-load?engine=<komodo|stockfish|rodent|maia3>
 *
 * Public, lightweight telemetry for the extension's "server engine"
 * settings panel and its automatic local-fallback (poll cadence: 5s
 * while the settings tab is open, 20s in-game when server mode is on).
 * Pure weather data — no auth, no user information exposed.
 */

import { Hono } from 'hono';
import { getEngineLoad, isLoadEngineKey } from '../lib/engineLoad.js';

export const engineLoadRoutes = new Hono();

engineLoadRoutes.get('/engine-load', (c) => {
  const engine = c.req.query('engine');
  if (!isLoadEngineKey(engine)) {
    return c.json({ error: 'unknown engine' }, 400);
  }
  return c.json(getEngineLoad(engine));
});
