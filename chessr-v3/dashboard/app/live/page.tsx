'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Cpu, MemoryStick, HardDrive, Users, Layers, AlertCircle, Loader2,
  Activity, Zap, ServerCog, Cloud, RotateCw,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatBytes, formatRelative } from '@/lib/utils';
import { planBadgeStyle } from '@/lib/plan-colors';

// ─── Types ─────────────────────────────────────────────────────────────
type Sample = {
  cpuPct: number;
  memUsed: number; memTotal: number; memPct: number;
  rss: number;
  load1: number; cpuCount: number;
  diskUsed: number; diskTotal: number; diskPct: number;
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

// ─── Resource card — big readout + progress bar ─────────────────────────
function ResourceCard({
  icon: Icon,
  label,
  pct,
  primary,
  secondary,
  hint,
}: {
  icon: typeof Cpu;
  label: string;
  pct: number;
  primary: string;
  secondary?: string;
  hint?: string;
}) {
  const tier = pct < 70 ? 'emerald' : pct < 85 ? 'amber' : 'red';
  const tierColor =
      tier === 'emerald' ? 'text-emerald-400'
    : tier === 'amber'   ? 'text-amber-400'
    : 'text-red-400';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card className="card-glow group cursor-default transition-all hover:translate-y-[-1px] hover:shadow-[0_16px_40px_-20px_rgba(0,0,0,0.6)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset',
                  tier === 'emerald' ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
                  : tier === 'amber' ? 'bg-amber-500/10 text-amber-400 ring-amber-500/20'
                  : 'bg-red-500/10 text-red-400 ring-red-500/20',
                )}>
                  <Icon size={14} strokeWidth={2.2} />
                </div>
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {label}
                </span>
              </div>
              <span className={cn('num text-2xl font-semibold tracking-tight sm:text-3xl', tierColor)}>
                {pct.toFixed(0)}<span className="text-base font-medium opacity-70">%</span>
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <Progress value={pct} className="h-2 bg-secondary/60" />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{primary}</span>
              {secondary && <span className="num text-muted-foreground">{secondary}</span>}
            </div>
          </CardContent>
        </Card>
      </TooltipTrigger>
      {hint && <TooltipContent>{hint}</TooltipContent>}
    </Tooltip>
  );
}

// ─── Queue card — name + active/waiting with subtle pulse on active ─────
function QueueCard({ q }: { q: QueueData }) {
  const busy = q.counts.active > 0 || q.counts.waiting > 0;
  return (
    <Card className="card-elevated transition-colors hover:bg-card/80">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex h-6 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              'h-2 w-2 rounded-full',
              busy ? 'bg-primary pulse-dot' : 'bg-muted-foreground/40',
            )} />
            <span className="text-[13px] font-semibold capitalize">{q.name}</span>
          </div>
          {q.counts.failed > 0 && (
            <Badge variant="destructive" className="px-2 py-1 text-[10px]">
              {q.counts.failed} failed
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active</div>
            <div className="num mt-1 text-lg font-semibold leading-none tabular-nums">
              {q.counts.active}
            </div>
          </div>
          <div className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Waiting</div>
            <div className={cn(
              'num mt-1 text-lg font-semibold leading-none tabular-nums',
              q.counts.waiting > 0 ? 'text-amber-400' : '',
            )}>
              {q.counts.waiting}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Plan + mode badges ─────────────────────────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  return (
    <Badge className="border-transparent capitalize" style={planBadgeStyle(plan)}>
      {plan}
    </Badge>
  );
}

function ModeBadge({ mode }: { mode: ConnectedUser['mode'] }) {
  const cfg = (() => {
    switch (mode) {
      case 'wasm':   return { label: 'WASM',   icon: Zap,       cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' };
      case 'server': return { label: 'Server', icon: ServerCog, cls: 'border-primary/30 bg-primary/10 text-primary' };
      case 'mixed':  return { label: 'Mixed',  icon: Cloud,     cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' };
      default:       return { label: 'Idle',   icon: Activity,  cls: 'border-border bg-muted text-muted-foreground' };
    }
  })();
  const Icon = cfg.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium',
      cfg.cls,
    )}>
      <Icon size={10} strokeWidth={2.2} />
      {cfg.label}
    </span>
  );
}

// ─── User row (responsive: stacks on mobile, row on desktop) ────────────
function UserRow({ u, last }: { u: ConnectedUser; last?: boolean }) {
  const initial = (u.email?.[0] ?? u.userId[0] ?? '?').toUpperCase();
  const sLabel = u.lastSuggestion?.engine ?? '—';
  const aLabel = u.lastAnalysis?.engine ?? '—';
  const display = u.email ?? `${u.userId.slice(0, 8)}…`;

  return (
    <div className={cn(
      'flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4',
      !last && 'border-b border-border/40',
    )}>
      <Avatar className="h-8 w-8 bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary">
        <AvatarFallback className="bg-transparent text-[10px] text-primary">{initial}</AvatarFallback>
      </Avatar>

      {/* Identity + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="truncate text-[13px] font-medium" title={u.email ?? u.userId}>
            {display}
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <PlanBadge plan={u.plan} />
            <ModeBadge mode={u.mode} />
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="num">{formatRelative(u.connectedAt)}</span>
          <span className="opacity-50">•</span>
          <span className="truncate">
            sug: <span className="text-foreground/80">{sLabel}</span>
            {' · '}
            ana: <span className="text-foreground/80">{aLabel}</span>
          </span>
        </div>
      </div>

      {/* Right side — desktop only */}
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <PlanBadge plan={u.plan} />
        <ModeBadge mode={u.mode} />
      </div>
    </div>
  );
}

// Format `lastUpdate` as a live "Xs ago" / "Xm ago" string. We use the
// `now` argument (re-rendered by a 1s ticker — see useNow below) so the
// label keeps ticking even when lastUpdate doesn't change between fetches.
function formatAgo(ts: number, now: number): string {
  if (!ts) return '—';
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 5)  return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function formatClock(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ─── Compact KPI strip at the top — quick glance bar ────────────────────
function KpiStrip({
  connected, modes, queueBusy, lastUpdate, now,
}: {
  connected: number;
  modes: Record<string, number>;
  queueBusy: number;
  lastUpdate: number;
  now: number;
}) {
  return (
    <Card className="card-elevated">
      <div className="flex flex-wrap items-stretch divide-y divide-border/40 sm:divide-x sm:divide-y-0">
        <div className="flex-1 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Users size={11} /> Connected
          </div>
          <div className="num mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight">{connected}</span>
            <span className="text-[11px] text-muted-foreground">live</span>
          </div>
        </div>

        <div className="flex-1 px-4 py-4 sm:px-6">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mode breakdown
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {modes.wasm   ? <span className="num inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400"><Zap size={10} /> {modes.wasm}</span> : null}
            {modes.server ? <span className="num inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary"><ServerCog size={10} /> {modes.server}</span> : null}
            {modes.mixed  ? <span className="num inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400"><Cloud size={10} /> {modes.mixed}</span> : null}
            {modes.unknown ? <span className="num inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"><Activity size={10} /> {modes.unknown}</span> : null}
            {Object.keys(modes).length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
          </div>
        </div>

        <div className="flex-1 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers size={11} /> Queue load
          </div>
          <div className="num mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight">{queueBusy}</span>
            <span className="text-[11px] text-muted-foreground">jobs in-flight</span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <RotateCw size={11} /> Last refresh
            </div>
            <div className="num mt-2 flex items-baseline gap-2 tabular-nums">
              <span className="text-[13px] font-medium">{formatClock(lastUpdate)}</span>
              <span className="text-[11px] text-muted-foreground">{formatAgo(lastUpdate, now)}</span>
            </div>
          </div>
          <span className="relative ml-4 inline-block h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
        </div>
      </div>
    </Card>
  );
}

// 1-second ticker for relative-time labels ("3s ago"). Decoupled from
// the 5s data fetch so the ago-counter ticks smoothly even when no new
// data arrives.
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ─── Page ──────────────────────────────────────────────────────────────
export default function LivePage() {
  const [sys, setSys] = useState<Sample | null>(null);
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [queues, setQueues] = useState<QueueData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const now = useNow();

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
        setLastUpdate(Date.now());
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

  const modes = useMemo(() => users.reduce(
    (acc, u) => { acc[u.mode] = (acc[u.mode] ?? 0) + 1; return acc; },
    {} as Record<ConnectedUser['mode'], number>,
  ), [users]);

  const queueBusy = useMemo(
    () => queues.reduce((s, q) => s + q.counts.active + q.counts.waiting, 0),
    [queues],
  );

  return (
    <AdminShell title="Live">
      <TooltipProvider delayDuration={250}>
        <div className="space-y-6">
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* ─── Top KPI strip ───────────────────────────────────────── */}
          {loaded ? (
            <KpiStrip
              connected={users.length}
              modes={modes}
              queueBusy={queueBusy}
              lastUpdate={lastUpdate}
              now={now}
            />
          ) : (
            <Skeleton className="h-[78px] w-full" />
          )}

          {/* ─── Resources ───────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Resources
              {!loaded && <Loader2 size={10} className="animate-spin" />}
            </h2>
            {!loaded ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 sm:h-32" />)}
              </div>
            ) : sys ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <ResourceCard
                  icon={Cpu}
                  label="CPU"
                  pct={sys.cpuPct}
                  primary={`${sys.cpuCount} cores · load ${sys.load1.toFixed(2)}`}
                  hint="System-wide CPU usage. load 1m shows scheduler pressure."
                />
                <ResourceCard
                  icon={MemoryStick}
                  label="Memory"
                  pct={sys.memPct}
                  primary={`${formatBytes(sys.memUsed)} / ${formatBytes(sys.memTotal)}`}
                  secondary={`rss ${formatBytes(sys.rss)}`}
                  hint="Host RAM (rss = serveur process resident)."
                />
                <ResourceCard
                  icon={HardDrive}
                  label="Storage"
                  pct={sys.diskPct}
                  primary={sys.diskTotal > 0
                    ? `${formatBytes(sys.diskUsed)} / ${formatBytes(sys.diskTotal)}`
                    : 'unavailable'}
                  hint="Root filesystem usage."
                />
              </div>
            ) : (
              <Card><CardContent className="py-6 text-sm text-muted-foreground">No metrics</CardContent></Card>
            )}
          </section>

          {/* ─── Queues ──────────────────────────────────────────────── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Layers size={12} /> Queues
              </h2>
              <span className="num text-[11px] text-muted-foreground">{queues.length} pools</span>
            </div>
            {!loaded ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[110px]" />)}
              </div>
            ) : queues.length === 0 ? (
              <Card><CardContent className="py-6 text-sm text-muted-foreground">No queues reporting</CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {queues.map((q) => <QueueCard key={q.name} q={q} />)}
              </div>
            )}
          </section>

          {/* ─── Connected users ─────────────────────────────────────── */}
          <section>
            <div className="mb-3 flex items-end justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Users size={12} /> Connected
                <Badge variant="muted" className="px-2 py-1 text-[10px]">{users.length}</Badge>
              </h2>
            </div>
            {!loaded ? (
              <Card><CardContent className="space-y-2 py-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
              </CardContent></Card>
            ) : users.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                  <Users size={24} className="opacity-30" />
                  <span>Nobody online right now.</span>
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <ScrollArea className={cn('w-full', users.length > 8 && 'h-[460px]')}>
                  <div>
                    {users.map((u, i) => (
                      <UserRow key={u.userId} u={u} last={i === users.length - 1} />
                    ))}
                  </div>
                </ScrollArea>
              </Card>
            )}
          </section>

          <Separator className="my-6 opacity-40" />

          <p className="text-center text-[10px] text-muted-foreground/60">
            Auto-refresh every 5s · Resources from <code className="rounded bg-muted px-1 py-1 text-[9px]">/admin/metrics</code>
          </p>
        </div>
      </TooltipProvider>
    </AdminShell>
  );
}
