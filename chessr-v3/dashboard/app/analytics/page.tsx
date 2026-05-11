'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  Line, LineChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis,
  PieChart, Pie, Cell,
} from 'recharts';
import { AlertCircle, Calendar as CalendarIcon, Loader2, RefreshCw } from 'lucide-react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { format } from 'date-fns';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authQS } from '@/components/discord/giveaway-shared';

// ─── Range presets ──────────────────────────────────────────────────────

type Preset = '24h' | '48h' | '7d' | '15d' | '1m' | 'custom';

const PRESETS: { id: Preset; label: string; hours?: number }[] = [
  { id: '24h', label: '24h',     hours: 24 },
  { id: '48h', label: '48h',     hours: 48 },
  { id: '7d',  label: '7 days',  hours: 24 * 7 },
  { id: '15d', label: '15 days', hours: 24 * 15 },
  { id: '1m',  label: '1 month', hours: 24 * 30 },
  { id: 'custom', label: 'Custom' },
];

// Engine color palette — matches the wheel-of-fortune chips on /discord
// for visual consistency.
const ENGINE_COLORS: Record<string, string> = {
  komodo:    '#22c55e',
  stockfish: '#3b82f6',
  maia2:     '#f59e0b',
  maia3:     '#a855f7',
  unknown:   '#71717a',
};

const SOURCE_COLORS: Record<string, string> = {
  server:  '#3b82f6',
  wasm:    '#22c55e',
  unknown: '#71717a',
};

const EVENT_COLORS: Record<string, string> = {
  suggestion:       '#22c55e',
  analysis:         '#3b82f6',
  explanation:      '#a855f7',
  game_review:      '#f59e0b',
  profile_analysis: '#ef4444',
};

interface SeriesPayload {
  from: string;
  to: string;
  bucket: '1h' | '4h' | '1d' | '7d';
  stepMs: number;
  engines: string[];
  series: {
    suggestionsByEngine: Array<Record<string, number | string>>;
    activeUsers:     Array<{ t: string; count: number }>;
    gameReviews:     Array<{ t: string; count: number }>;
    profileAnalyses: Array<{ t: string; count: number }>;
    sourceSplit:     Array<{ source: string; count: number }>;
    engineSource:    Array<{ engine: string; server: number; wasm: number; unknown: number; total: number }>;
    eventMix:        Array<{ event_type: string; count: number }>;
    signups:         Array<{ t: string; count: number }>;
  };
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('24h');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [showPicker, setShowPicker] = useState(false);

  const range = useMemo(() => {
    if (preset === 'custom' && customRange?.from && customRange.to) {
      // Include the full last day so users see today's data.
      const to = new Date(customRange.to);
      to.setHours(23, 59, 59, 999);
      return { from: customRange.from, to };
    }
    const def = PRESETS.find((p) => p.id === preset);
    const hours = def?.hours ?? 24;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    return { from, to };
  }, [preset, customRange]);

  const [data, setData] = useState<SeriesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const params = new URLSearchParams({
        from: range.from.toISOString(),
        to:   range.to.toISOString(),
        token: t,
      });
      const res = await fetch(`/api/admin/analytics/series?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    if (!data) return null;
    const sum = (arr: Array<{ count: number }>) => arr.reduce((s, r) => s + r.count, 0);
    const totalSuggestions = data.series.suggestionsByEngine.reduce((s, row) => {
      let r = 0;
      for (const k of data.engines) r += Number(row[k] ?? 0);
      return s + r;
    }, 0);
    return {
      suggestions:    totalSuggestions,
      activeUsers:    sum(data.series.activeUsers),
      gameReviews:    sum(data.series.gameReviews),
      profileAnalyses: sum(data.series.profileAnalyses),
      signups:        sum(data.series.signups),
    };
  }, [data]);

  return (
    <AdminShell
      title="Analytics"
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-7 gap-2">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        {/* ─── Range selector ─── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id);
                  if (p.id === 'custom') setShowPicker(true);
                  else setShowPicker(false);
                }}
                className={
                  'rounded-md border px-3 py-1 text-[12px] font-medium transition-colors ' +
                  (preset === p.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card/40 text-muted-foreground hover:bg-muted/40 hover:text-foreground')
                }
              >
                {p.id === 'custom' && <CalendarIcon size={12} className="mr-1 inline" />}
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums num">
              {format(range.from, 'MMM d, HH:mm')} → {format(range.to, 'MMM d, HH:mm')}
              {data && <> · <code className="rounded bg-muted px-1.5 py-0.5">{data.bucket}</code> buckets</>}
            </span>
          </CardContent>
        </Card>

        {showPicker && (
          <Card>
            <CardContent className="p-3">
              <DayPicker
                mode="range"
                numberOfMonths={2}
                selected={customRange}
                onSelect={(r) => {
                  setCustomRange(r);
                  if (r?.from && r.to) setShowPicker(false);
                }}
                disabled={{ after: new Date() }}
              />
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {/* ─── Totals row ─── */}
        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Suggestions"     value={totals.suggestions} />
            <Stat label="Active users"    value={totals.activeUsers}    note="bucket DAU sum" />
            <Stat label="Game reviews"    value={totals.gameReviews} />
            <Stat label="Profile analyses" value={totals.profileAnalyses} />
            <Stat label="New signups"     value={totals.signups} />
          </div>
        )}

        {loading && !data && (
          <Card>
            <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* ─── Suggestions by engine ─── */}
            <Card>
              <CardContent className="p-4 sm:p-5">
                <ChartHeader title="Suggestions by engine" hint="Click a legend item to toggle" />
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data.series.suggestionsByEngine}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="t" tickFormatter={(t) => format(new Date(t), data.bucket === '1d' || data.bucket === '7d' ? 'MMM d' : 'MMM d HH:mm')} stroke="#71717a" fontSize={11} />
                    <YAxis allowDecimals={false} stroke="#71717a" fontSize={11} />
                    <Tooltip content={<ChartTooltip bucket={data.bucket} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {data.engines.map((eng) => (
                      <Area
                        key={eng}
                        type="monotone"
                        dataKey={eng}
                        stackId="1"
                        stroke={ENGINE_COLORS[eng] ?? '#71717a'}
                        fill={ENGINE_COLORS[eng] ?? '#71717a'}
                        fillOpacity={0.35}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* ─── 2-col small charts ─── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MiniLineChart
                title="Active users"
                series={data.series.activeUsers}
                bucket={data.bucket}
                color="#22c55e"
              />
              <MiniLineChart
                title="New signups"
                series={data.series.signups}
                bucket={data.bucket}
                color="#a855f7"
              />
              <MiniLineChart
                title="Game reviews"
                series={data.series.gameReviews}
                bucket={data.bucket}
                color="#f59e0b"
              />
              <MiniLineChart
                title="Profile analyses"
                series={data.series.profileAnalyses}
                bucket={data.bucket}
                color="#ef4444"
              />
            </div>

            {/* ─── Source split + per-engine breakdown ─── */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardContent className="p-4 sm:p-5">
                  <ChartHeader title="WASM vs Server" hint="suggestion + analysis events" />
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={data.series.sourceSplit}
                        dataKey="count"
                        nameKey="source"
                        cx="50%" cy="50%"
                        innerRadius={48} outerRadius={80}
                        paddingAngle={2}
                      >
                        {data.series.sourceSplit.map((entry) => (
                          <Cell key={entry.source} fill={SOURCE_COLORS[entry.source] ?? '#71717a'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardContent className="p-4 sm:p-5">
                  <ChartHeader title="Per-engine source split" hint="server vs WASM count per engine" />
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.series.engineSource}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="engine" stroke="#71717a" fontSize={11} />
                      <YAxis allowDecimals={false} stroke="#71717a" fontSize={11} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="server" stackId="src" fill={SOURCE_COLORS.server} />
                      <Bar dataKey="wasm"   stackId="src" fill={SOURCE_COLORS.wasm} />
                      {data.series.engineSource.some((r) => r.unknown > 0) && (
                        <Bar dataKey="unknown" stackId="src" fill={SOURCE_COLORS.unknown} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* ─── Event mix ─── */}
            <Card>
              <CardContent className="p-4 sm:p-5">
                <ChartHeader title="Event mix" hint="all events over the period" />
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.series.eventMix} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis type="number" stroke="#71717a" fontSize={11} />
                    <YAxis type="category" dataKey="event_type" stroke="#71717a" fontSize={11} width={120} />
                    <Tooltip />
                    <Bar dataKey="count">
                      {data.series.eventMix.map((e) => (
                        <Cell key={e.event_type} fill={EVENT_COLORS[e.event_type] ?? '#71717a'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminShell>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function ChartHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="num mt-1 text-[22px] font-bold tabular-nums">{value.toLocaleString()}</div>
        {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}

function MiniLineChart({
  title, series, bucket, color,
}: {
  title: string;
  series: Array<{ t: string; count: number }>;
  bucket: '1h' | '4h' | '1d' | '7d';
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <ChartHeader title={title} />
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="t"
              tickFormatter={(t) => format(new Date(t), bucket === '1d' || bucket === '7d' ? 'MMM d' : 'MMM d HH:mm')}
              stroke="#71717a" fontSize={11}
            />
            <YAxis allowDecimals={false} stroke="#71717a" fontSize={11} />
            <Tooltip content={<ChartTooltip bucket={bucket} />} />
            <Line type="monotone" dataKey="count" stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  bucket: '1h' | '4h' | '1d' | '7d';
}

function ChartTooltip({ active, payload, label, bucket }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const ts = label ? new Date(label as string) : null;
  const fmt = bucket === '1d' || bucket === '7d' ? 'MMM d, yyyy' : 'MMM d, HH:mm';
  return (
    <div className="rounded-md border border-border bg-popover/95 p-2 text-[12px] shadow-md backdrop-blur">
      {ts && <div className="mb-1 text-[11px] font-medium text-muted-foreground">{format(ts, fmt)}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="flex-1 capitalize">{p.name}</span>
          <span className="num tabular-nums font-medium">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
