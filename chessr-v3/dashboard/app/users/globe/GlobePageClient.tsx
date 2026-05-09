'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MeshPhongMaterial } from 'three';
import {
  AlertCircle, ArrowLeft, Loader2, Pause, Play, RotateCw,
  Globe as GlobeIcon, Map as MapIcon,
} from 'lucide-react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { WorldMap2D } from './WorldMap2D';
import { pickIso, pickName, colorFor, countFor, hueForSelection, type CountryFeature, type CountryRow, type PlanKey } from './lib';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PLAN_COLORS } from '@/lib/plan-colors';

// Order matters for the chip row + the stacked bar: highest tier first
// so the eye reads "lifetime↓free" left-to-right.
const PLAN_KEYS: PlanKey[] = ['lifetime', 'premium', 'beta', 'freetrial', 'free'];

// react-globe.gl ships three.js + WebGL; needs the browser. ssr:false is
// the documented way to use it under the Next.js app router.
const Globe = dynamic(() => import('react-globe.gl').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <Loader2 size={18} className="animate-spin" />
    </div>
  ),
});

// Natural Earth 1:110m country polygons — same dataset all the
// vasturiano/globe.gl examples use. Cached aggressively at the CDN.
const COUNTRIES_URL =
  'https://raw.githubusercontent.com/vasturiano/three-globe/master/example/country-polygons/ne_110m_admin_0_countries.geojson';

// ─── Page ──────────────────────────────────────────────────────────────
export function GlobePageClient() {
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  const [counts, setCounts] = useState<Record<string, CountryRow>>({});
  const [total, setTotal] = useState(0);
  const [distinct, setDistinct] = useState(0);
  const [planTotals, setPlanTotals] = useState<Record<PlanKey, number>>({
    free: 0, freetrial: 0, premium: 0, beta: 0, lifetime: 0,
  });
  // Multi-select. Empty set = no filter (show every plan combined). The
  // chip row offers an explicit "All" pseudo-toggle that just clears
  // the set; otherwise each chip toggles its plan in/out independently.
  const [selectedPlans, setSelectedPlans] = useState<Set<PlanKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [view, setView] = useState<'3d' | '2d'>('3d');

  // Track viewport so the globe fills the available space without overflow.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Globe ref to read its underlying three controls (auto-rotate toggle).
  // react-globe.gl exposes `controls()` returning the OrbitControls object.
  // Keeping a loose type — its declared types are partial.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null);

  // ─── Fetch country polygons + user counts in parallel ────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error('Not authenticated');
        const [polyRes, countsRes] = await Promise.all([
          fetch(COUNTRIES_URL),
          fetch(`/api/admin/users/countries?token=${encodeURIComponent(token)}`),
        ]);
        if (!polyRes.ok) throw new Error(`polygons HTTP ${polyRes.status}`);
        if (!countsRes.ok) throw new Error(`counts HTTP ${countsRes.status}`);
        const polyJson = await polyRes.json();
        const countsJson = await countsRes.json();
        if (cancelled) return;
        const features: CountryFeature[] = polyJson.features ?? [];
        const map: Record<string, CountryRow> = {};
        (countsJson.countries as CountryRow[]).forEach((c) => {
          map[c.country_code.toUpperCase()] = c;
        });
        setCountries(features);
        setCounts(map);
        setTotal(countsJson.total ?? 0);
        setDistinct(countsJson.distinct ?? 0);
        if (countsJson.planTotals) {
          setPlanTotals({
            free:      countsJson.planTotals.free      ?? 0,
            freetrial: countsJson.planTotals.freetrial ?? 0,
            premium:   countsJson.planTotals.premium   ?? 0,
            beta:      countsJson.planTotals.beta      ?? 0,
            lifetime:  countsJson.planTotals.lifetime  ?? 0,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Resize observer for globe canvas ────────────────────────────────
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Drive auto-rotation through controls ────────────────────────────
  useEffect(() => {
    if (!globeRef.current || loading) return;
    const c = globeRef.current.controls?.();
    if (!c) return;
    c.autoRotate = autoRotate;
    c.autoRotateSpeed = 0.6;
    c.enableDamping = true;
  }, [autoRotate, loading, countries.length]);

  // ─── Derived: filtered counts by active plan(s) ─────────────────────
  // Returns a counts map identical in shape to the unfiltered one but
  // with `user_count` replaced by the sum-of-selected-plans count. The
  // Globe / WorldMap2D / Top countries list all key off `user_count`,
  // so this single transform feeds them without needing to plumb the
  // selection deeper into each component.
  const filteredCounts = useMemo(() => {
    if (selectedPlans.size === 0) return counts;
    const out: Record<string, CountryRow> = {};
    for (const iso in counts) {
      const row = counts[iso];
      const n = countFor(row, selectedPlans);
      if (n > 0) out[iso] = { ...row, user_count: n };
    }
    return out;
  }, [counts, selectedPlans]);

  const filteredTotal = useMemo(
    () => Object.values(filteredCounts).reduce((s, r) => s + r.user_count, 0),
    [filteredCounts],
  );

  const max = useMemo(
    () => Object.values(filteredCounts).reduce((m, c) => Math.max(m, c.user_count), 0),
    [filteredCounts],
  );

  const activeHue = useMemo(() => hueForSelection(selectedPlans), [selectedPlans]);

  const togglePlan = (p: PlanKey) => {
    setSelectedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  // Custom globe material — neutral dark gray ocean so the colored
  // country polygons read as the only saturated element on the sphere.
  // Tiny emissive keeps the night side from going fully unlit.
  const oceanMaterial = useMemo(
    () => new MeshPhongMaterial({
      color: 0x101115,
      emissive: 0x05060a,
      shininess: 14,
    }),
    [],
  );

  const top = useMemo(
    () => [...Object.values(filteredCounts)].sort((a, b) => b.user_count - a.user_count).slice(0, 10),
    [filteredCounts],
  );

  // Denominator for the coverage % is the count of countries actually
  // drawn on the globe (Natural Earth 1:110m, excluding the -99 / unset
  // ISO entries). Keeps the ratio honest: 100% means "every country we
  // can show on the map has at least one user".
  const totalCountries = useMemo(
    () => countries.filter((c) => pickIso(c) !== null).length,
    [countries],
  );
  const coveragePct = totalCountries ? (distinct / totalCountries) * 100 : 0;

  return (
    <AdminShell
      title="Country distribution"
      actions={
        <Link
          href="/users"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Back to users
        </Link>
      }
    >
      <div className="flex h-full flex-col gap-4 lg:flex-row">
        {/* ─── Globe ───────────────────────────────────────────────── */}
        <div className="relative flex-1">
          <Card className="h-full overflow-hidden">
            <CardContent className="h-full p-0">
              <div ref={wrapperRef} className="relative h-[60vh] w-full lg:h-full">
                {error && (
                  <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle size={13} />
                    <span>{error}</span>
                  </div>
                )}

                {loading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-muted-foreground" />
                  </div>
                ) : view === '2d' ? (
                  <WorldMap2D
                    width={size.w}
                    height={size.h}
                    countries={countries as unknown as Parameters<typeof WorldMap2D>[0]['countries']}
                    counts={filteredCounts}
                    max={max}
                    colorFor={(count, m) => colorFor(count, m, activeHue)}
                  />
                ) : size.w > 0 && (
                  <Globe
                    ref={globeRef}
                    width={size.w}
                    height={size.h}
                    backgroundColor="rgba(0,0,0,0)"
                    showAtmosphere
                    atmosphereColor="rgba(96,165,250,0.18)"
                    atmosphereAltitude={0.12}
                    // No earth texture — we use a custom MeshPhongMaterial
                    // so the ocean is a subtle navy instead of pure black.
                    globeImageUrl=""
                    globeMaterial={oceanMaterial}
                    showGlobe
                    showGraticules={false}
                    polygonsData={countries}
                    // Flat altitude — color alone encodes the count. The
                    // tiny non-zero value keeps polygons rendering above
                    // the sphere surface (z-fighting otherwise).
                    polygonAltitude={0.006}
                    polygonCapColor={(d: object) => {
                      const f = d as CountryFeature;
                      const iso = pickIso(f);
                      const count = iso ? filteredCounts[iso]?.user_count ?? 0 : 0;
                      return colorFor(count, max, activeHue);
                    }}
                    polygonSideColor={() => 'rgba(0,0,0,0.4)'}
                    polygonStrokeColor={() => 'rgba(255,255,255,0.12)'}
                    polygonLabel={(d: object) => {
                      const f = d as CountryFeature;
                      const iso = pickIso(f);
                      const row = iso ? filteredCounts[iso] : undefined;
                      const name = row?.country || pickName(f);
                      const n = row?.user_count ?? 0;
                      return `
                        <div style="background:rgba(20,22,30,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;font-size:12px;color:#e6e6e6;">
                          <div style="font-weight:600">${name}${iso ? ` <span style='opacity:0.5'>(${iso})</span>` : ''}</div>
                          <div style="margin-top:2px;color:#a1a1aa;font-size:11px;">${n.toLocaleString()} user${n === 1 ? '' : 's'}</div>
                        </div>
                      `;
                    }}
                    polygonsTransitionDuration={400}
                  />
                )}

                {/* Floating controls */}
                {!loading && (
                  <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
                    {/* 3D / 2D segmented toggle. Pill style with the
                        active half filled — matches the chip pattern
                        used for plan filters in /users. */}
                    <div className="inline-flex items-center rounded-md border border-border bg-background/70 p-0.5 backdrop-blur-sm">
                      {(['3d', '2d'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setView(m)}
                          className={cn(
                            'inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
                            view === m
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          aria-pressed={view === m}
                        >
                          {m === '3d' ? <GlobeIcon size={11} /> : <MapIcon size={11} />}
                          {m.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {/* 3D-only controls */}
                    {view === '3d' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setAutoRotate((v) => !v)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 text-[11px] text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {autoRotate ? <Pause size={11} /> : <Play size={11} />}
                          {autoRotate ? 'Pause' : 'Spin'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const c = globeRef.current?.controls?.();
                            c?.reset?.();
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
                          title="Reset view"
                        >
                          <RotateCw size={12} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Side panel: stats + top countries ─────────────────── */}
        <aside className="w-full shrink-0 lg:w-80">
          <div className="space-y-3">
            <Card>
              {/* sm:p-4 override — CardContent's default `sm:pt-0` makes
                  top/bottom padding asymmetric when used standalone. */}
              <CardContent className="space-y-3 p-4 sm:p-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Coverage
                  </div>
                  <div className="num mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tracking-tight">{distinct}</span>
                    <span className="text-[11px] text-muted-foreground">countries</span>
                  </div>
                  <div className="num mt-1 flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-foreground/80">
                      {(selectedPlans.size === 0 ? total : filteredTotal).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {selectedPlans.size === 0
                        ? 'users with known IP'
                        : selectedPlans.size === 1
                          ? `${[...selectedPlans][0]} users`
                          : `users across ${selectedPlans.size} plans`}
                    </span>
                  </div>
                </div>

                {/* ─── Plan distribution stacked bar ───────────────────── */}
                <div className="space-y-2 border-t border-border/40 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Plan distribution
                    </span>
                    <span className="num text-[11px] text-muted-foreground tabular-nums">
                      {total.toLocaleString()} total
                    </span>
                  </div>
                  {total > 0 ? (
                    <>
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/50">
                        {PLAN_KEYS.map((p) => {
                          const n = planTotals[p];
                          if (!n) return null;
                          const pct = (n / total) * 100;
                          return (
                            <div
                              key={p}
                              title={`${p}: ${n.toLocaleString()} (${pct.toFixed(1)}%)`}
                              style={{ width: `${pct}%`, backgroundColor: PLAN_COLORS[p].dot }}
                              className="h-full transition-[width] duration-300"
                            />
                          );
                        })}
                      </div>
                      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-0.5 text-[10px]">
                        {PLAN_KEYS.map((p) => {
                          const n = planTotals[p];
                          const pct = total ? (n / total) * 100 : 0;
                          return (
                            <li key={p} className="flex items-center gap-1.5 capitalize">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: PLAN_COLORS[p].dot }}
                              />
                              <span className="text-muted-foreground">{p}</span>
                              <span className="num ml-auto tabular-nums text-foreground/80">
                                {pct.toFixed(1)}%
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No data yet.</p>
                  )}
                </div>

                {/* ─── Plan filter chips (multi-select) ────────────────── */}
                {/* "All" is a clear-selection toggle (active when no plan is
                    picked); the others toggle individually so the admin can
                    AND-stack e.g. Premium + Lifetime to see paying-only. */}
                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Filter by plan
                    </span>
                    {selectedPlans.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedPlans(new Set())}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedPlans(new Set())}
                      aria-pressed={selectedPlans.size === 0}
                      className={cn(
                        'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
                        selectedPlans.size === 0
                          ? 'border-transparent text-foreground'
                          : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      style={
                        selectedPlans.size === 0
                          ? { backgroundColor: 'rgba(96,165,250,0.15)', color: '#93C5FD' }
                          : undefined
                      }
                    >
                      All
                    </button>
                    {PLAN_KEYS.map((p) => {
                      const active = selectedPlans.has(p);
                      const tone = PLAN_COLORS[p];
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePlan(p)}
                          aria-pressed={active}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                            active
                              ? 'border-transparent text-foreground'
                              : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                          style={active ? { backgroundColor: tone.bg, color: tone.text } : undefined}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: tone.dot }}
                          />
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-border/40 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      World coverage
                    </span>
                    <span className="num text-[12px] font-semibold tabular-nums">
                      {coveragePct.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={coveragePct} className="h-1.5 bg-secondary/60" />
                  <div className="num text-[10px] text-muted-foreground">
                    {distinct} of {totalCountries} countries
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 sm:p-4">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Top countries
                </div>
                {top.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No data yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {top.map((c, i) => {
                      const denom = selectedPlans.size === 0 ? total : filteredTotal;
                      const pct = denom ? (c.user_count / denom) * 100 : 0;
                      return (
                        <li key={c.country_code} className="flex items-center gap-2">
                          <span className="num w-6 text-[10px] text-muted-foreground">
                            {i + 1}.
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px]" title={c.country}>
                            {c.country}
                          </span>
                          <span className="num w-12 text-right text-[12px] font-medium tabular-nums">
                            {c.user_count.toLocaleString()}
                          </span>
                          <span className={cn(
                            'num w-10 text-right text-[10px] tabular-nums',
                            pct > 10 ? 'text-foreground' : 'text-muted-foreground',
                          )}>
                            {pct.toFixed(1)}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </AdminShell>
  );
}
