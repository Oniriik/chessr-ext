/**
 * fakeEngineLoad — plausible fake telemetry for free users (the panel
 * teases the premium "server suggestions" feature without hitting the
 * network). Deterministic per (engine, 5-minute bucket) so values look
 * alive across visits but don't flicker within one.
 */

export interface EngineLoadSnapshot {
  activeUsers: number;
  avgResponseMs: number | null;
  loadPct: number;
}

export function fakeEngineLoad(engine: string, bucket: number): EngineLoadSnapshot {
  // FNV-1a over "engine:bucket" — cheap, stable, spread enough.
  let h = 2166136261 >>> 0;
  for (const c of `${engine}:${bucket}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const r1 = (h % 1000) / 1000;
  const r2 = ((h >>> 10) % 1000) / 1000;
  const r3 = ((h >>> 20) % 1000) / 1000;
  return {
    activeUsers: 2 + Math.floor(r1 * 7),          // 2..8
    avgResponseMs: 600 + Math.round(r2 * 350),    // 600..950
    loadPct: 25 + Math.round(r3 * 40),            // 25..65
  };
}

export const fakeLoadBucket = (nowMs: number): number => Math.floor(nowMs / 300_000);
