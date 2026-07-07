/**
 * priceIncrease — pure helpers for the price-increase pre-announce modal
 * (grid 2026-07-12). The announce state is decided by the SERVER (presence
 * of `upcoming` in /api/paddle/prices); the client clock is only used for
 * the cosmetic countdown. Deliberately import-free so tsx --test can run it.
 */

export interface LocalizedPrice {
  price: string;
  original: string | null;
  currency: string;
}

export interface PricesResponse {
  monthly?: LocalizedPrice;
  yearly?: LocalizedPrice;
  lifetime?: LocalizedPrice;
  upcoming?: { monthly: LocalizedPrice; yearly: LocalizedPrice; lifetime: LocalizedPrice };
  priceChangeAt?: string;
}

/** Announce window is live: server sent upcoming prices and a change date
 *  still in the future (guards against a stale cached response). */
export function isPreannounceActive(p: PricesResponse | null, now: number = Date.now()): boolean {
  if (!p?.upcoming?.monthly || !p.upcoming.yearly || !p.upcoming.lifetime) return false;
  if (!p.priceChangeAt) return false;
  const at = Date.parse(p.priceChangeAt);
  return Number.isFinite(at) && at > now;
}

/** "3d 04:05:06" above one day, "23:59:59" under; clamps at zero. */
export function formatCountdown(msRemaining: number): string {
  const ms = Math.max(0, msRemaining);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor(ms / 3_600_000) % 24;
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1_000) % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}
