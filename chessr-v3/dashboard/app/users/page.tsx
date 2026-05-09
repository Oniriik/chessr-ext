'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight,
  Globe, Loader2, Search, Users as UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserDetailSheet } from '@/components/users/UserDetailSheet';
import { getSupabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/roles';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────
type UserRow = {
  user_id: string;
  email: string;
  joined_at: string;
  email_verified: boolean;
  plan: 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime';
  plan_expiry: string | null;
  freetrial_used: boolean;
  role: UserRole;
  banned: boolean;
  has_discord: boolean;
  linked_count: number;
};

type ListResponse = {
  users: UserRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────
function planVariant(plan: string): 'success' | 'default' | 'warning' | 'muted' {
  if (plan === 'lifetime') return 'success';
  if (plan === 'premium') return 'default';
  if (plan === 'beta' || plan === 'freetrial') return 'warning';
  return 'muted';
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  try { return format(new Date(ts), 'MMM d, yyyy'); }
  catch { return ts; }
}

const LIMIT = 25;
const PLAN_FILTERS = ['all', 'free', 'freetrial', 'premium', 'beta', 'lifetime'] as const;
type PlanFilter = typeof PLAN_FILTERS[number];

type SortKey = 'email' | 'joined_at' | 'plan' | 'plan_expiry';
type SortOrder = 'asc' | 'desc';

// ─── Page ──────────────────────────────────────────────────────────────
export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('joined_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<UserRole>('user');
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounce search → reset to page 1 on new query
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever the filter or sort changes.
  useEffect(() => { setPage(1); }, [planFilter, sortBy, sortOrder]);

  // Click a header → toggle order if same column, else sort by that column
  // descending (the sensible default for dates; for text it's ascending).
  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder(key === 'email' || key === 'plan' ? 'asc' : 'desc');
    }
  }

  // Caller's own role — drives super_admin-only UI in the sheet
  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      try {
        const res = await fetch('/api/auth/check-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: sess.session.user.id }),
        });
        const json = await res.json();
        if (json.role) setCallerRole(json.role as UserRole);
      } catch { /* keep default */ }
    })();
  }, []);

  // ─── Load list ──────────────────────────────────────────────────────
  const fetchSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const params = new URLSearchParams({
        token,
        page: String(page),
        limit: String(LIMIT),
        sortBy,
        sortOrder,
      });
      if (debounced) params.set('search', debounced);
      if (planFilter !== 'all') params.set('plan', planFilter);
      const res = await fetch(`/api/admin/users?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (seq !== fetchSeq.current) return; // stale response
      setData(json);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [page, debounced, planFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);

  // ─── Render ─────────────────────────────────────────────────────────
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const start = data ? (data.page - 1) * data.limit + 1 : 0;
  const end = data ? Math.min(data.page * data.limit, total) : 0;

  return (
    <AdminShell
      title="Users"
      actions={
        <Link
          href="/users/globe"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Country distribution"
          aria-label="Country distribution"
        >
          <Globe size={15} />
        </Link>
      }
    >
      <div className="space-y-4">
        {/* ─── Search bar + plan filter ─────────────────────────── */}
        <Card className="card-elevated">
          {/* CardContent ships `p-4 pt-0 sm:p-5 sm:pt-0` by default
              (assumes a preceding CardHeader). Override both breakpoints
              so top/bottom padding stays symmetrical. */}
          <CardContent className="space-y-2 p-3 sm:p-3">
            {/* Single flex-wrap row so search + chips + total share one
                line on desktop, but search takes full width on mobile and
                the rest wraps below. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email or user id…"
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {PLAN_FILTERS.map((p) => {
                  const active = planFilter === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlanFilter(p)}
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>

              <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <UsersIcon size={12} />
                <span className="num">
                  {loading && !data ? '—' : <><b className="text-foreground">{total.toLocaleString()}</b> total</>}
                </span>
              </div>
            </div>

            {/* Sort selector — mobile only (sortable column headers are
                hidden < sm). Single control combining key + direction. */}
            <div className="flex items-center gap-2 border-t border-border/40 pt-2 sm:hidden">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Sort
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="h-8 flex-1 rounded-md border border-border bg-background/40 px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="joined_at">Joined</option>
                <option value="email">Email</option>
                <option value="plan">Plan</option>
                <option value="plan_expiry">Expires</option>
              </select>
              <button
                type="button"
                onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortOrder === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
              </button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* ─── List ─────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          {/* Header — desktop only */}
          <div className="hidden border-b border-border/60 bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,2fr)_1.1fr_0.9fr_0.9fr_0.9fr]">
            <SortHeader label="User"    sortKey="email"       active={sortBy} order={sortOrder} onSort={onSort} />
            <SortHeader label="Plan"    sortKey="plan"        active={sortBy} order={sortOrder} onSort={onSort} />
            <SortHeader label="Joined"  sortKey="joined_at"   active={sortBy} order={sortOrder} onSort={onSort} />
            <SortHeader label="Expires" sortKey="plan_expiry" active={sortBy} order={sortOrder} onSort={onSort} />
            <span>Status</span>
          </div>

          {loading && !data ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : data && data.users.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No users match {debounced ? `"${debounced}"` : 'this filter'}.
            </div>
          ) : data && (
            <ul>
              {data.users.map((u) => (
                <UserListRow key={u.user_id} u={u} onOpen={() => setOpenId(u.user_id)} />
              ))}
            </ul>
          )}
        </Card>

        {/* ─── Pagination ───────────────────────────────────────── */}
        {data && total > 0 && (
          <div className="flex items-center justify-between gap-3 px-1 text-[12px]">
            <span className="num text-muted-foreground">
              {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || page <= 1}
              >
                <ChevronLeft size={14} /> Prev
              </Button>
              <span className="num text-muted-foreground">
                {data.page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={loading || page >= totalPages}
              >
                Next <ChevronRight size={14} />
              </Button>
              {loading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}
      </div>

      <UserDetailSheet
        userId={openId}
        open={!!openId}
        onClose={() => setOpenId(null)}
        callerRole={callerRole}
        onUpdated={load}
      />
    </AdminShell>
  );
}

// ─── Discord brand mark ───────────────────────────────────────────────
// Lucide ships no brand icons, so we draw the wumpus mark inline. Tiny
// (~700 bytes), and lets us toggle color via currentColor on the parent.
function DiscordIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// ─── Sort header ───────────────────────────────────────────────────────
function SortHeader({
  label, sortKey, active, order, onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  order: SortOrder;
  onSort: (k: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const Icon = !isActive ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        'flex items-center gap-1 text-left transition-colors',
        isActive ? 'text-foreground' : 'hover:text-foreground',
      )}
    >
      {label}
      <Icon size={10} className={cn('shrink-0', !isActive && 'opacity-40')} />
    </button>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────
// Two layouts in one component:
//  • mobile (<sm): two-line stack — email + plan top, meta + status bottom.
//    Targets ~56px tall so 6+ rows fit per screen.
//  • desktop (≥sm): the same 5-column grid as the table header.
function UserListRow({ u, onOpen }: { u: UserRow; onOpen: () => void }) {
  const expiring = u.plan_expiry ? new Date(u.plan_expiry).getTime() < Date.now() + 7 * 86400e3 : false;
  const shortId = u.user_id.slice(0, 8);

  return (
    <li
      onClick={onOpen}
      className={cn(
        'cursor-pointer border-b border-border/40 px-3 py-2.5 transition-colors',
        'odd:bg-background/30 hover:bg-muted/40',
        'sm:grid sm:grid-cols-[minmax(0,2fr)_1.1fr_0.9fr_0.9fr_0.9fr] sm:items-center sm:gap-3 sm:px-4 sm:py-3',
      )}
    >
      {/* ─── Mobile compact layout ─────────────────────────────── */}
      <div className="flex flex-col gap-1.5 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn('shrink-0', u.has_discord ? 'text-[#5865F2]' : 'text-muted-foreground/30')}
              title={u.has_discord ? 'Discord linked' : 'Discord not linked'}
            >
              <DiscordIcon size={13} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {u.email || '—'}
            </span>
          </span>
          <Badge variant={planVariant(u.plan)} className="shrink-0 capitalize">{u.plan}</Badge>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <code className="font-mono">{shortId}</code>
            <span className="opacity-50">·</span>
            <span className="num truncate">{fmt(u.joined_at)}</span>
            {u.plan_expiry && (
              <>
                <span className="opacity-50">·</span>
                <span className={cn('num truncate', expiring && 'text-amber-400')}>
                  exp {fmt(u.plan_expiry)}
                </span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {u.role !== 'user' && (
              <Badge variant={u.role === 'super_admin' ? 'destructive' : 'default'} className="px-1.5 py-0 text-[9px] capitalize">
                {u.role === 'super_admin' ? 'super' : u.role}
              </Badge>
            )}
            {!u.email_verified && (
              <Badge variant="warning" className="px-1.5 py-0 text-[9px]">unverified</Badge>
            )}
            {u.banned && <Badge variant="destructive" className="px-1.5 py-0 text-[9px]">banned</Badge>}
          </span>
        </div>
      </div>

      {/* ─── Desktop grid columns ──────────────────────────────── */}
      <div className="hidden min-w-0 sm:flex sm:items-center sm:gap-2">
        <span
          className={cn('shrink-0', u.has_discord ? 'text-[#5865F2]' : 'text-muted-foreground/30')}
          title={u.has_discord ? 'Discord linked' : 'Discord not linked'}
        >
          <DiscordIcon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{u.email || '—'}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{u.user_id}</div>
        </div>
      </div>

      <div className="hidden items-center gap-1.5 sm:flex">
        <Badge variant={planVariant(u.plan)} className="capitalize">{u.plan}</Badge>
        {u.role !== 'user' && (
          <Badge variant={u.role === 'super_admin' ? 'destructive' : 'default'} className="capitalize">
            {u.role.replace('_', ' ')}
          </Badge>
        )}
      </div>

      <div className="num hidden text-[11px] text-muted-foreground sm:block">{fmt(u.joined_at)}</div>

      <div className={cn(
        'num hidden text-[11px] sm:block',
        u.plan_expiry ? (expiring ? 'text-amber-400' : 'text-foreground/80') : 'text-muted-foreground',
      )}>
        {u.plan_expiry ? fmt(u.plan_expiry) : '—'}
      </div>

      <div className="hidden flex-wrap items-center gap-1 sm:flex">
        {u.email_verified ? (
          <Badge variant="success" className="px-1.5 py-0.5 text-[9px]">verified</Badge>
        ) : (
          <Badge variant="warning" className="px-1.5 py-0.5 text-[9px]">unverified</Badge>
        )}
        {u.freetrial_used && <Badge variant="muted" className="px-1.5 py-0.5 text-[9px]">trial</Badge>}
        {u.banned && <Badge variant="destructive" className="px-1.5 py-0.5 text-[9px]">banned</Badge>}
      </div>
    </li>
  );
}
