'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Crown, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { planBadgeStyle } from '@/lib/plan-colors';
import type { UserRole } from '@/lib/roles';

interface PendingReward {
  reward_id: number;
  spun_by_discord_id: string;
  owner_discord_id: string;
  spun_at: string;
  gifted_from_discord_id: string | null;
  gifted_at: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_plan: string | null;
  owner_paddle_subscription_id: string | null;
  owner_paddle_status: string | null;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function PendingLifetime({ callerRole }: { callerRole: UserRole }) {
  const [rows, setRows] = useState<PendingReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row state for the apply flow.
  const [confirming, setConfirming] = useState<number | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<{ id: number; msg: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('not authenticated');
      const res = await fetch(`/api/admin/wheel/pending-lifetime?token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.rewards ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const isSuper = callerRole === 'super_admin';

  async function applyLifetime(rewardId: number) {
    setApplying(rewardId);
    setApplyError(null);
    try {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/admin/wheel/apply-lifetime?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Optimistic remove from the list — refetch to be sure.
      setRows((prev) => prev.filter((r) => r.reward_id !== rewardId));
      setConfirming(null);
    } catch (err) {
      setApplyError({ id: rewardId, msg: err instanceof Error ? err.message : 'Apply failed' });
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">Pending Lifetime Claims</h2>
          {!loading && (
            <Badge variant={rows.length > 0 ? 'destructive' : 'muted'}>
              {rows.length}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle2 size={32} className="text-emerald-400" />
            <div className="text-sm font-medium">All clear</div>
            <div className="text-xs text-muted-foreground">No pending lifetime claims to process.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => {
            const isPaddleActive = !!r.owner_paddle_subscription_id && r.owner_paddle_status !== 'canceled';
            const isThisConfirming = confirming === r.reward_id;
            const isThisApplying = applying === r.reward_id;
            const errMsg = applyError?.id === r.reward_id ? applyError.msg : null;
            return (
              <Card key={r.reward_id} className="overflow-hidden">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  {/* ─── Header ───────────────────────────────────── */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Crown size={16} className="text-amber-400" />
                      <span className="text-sm font-semibold">Reward #{r.reward_id}</span>
                      <Badge variant="warning" className="ml-1">lifetime</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">won {timeAgo(r.spun_at)}</div>
                  </div>

                  {/* ─── Owner / Spinner details (grid) ──────────── */}
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Owner Discord</dt>
                      <dd className="font-medium">&lt;@{r.owner_discord_id}&gt;</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Chessr account</dt>
                      <dd className="font-medium">
                        {r.owner_email ?? <span className="text-amber-400">⚠ not linked</span>}
                      </dd>
                    </div>
                    {r.gifted_from_discord_id && (
                      <div className="sm:col-span-2">
                        <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Gift trail (last hop)</dt>
                        <dd>&lt;@{r.gifted_from_discord_id}&gt; → &lt;@{r.owner_discord_id}&gt; · {timeAgo(r.gifted_at)}</dd>
                      </div>
                    )}
                    {r.spun_by_discord_id !== r.owner_discord_id && (
                      <div className="sm:col-span-2">
                        <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Originally spun by</dt>
                        <dd>&lt;@{r.spun_by_discord_id}&gt;</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current plan</dt>
                      <dd>
                        {r.owner_plan ? (
                          <Badge className="border-transparent capitalize" style={planBadgeStyle(r.owner_plan)}>
                            {r.owner_plan}
                          </Badge>
                        ) : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Paddle</dt>
                      <dd>
                        {isPaddleActive ? (
                          <span className="text-amber-400">🟢 active sub will be cancelled</span>
                        ) : (
                          <span className="text-muted-foreground">none / inactive</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {/* ─── Action / confirm panel ───────────────────── */}
                  {!r.owner_user_id ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px]">
                      <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                      <span>
                        The current owner hasn't linked their Discord to a Chessr account.
                        Reach out via support before applying — we won't know which account
                        to upgrade.
                      </span>
                    </div>
                  ) : !isThisConfirming ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => setConfirming(r.reward_id)}
                        disabled={!isSuper}
                        title={!isSuper ? 'super_admin required' : undefined}
                      >
                        Apply lifetime
                      </Button>
                      {!isSuper && (
                        <span className="text-[11px] text-muted-foreground">
                          super_admin required to apply
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <div className="text-[12px] font-medium">Confirm lifetime application</div>
                      <ul className="space-y-1 text-[11px] text-muted-foreground">
                        <li>✓ Set <code>{r.owner_email ?? r.owner_user_id}</code> plan to <strong>lifetime</strong></li>
                        {isPaddleActive && (
                          <li>✓ Cancel their Paddle subscription <strong>immediately</strong> — <strong>no refund issued</strong></li>
                        )}
                        <li>✓ Mark reward #{r.reward_id} claimed (<code>reward_path = lifetime_set</code>)</li>
                        <li>✓ Emit <code>plan_changed</code> event for Discord role sync</li>
                      </ul>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" onClick={() => applyLifetime(r.reward_id)} disabled={isThisApplying}>
                          {isThisApplying ? <Loader2 size={13} className="animate-spin" /> : 'Confirm — apply lifetime'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={isThisApplying}>
                          Cancel
                        </Button>
                      </div>
                      {errMsg && (
                        <div className={cn(
                          'flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive',
                        )}>
                          <AlertCircle size={12} /> {errMsg}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
