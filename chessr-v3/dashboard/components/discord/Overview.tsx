'use client';

import { Fragment, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Crown, Gift, Loader2, Sparkles, Ticket, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { authQS, DiscordTag, timeAgo, useDiscordUsernames } from './wheel-shared';
import { TokenDropButton } from './TokenDropButton';

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

/** Pull every discord_id referenced by an event so the parent can
 *  batch-resolve handles for the whole feed in a single round-trip. */
function eventDiscordIds(ev: ActivityEvent): (string | undefined)[] {
  const p = ev.payload as Record<string, unknown>;
  return [
    p.discordId as string | undefined,
    p.fromDiscordId as string | undefined,
    p.toDiscordId as string | undefined,
  ];
}

/** Pretty-printed event line as JSX so DiscordTag can render handles
 *  (resolved via /admin/discord/usernames) instead of raw <@id>. */
function ActivityLine({
  ev, usernames,
}: {
  ev: ActivityEvent;
  usernames: Record<string, string | null>;
}) {
  const p = ev.payload as Record<string, unknown>;
  const did = p.discordId as string | undefined;
  const tag = (id?: string) => <DiscordTag id={id ?? null} username={id ? usernames[id] : null} />;

  switch (ev.type) {
    case 'wheel_token_earned': {
      const source = (p.source as string | undefined) ?? '?';
      if (p.revoked) return <Fragment>Token revoked from {tag(did)} ({source})</Fragment>;
      return <Fragment>Token earned by {tag(did)} · source={source}</Fragment>;
    }
    case 'wheel_spin': {
      const k = p.rewardKind as string | undefined;
      const d = p.rewardDays as number | undefined;
      if (k === 'lifetime') return <Fragment>🌟 {tag(did)} won LIFETIME</Fragment>;
      return <Fragment>{tag(did)} spun {d} days</Fragment>;
    }
    case 'wheel_gift': {
      const from = p.fromDiscordId as string | undefined;
      const to = p.toDiscordId as string | undefined;
      return (
        <Fragment>
          🎁 {tag(from)} <ArrowRight size={11} className="inline align-middle text-muted-foreground" /> {tag(to)}
        </Fragment>
      );
    }
    case 'wheel_claim': {
      const k = p.rewardKind as string | undefined;
      const d = p.rewardDays as number | undefined;
      const path = p.rewardPath as string | undefined;
      return (
        <Fragment>
          {tag(did)} claimed {k === 'lifetime' ? 'LIFETIME' : `${d} days`} ({path})
        </Fragment>
      );
    }
    default:
      return <Fragment>{ev.type}</Fragment>;
  }
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Batch-fetch every Discord handle referenced by the activity feed.
  // Cached at the module level in wheel-shared so re-renders / tab
  // switches don't re-hit the API.
  const allIds = activity.flatMap(eventDiscordIds);
  const usernames = useDiscordUsernames(allIds);

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
      {/* ─── Admin action: drop a token in the wheel channel ────────── */}
      <TokenDropButton />

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
                    <span className="break-all"><ActivityLine ev={e} usernames={usernames} /></span>
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
