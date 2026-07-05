/**
 * engineLoad — per-engine real-time telemetry backing GET /engine-load
 * (the extension's "server engine" panel + its auto local-fallback).
 *
 * Tracked per engine, in memory (resets on restart — it's weather, not
 * history):
 *   - inflight: requests between arrival and response, INCLUDING queue
 *     wait. inflight/slots > 1 means the pool is saturated and jobs are
 *     queuing — which is exactly what the load metric must surface.
 *   - loadPct: EWMA of inflight/slots sampled every 2s over a ~60s
 *     horizon. Raw instantaneous occupancy is useless for the client's
 *     auto-switch: one 400ms search on a 2-slot pool = a 50% spike that
 *     is gone before the next poll. The EWMA gives a stable signal.
 *   - activeUsers: distinct users with a request in the last 60s.
 *   - avgResponseMs: mean of the last 100 successful request durations
 *     (arrival → response, so queue wait included — matches what a user
 *     would actually experience).
 *
 * Slot counts mirror the pool sizes in index.ts (same env vars).
 */

export type LoadEngineKey = 'komodo' | 'stockfish' | 'rodent' | 'maia3';

const SLOTS: Record<LoadEngineKey, number> = {
  komodo: Number(process.env.MAX_KOMODO_INSTANCES) || 2,
  // Rodent's pool is derived from the Komodo count — see suggestionQueue.
  rodent: Math.max(1, Math.floor((Number(process.env.MAX_KOMODO_INSTANCES) || 2) / 2)),
  stockfish: Number(process.env.MAX_STOCKFISH_INSTANCES) || 1,
  maia3: Number(process.env.MAX_MAIA3_INSTANCES) || 2,
};

const RING_SIZE = 100;
const ACTIVE_WINDOW_MS = 60_000;
const SAMPLE_MS = 2_000;
// EWMA horizon ≈ 60s with 2s samples: alpha = 2 / (N + 1), N = 30.
const ALPHA = 2 / (ACTIVE_WINDOW_MS / SAMPLE_MS + 1);

interface EngineState {
  inflight: number;
  lastSeen: Map<string, number>;
  durs: number[];
  durIdx: number;
  ewma: number;
}

const state = new Map<LoadEngineKey, EngineState>();

function st(engine: LoadEngineKey): EngineState {
  let s = state.get(engine);
  if (!s) {
    s = { inflight: 0, lastSeen: new Map(), durs: [], durIdx: 0, ewma: 0 };
    state.set(engine, s);
  }
  return s;
}

export function isLoadEngineKey(v: unknown): v is LoadEngineKey {
  return v === 'komodo' || v === 'stockfish' || v === 'rodent' || v === 'maia3';
}

/** Call when a server suggestion request arrives (after validation). */
export function loadTrackStart(engine: LoadEngineKey, userId: string): void {
  const s = st(engine);
  s.inflight += 1;
  s.lastSeen.set(userId, Date.now());
}

/** Call when the request completes. durMs null = errored (still frees the
 *  inflight slot, but doesn't pollute the response-time ring). */
export function loadTrackEnd(engine: LoadEngineKey, durMs: number | null): void {
  const s = st(engine);
  s.inflight = Math.max(0, s.inflight - 1);
  if (durMs !== null) {
    if (s.durs.length < RING_SIZE) {
      s.durs.push(durMs);
    } else {
      s.durs[s.durIdx] = durMs;
      s.durIdx = (s.durIdx + 1) % RING_SIZE;
    }
  }
}

export function getEngineLoad(engine: LoadEngineKey): {
  activeUsers: number;
  avgResponseMs: number | null;
  sampleCount: number;
  loadPct: number;
  slots: number;
} {
  const s = st(engine);
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [uid, ts] of s.lastSeen) {
    if (ts < cutoff) s.lastSeen.delete(uid);
  }
  const avg = s.durs.length
    ? Math.round(s.durs.reduce((a, b) => a + b, 0) / s.durs.length)
    : null;
  return {
    activeUsers: s.lastSeen.size,
    avgResponseMs: avg,
    sampleCount: s.durs.length,
    loadPct: Math.min(100, Math.round(s.ewma * 100)),
    slots: SLOTS[engine],
  };
}

// Occupancy sampler — module-lifetime interval, one per process.
setInterval(() => {
  for (const engine of Object.keys(SLOTS) as LoadEngineKey[]) {
    const s = st(engine);
    const ratio = s.inflight / SLOTS[engine];
    s.ewma = s.ewma + ALPHA * (ratio - s.ewma);
  }
}, SAMPLE_MS).unref?.();
