'use client';

import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Users, Layers, AlertCircle, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatBytes, formatRelative } from '@/lib/utils';

// ─── Types matching server-side responses ──────────────────────────────
type Sample = {
  cpuPct: number;
  memUsed: number;
  memTotal: number;
  memPct: number;
  rss: number;
  load1: number;
  cpuCount: number;
  diskUsed: number;
  diskTotal: number;
  diskPct: number;
};

type EngineUsage = { source: 'wasm' | 'server'; engine: string | null; ts: number } | null;
type ConnectedUser = {
  userId: string;
  email: string | null;
  plan: 'free' | 'premium' | 'lifetime' | 'beta' | 'freetrial' | string;
  mode: 'wasm' | 'server' | 'mixed' | 'unknown';
  connectedAt: number;
  lastSuggestion: EngineUsage;
  lastAnalysis: EngineUsage;
  lastEval: EngineUsage;
};

type Counts = { active: number; waiting: number; completed: number; failed: number; delayed: number };
type QueueData = { name: string; counts: Counts; failed: unknown[] };

// ─── Stat card with progress bar (CPU / RAM / Storage tiles) ───────────
function ResourceCard({
  icon: Icon,
  label,
  pct,
  primary,
  secondary,
}: {
  icon: typeof Cpu;
  label: string;
  pct: number;
  primary: string;
  secondary?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 normal-case tracking-normal text-[11px] font-medium">
            <Icon size={13} className="text-muted-foreground" strokeWidth={2.2} />
            {label}
          </CardTitle>
          <span className="font-mono text-base font-semibold tabular-nums sm:text-lg">
            {pct.toFixed(0)}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Progress value={pct} className="h-1.5" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{primary}</span>
          {secondary && <span className="font-mono tabular-nums">{secondary}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function planBadge(plan: string) {
  const v: 'default' | 'success' | 'warning' | 'muted' =
      plan === 'lifetime' ? 'success'
    : plan === 'premium'  ? 'default'
    : plan === 'beta'     ? 'warning'
    : plan === 'freetrial' ? 'warning'
    : 'muted';
  return <Badge variant={v} className="capitalize">{plan}</Badge>;
}

function modeBadge(mode: ConnectedUser['mode']) {
  if (mode === 'wasm')    return <Badge variant="success">WASM</Badge>;
  if (mode === 'server')  return <Badge variant="default">Server</Badge>;
  if (mode === 'mixed')   return <Badge variant="warning">Mixed</Badge>;
  return <Badge variant="muted">—</Badge>;
}

// ─── Connected user row ────────────────────────────────────────────────
function UserRow({ u }: { u: ConnectedUser }) {
  const sLabel = u.lastSuggestion?.engine ?? '—';
  const aLabel = u.lastAnalysis?.engine ?? '—';
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border px-3 py-2.5 text-sm last:border-0 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_minmax(0,1fr)_auto] sm:gap-3 sm:px-4">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium" title={u.email ?? u.userId}>
          {u.email ?? u.userId.slice(0, 8) + '…'}
        </div>
        <div className="text-[10px] text-muted-foreground sm:hidden">
          {formatRelative(u.connectedAt)} · sug: {sLabel} · ana: {aLabel}
        </div>
      </div>

      {/* Plan + Mode visible on all sizes (mobile = right of email) */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 sm:contents">
        <div className="flex items-center justify-start sm:justify-center">{planBadge(u.plan)}</div>
        <div className="hidden items-center justify-center sm:flex">{modeBadge(u.mode)}</div>
      </div>

      {/* Desktop-only columns */}
      <div className="hidden text-[12px] tabular-nums text-muted-foreground sm:block">
        sug: <span className="text-foreground">{sLabel}</span>
        {' · '}
        ana: <span className="text-foreground">{aLabel}</span>
      </div>
      <div className="hidden text-right text-[11px] text-muted-foreground sm:block">
        {formatRelative(u.connectedAt)}
      </div>

      {/* Mode badge on mobile (below the row, full width-ish) */}
      <div className="col-span-2 -mt-1 sm:hidden">{modeBadge(u.mode)}</div>
    </div>
  );
}

// ─── Queue summary card (one per queue) ────────────────────────────────
function QueueCard({ q }: { q: QueueData }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="capitalize">{q.name}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Active</span>
          <span className="font-mono text-xl font-semibold tabular-nums">{q.counts.active}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Waiting</span>
          <span className="font-mono text-base font-medium tabular-nums text-amber-400">{q.counts.waiting}</span>
        </div>
        {q.counts.failed > 0 && (
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Failed</span>
            <span className="font-mono text-sm font-medium tabular-nums text-destructive">{q.counts.failed}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────
export default function LivePage() {
  const [sys, setSys] = useState<Sample | null>(null);
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [queues, setQueues] = useState<QueueData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const [m, u, q] = await Promise.all([
          fetch(`/api/metrics?token=${encodeURIComponent(token)}`),
          fetch(`/api/users/connected?token=${encodeURIComponent(token)}`),
          fetch(`/api/queues?token=${encodeURIComponent(token)}`),
        ]);
        if (!m.ok || !u.ok || !q.ok) throw new Error(`HTTP ${m.status}/${u.status}/${q.status}`);
        if (cancelled) return;
        setSys(await m.json());
        setUsers((await u.json()).users || []);
        setQueues((await q.json()).queues || []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Aggregate connected mode breakdown for the small caption.
  const modes = users.reduce(
    (acc, u) => { acc[u.mode] = (acc[u.mode] ?? 0) + 1; return acc; },
    {} as Record<ConnectedUser['mode'], number>,
  );

  return (
    <AdminShell title="Live">
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Resources (CPU / RAM / Storage) ────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resources
          </h2>
          {!loaded ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 sm:h-28" />)}
            </div>
          ) : sys ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <ResourceCard
                icon={Cpu}
                label="CPU"
                pct={sys.cpuPct}
                primary={`${sys.cpuCount} cores`}
                secondary={`load ${sys.load1.toFixed(2)}`}
              />
              <ResourceCard
                icon={MemoryStick}
                label="Memory"
                pct={sys.memPct}
                primary={`${formatBytes(sys.memUsed)} / ${formatBytes(sys.memTotal)}`}
                secondary={`rss ${formatBytes(sys.rss)}`}
              />
              <ResourceCard
                icon={HardDrive}
                label="Storage"
                pct={sys.diskPct}
                primary={sys.diskTotal > 0
                  ? `${formatBytes(sys.diskUsed)} / ${formatBytes(sys.diskTotal)}`
                  : 'unavailable'}
              />
            </div>
          ) : (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">No metrics</CardContent></Card>
          )}
        </section>

        {/* ─── Queues ─────────────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Layers size={12} /> Queues
            </h2>
            {!loaded && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
          </div>
          {!loaded ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : queues.length === 0 ? (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">No queues reporting</CardContent></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {queues.map((q) => <QueueCard key={q.name} q={q} />)}
            </div>
          )}
        </section>

        {/* ─── Connected users ────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Users size={12} /> Connected ({users.length})
            </h2>
            {users.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                {modes.wasm   ? <span className="text-emerald-400">{modes.wasm} wasm</span> : null}
                {modes.server ? <span className="text-primary">{modes.server} server</span> : null}
                {modes.mixed  ? <span className="text-amber-400">{modes.mixed} mixed</span> : null}
                {modes.unknown ? <span>{modes.unknown} idle</span> : null}
              </div>
            )}
          </div>
          {!loaded ? (
            <Card><CardContent className="space-y-2 py-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}
            </CardContent></Card>
          ) : users.length === 0 ? (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">Nobody online right now</CardContent></Card>
          ) : (
            <Card>
              {/* Desktop header */}
              <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_minmax(0,1fr)_auto] gap-3 border-b border-border px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:grid">
                <span>User</span>
                <span className="text-center">Plan</span>
                <span className="text-center">Mode</span>
                <span>Engine</span>
                <span className="text-right">Connected</span>
              </div>
              <div className={cn('divide-y divide-border')}>
                {users.map((u) => <UserRow key={u.userId} u={u} />)}
              </div>
            </Card>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
