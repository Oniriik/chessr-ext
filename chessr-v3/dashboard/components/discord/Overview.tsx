'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Crown, Gift, Loader2, Sparkles, Ticket } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { authQS, timeAgo } from './wheel-shared';

interface Stats {
  tokensTotal: number;
  tokensUnspun: number;
  spinsTotal: number;
  claimsTotal: number;
  lifetimePending: number;
  lifetimeWonAll: number;
  distribution: { reward_kind: 'days' | 'lifetime'; reward_days: number | null; count: number }[];
}

interface ActivityEvent {
  id: string;
  type: string;
  created_at: string;
  payload: Record<string, unknown>;
}

function activityLine(ev: ActivityEvent): string {
  const p = ev.payload;
  const did = (p as { discordId?: string }).discordId ?? '?';
  switch (ev.type) {
    case 'wheel_token_earned':
      if ((p as { revoked?: boolean }).revoked) return `Token revoked from <@${did}> (${(p as { source?: string }).source ?? '?'})`;
      return `Token earned by <@${did}> · source=${(p as { source?: string }).source ?? '?'}`;
    case 'wheel_spin': {
      const k = (p as { rewardKind?: string }).rewardKind;
      const d = (p as { rewardDays?: number }).rewardDays;
      if (k === 'lifetime') return `🌟 <@${did}> won LIFETIME`;
      return `<@${did}> spun ${d} days`;
    }
    case 'wheel_gift': {
      const from = (p as { fromDiscordId?: string }).fromDiscordId;
      const to = (p as { toDiscordId?: string }).toDiscordId;
      return `🎁 <@${from}> gifted reward to <@${to}>`;
    }
    case 'wheel_claim': {
      const k = (p as { rewardKind?: string }).rewardKind;
      const d = (p as { rewardDays?: number }).rewardDays;
      const path = (p as { rewardPath?: string }).rewardPath;
      return `<@${did}> claimed ${k === 'lifetime' ? 'LIFETIME' : `${d} days`} (${path})`;
    }
    default:
      return ev.type;
  }
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const t = await authQS();
        const [s, a] = await Promise.all([
          fetch(`/api/admin/wheel/stats?token=${t}`).then((r) => r.json()),
          fetch(`/api/admin/wheel/activity?token=${t}&limit=20`).then((r) => r.json()),
        ]);
        if (s.error) throw new Error(s.error);
        setStats(s);
        setActivity(a.events ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</CardContent></Card>;
  }
  if (error || !stats) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-destructive">
          <AlertCircle size={14} /> {error ?? 'Failed to load stats'}
        </CardContent>
      </Card>
    );
  }

  const totalSpins = stats.spinsTotal;

  return (
    <div className="space-y-4">
      {/* ─── KPI cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI icon={Ticket}    label="Tokens minted"   value={stats.tokensTotal}    sub={`${stats.tokensUnspun} unspun`} />
        <KPI icon={Sparkles}  label="Spins"           value={stats.spinsTotal}     sub={`all-time`} />
        <KPI icon={Gift}      label="Claims applied"  value={stats.claimsTotal}    sub={`paddle + dashboard`} />
        <KPI icon={Crown}     label="Lifetime won"    value={stats.lifetimeWonAll} sub={stats.lifetimePending > 0 ? `${stats.lifetimePending} pending` : 'none pending'} alert={stats.lifetimePending > 0} />
      </div>

      {/* ─── Distribution + Activity ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-4 sm:p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Outcome distribution
            </div>
            {totalSpins === 0 ? (
              <div className="text-[12px] text-muted-foreground">No spins yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {stats.distribution.map((d, i) => {
                  const label = d.reward_kind === 'lifetime' ? '🌟 Lifetime' : `🎁 ${d.reward_days} days`;
                  const pct = (d.count / totalSpins) * 100;
                  return (
                    <li key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate">{label}</span>
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/50">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/70 transition-[width]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="num w-12 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                      <span className="num w-12 text-right tabular-nums">{d.count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4 sm:p-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </div>
            {activity.length === 0 ? (
              <div className="text-[12px] text-muted-foreground">No events yet.</div>
            ) : (
              <ul className="space-y-1 text-[11px]">
                {activity.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="num w-12 shrink-0 text-muted-foreground tabular-nums">{timeAgo(e.created_at)}</span>
                    <span className="font-mono break-all">{activityLine(e)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({
  icon: Icon, label, value, sub, alert,
}: {
  icon: typeof Ticket;
  label: string;
  value: number;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? 'border-amber-500/40' : ''}>
      <CardContent className="space-y-1 p-3 sm:p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon size={11} /> {label}
        </div>
        <div className="num text-2xl font-semibold tracking-tight tabular-nums">{value.toLocaleString()}</div>
        <div className={`num text-[10px] ${alert ? 'text-amber-400' : 'text-muted-foreground'}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}
