import type { Feature, GeoJsonProperties, Geometry } from 'geojson';

export type CountryFeature = Feature<Geometry, GeoJsonProperties> & {
  properties: {
    ISO_A2?: string;
    ISO_A2_EH?: string;
    WB_A2?: string;
    ADMIN?: string;
    NAME?: string;
    NAME_LONG?: string;
  } | null;
};

export type CountryRow = {
  country_code: string;
  country: string;
  user_count: number;
  /** Per-plan breakdowns (server-side aggregated from user_settings.plan
   *  joined onto the latest signup_ips row per user). Optional for
   *  backwards compat — pre-2026-05-10 RPC didn't return them. */
  free_count?: number;
  freetrial_count?: number;
  premium_count?: number;
  beta_count?: number;
  lifetime_count?: number;
};

export type PlanFilter = 'all' | 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime';

/** Read the count for a given plan filter on a country row. Falls back
 *  to the unfiltered total when the row has no per-plan breakdown
 *  (e.g. running against the old RPC). */
export function countFor(row: CountryRow, plan: PlanFilter): number {
  if (plan === 'all') return row.user_count;
  const key = `${plan}_count` as const;
  return (row[key] ?? 0) as number;
}

// Natural Earth's 1:110m dataset has `-99` for ISO_A2 on a handful of
// historical / disputed-boundary entities. ISO_A2_EH is the "extended"
// fallback Natural Earth started shipping later, but the vasturiano CDN
// copy doesn't always have it. We back-stop with a name lookup so the
// most common cases (France, Norway, Kosovo, …) still get colored.
const ADMIN_TO_ISO: Record<string, string> = {
  'France': 'FR',
  'Norway': 'NO',
  'Kosovo': 'XK',
  'Somaliland': 'SO',
  'N. Cyprus': 'CY',
  'Northern Cyprus': 'CY',
};

export function pickIso(f: CountryFeature): string | null {
  const a = f.properties?.ISO_A2;
  const b = f.properties?.ISO_A2_EH;
  const c = f.properties?.WB_A2;
  if (a && a !== '-99' && a !== '') return a.toUpperCase();
  if (b && b !== '-99' && b !== '') return b.toUpperCase();
  if (c && c !== '-99' && c !== '') return c.toUpperCase();
  const name = f.properties?.ADMIN || f.properties?.NAME || f.properties?.NAME_LONG;
  if (name && ADMIN_TO_ISO[name]) return ADMIN_TO_ISO[name];
  return null;
}

export function pickName(f: CountryFeature): string {
  return f.properties?.ADMIN || f.properties?.NAME || f.properties?.NAME_LONG || '—';
}

// Per-filter hue. 'all' stays on the dashboard's primary blue; plan
// filters use the swatch hue from lib/plan-colors so the globe matches
// the badge a user sees on the list.
const HUE_BY_PLAN: Record<PlanFilter, number> = {
  all:       217,  // primary blue
  free:       43,  // gold #EAB308
  freetrial:   0,  // red #DC2626
  premium:   213,  // blue #60A5FA
  lifetime:  187,  // cyan #67E8F9
  beta:      255,  // violet #A78BFA
};

// Logarithmic ramp so the long tail of low-user countries stays
// distinguishable from completely-empty ones (linear collapses 1, 2, 5
// users into the same near-black tone).
export function colorFor(count: number, max: number, plan: PlanFilter = 'all'): string {
  if (!count) return 'hsl(232, 14%, 18%)';
  const hue = HUE_BY_PLAN[plan] ?? 217;
  const t = max <= 1 ? 1 : Math.log(count + 1) / Math.log(max + 1);
  const saturation = 35 + 56 * t;
  const lightness  = 22 + 38 * t;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
