/**
 * serverEngineRouter — decides where suggestions run when the premium
 * "server suggestions" mode is on, based on the server's smoothed load.
 *
 * Behavior (validated design):
 *   - mode ON → suggestions run on the ServerEngine (WS proxy).
 *   - every 20s, poll GET /engine-load?engine=<current engine>. When
 *     loadPct ≥ threshold → silently fall back to the LOCAL wasm engine.
 *   - return to the server only when loadPct stays below (threshold − 15)
 *     for at least 60s — hysteresis, so a pool hovering around the
 *     threshold doesn't recreate engines in a loop (each swap costs a
 *     wasm init).
 *   - threshold = 100 → never fall back (pure force-server).
 *
 * The route decision is a pure function (decideRoute) so the hysteresis
 * is unit-testable; this module owns the polling + store wiring.
 */

import { SERVER_URL } from './config';
import { useEngineStore } from '../stores/engineStore';
import { useAuthStore } from '../stores/authStore';
import { isPremiumPlan } from './premium';
import { decideRoute, type RouteState } from './serverRouteDecision';

const POLL_MS = 20_000;

let routeState: RouteState = { fallbackActive: false, belowSince: null };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** True when createEngine should return a ServerEngine for `_id` — the
 *  premium server mode is on and the load router hasn't fallen back. */
export function serverModeActive(): boolean {
  const e = useEngineStore.getState();
  if (!e.forceServerEngine) return false;
  if (!isPremiumPlan(useAuthStore.getState().plan)) return false;
  return !routeState.fallbackActive;
}

async function pollOnce(onRouteChange: () => void): Promise<void> {
  const e = useEngineStore.getState();
  if (!e.forceServerEngine || !isPremiumPlan(useAuthStore.getState().plan)) return;
  try {
    const res = await fetch(`${SERVER_URL}/engine-load?engine=${encodeURIComponent(e.engineId)}`);
    if (!res.ok) return; // fail-quiet: keep the current route on blips
    const data = await res.json() as { loadPct?: number };
    if (typeof data.loadPct !== 'number') return;
    const { next, changed } = decideRoute(routeState, data.loadPct, e.serverLoadThreshold, Date.now());
    routeState = next;
    if (changed) {
      e.setServerRoute(routeState.fallbackActive ? 'local-fallback' : 'server');
      onRouteChange();
    }
  } catch { /* network blip — keep current route */ }
}

/** Install the router. `onRouteChange` must rebuild the suggestion engine
 *  (content.tsx swapSuggestionEngine with force). Idempotent. */
export function startServerEngineRouter(onRouteChange: () => void): void {
  if (started) return;
  started = true;

  const syncPolling = () => {
    const e = useEngineStore.getState();
    const active = e.forceServerEngine && isPremiumPlan(useAuthStore.getState().plan);
    if (active && !pollTimer) {
      pollTimer = setInterval(() => { pollOnce(onRouteChange); }, POLL_MS);
      pollOnce(onRouteChange);
    } else if (!active && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  let lastForce = useEngineStore.getState().forceServerEngine;
  let lastEngine = useEngineStore.getState().engineId;
  useEngineStore.subscribe((state) => {
    if (state.forceServerEngine !== lastForce) {
      lastForce = state.forceServerEngine;
      // Mode flipped — reset hysteresis, set the route indicator, rebuild.
      routeState = { fallbackActive: false, belowSince: null };
      state.setServerRoute(state.forceServerEngine ? 'server' : null);
      syncPolling();
      onRouteChange();
      return;
    }
    if (state.engineId !== lastEngine) {
      lastEngine = state.engineId;
      // New engine = new pool — start fresh on the server route.
      const wasFallback = routeState.fallbackActive;
      routeState = { fallbackActive: false, belowSince: null };
      if (state.forceServerEngine && wasFallback) state.setServerRoute('server');
    }
  });
  useAuthStore.subscribe(() => syncPolling());
  syncPolling();
  if (useEngineStore.getState().forceServerEngine) {
    useEngineStore.getState().setServerRoute(serverModeActive() ? 'server' : null);
  }
}
