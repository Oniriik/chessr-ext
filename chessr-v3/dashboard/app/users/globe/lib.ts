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

export type CountryRow = { country_code: string; country: string; user_count: number };

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

// Single-hue ramp aligned with the dashboard's primary blue (~217°).
// Logarithmic so the long tail of low-user countries stays distinguishable
// from completely-empty ones (linear collapses 1, 2, 5 users into the
// same near-black tone).
export function colorFor(count: number, max: number): string {
  if (!count) return 'hsl(232, 14%, 18%)';
  const t = max <= 1 ? 1 : Math.log(count + 1) / Math.log(max + 1);
  const saturation = 35 + 56 * t;
  const lightness  = 22 + 38 * t;
  return `hsl(217, ${saturation}%, ${lightness}%)`;
}
