/**
 * serverRouteDecision — pure hysteresis logic for the server/local
 * suggestion routing. Dependency-free so it's unit-testable (the
 * polling + store wiring lives in serverEngineRouter, which pulls in
 * browser-only modules).
 */

export const HYSTERESIS_GAP = 15;
export const HYSTERESIS_DWELL_MS = 60_000;

export interface RouteState {
  fallbackActive: boolean;
  /** Timestamp since when load has been below (threshold − gap), while in
   *  fallback. Null when not tracking. */
  belowSince: number | null;
}

/** Pure hysteresis step. Returns the next state + whether the route
 *  changed. `now` injected for tests. */
export function decideRoute(
  state: RouteState,
  loadPct: number,
  threshold: number,
  now: number,
): { next: RouteState; changed: boolean } {
  // Slider at 100 = never leave the server.
  if (threshold >= 100) {
    const changed = state.fallbackActive;
    return { next: { fallbackActive: false, belowSince: null }, changed };
  }
  if (!state.fallbackActive) {
    if (loadPct >= threshold) {
      return { next: { fallbackActive: true, belowSince: null }, changed: true };
    }
    return { next: state, changed: false };
  }
  // In fallback — need sustained calm to go back.
  if (loadPct < threshold - HYSTERESIS_GAP) {
    const since = state.belowSince ?? now;
    if (now - since >= HYSTERESIS_DWELL_MS) {
      return { next: { fallbackActive: false, belowSince: null }, changed: true };
    }
    return { next: { fallbackActive: true, belowSince: since }, changed: false };
  }
  // Load crept back up — reset the calm timer.
  return { next: { fallbackActive: true, belowSince: null }, changed: false };
}
