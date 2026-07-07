import { create } from 'zustand';
import { type PricesResponse } from '../lib/priceIncrease';
import { SERVER_URL } from '../lib/config';

/**
 * PriceAnnounceStore — shared state for the price-increase announce window
 * (grid 2026-07-12).
 *
 * `prices` is the localized /api/paddle/prices response, fetched at most
 * once per TTL and shared by every consumer (PanelHeader's announce icon,
 * FreeUpgradeModal's variant decision). `openRequested` is the manual
 * open signal: the header icon sets it, FreeUpgradeModal consumes it and
 * opens without writing the 24h stamp (explicit user intent).
 */

const TTL_MS = 30 * 60_000;

interface PriceAnnounceState {
  prices: PricesResponse | null;
  fetchedAt: number;
  openRequested: boolean;
  /** Fetch localized prices, deduped: at most one request per TTL, one in flight. */
  refresh: (userId: string) => Promise<PricesResponse | null>;
  requestOpen: () => void;
  clearOpenRequest: () => void;
}

let inflight: Promise<PricesResponse | null> | null = null;

export const usePriceAnnounceStore = create<PriceAnnounceState>((set, get) => ({
  prices: null,
  fetchedAt: 0,
  openRequested: false,

  refresh: async (userId) => {
    const { prices, fetchedAt } = get();
    if (Date.now() - fetchedAt < TTL_MS) return prices;
    if (inflight) return inflight;
    inflight = (async () => {
      let p: PricesResponse | null = null;
      try {
        const res = await fetch(`${SERVER_URL}/api/paddle/prices?userId=${encodeURIComponent(userId)}`);
        const data = res.ok ? await res.json() : null;
        p = data && !data.error ? (data as PricesResponse) : null;
      } catch { /* announce state simply stays off */ }
      set({ prices: p, fetchedAt: Date.now() });
      inflight = null;
      return p;
    })();
    return inflight;
  },

  requestOpen: () => set({ openRequested: true }),
  clearOpenRequest: () => set({ openRequested: false }),
}));
