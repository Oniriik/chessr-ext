'use client';

import { useEffect, useState } from 'react';
import {
  ChevronDown, Crown, Gift, Loader2, Plus, RefreshCw, Ticket, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/roles';
import { DiscordTag, useDiscordUsernames } from '@/components/discord/wheel-shared';

interface InventoryToken {
  id: number;
  source: 'boost' | 'purchase' | 'admin_grant';
  earned_at: string;
}

interface InventoryReward {
  id: number;
  reward_kind: 'days' | 'lifetime';
  reward_days: number | null;
  spun_at: string;
  spun_by_discord_id: string;
  gifted_from_discord_id: string | null;
  gifted_at: string | null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

async function getToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export function BoostInventory({
  discordId,
  callerRole,
}: {
  discordId: string | null;
  callerRole: UserRole;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<InventoryToken[]>([]);
  const [rewards, setRewards] = useState<InventoryReward[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Grant flow state.
  const [granting, setGranting] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantCount, setGrantCount] = useState<number>(1);
  const [grantReason, setGrantReason] = useState('');
  const [grantError, setGrantError] = useState<string | null>(null);

  // Revoke pending state per-token.
  const [revokingId, setRevokingId] = useState<number | null>(null);

  async function load() {
    if (!discordId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/admin/wheel/inventory?discordId=${encodeURIComponent(discordId)}&token=${encodeURIComponent(token ?? '')}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTokens(json.tokens ?? []);
      setRewards(json.rewards ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  // Eager load on mount so the count chip in the header is accurate
  // before the user expands. Cheap query — partial indexes make it
  // sub-ms even at scale.
  useEffect(() => {
    if (discordId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discordId]);

  if (!discordId) {
    return (
      <div className="rounded-md border border-border bg-background/40 px-3 py-2.5 text-[12px] text-muted-foreground">
        🎒 Inventory unavailable — Discord not linked.
      </div>
    );
  }

  const isSuper = callerRole === 'super_admin';
  const counts = `${tokens.length} token${tokens.length === 1 ? '' : 's'} · ${rewards.length} reward${rewards.length === 1 ? '' : 's'}`;
  // Resolve gifted-from handles for the "gifted by @user" labels.
  const usernames = useDiscordUsernames(rewards.map((r) => r.gifted_from_discord_id));

  async function doGrant() {
    setGranting(true);
    setGrantError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/wheel/token/grant?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId, count: grantCount, reason: grantReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGrantOpen(false);
      setGrantCount(1);
      setGrantReason('');
      await load();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'Grant failed');
    } finally {
      setGranting(false);
    }
  }

  async function doRevoke(tokenId: number) {
    setRevokingId(tokenId);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/wheel/token/revoke?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="rounded-md border border-border bg-background/40">
      {/* ─── Header / toggle ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[12px] font-medium hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Ticket size={13} className="text-muted-foreground" />
          Inventory
          <Badge variant="muted" className="px-1.5 py-0.5 text-[10px]">{counts}</Badge>
        </span>
        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* ─── Body ───────────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-3 border-t border-border/50 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {loading ? 'Loading…' : counts}
            </div>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-6 gap-1 px-2 text-[11px]">
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </div>
          )}

          {/* ─── Tokens ──────────────────────────────────────────── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium">🎟️ Spin Tokens ({tokens.length})</span>
              {isSuper && !grantOpen && (
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => setGrantOpen(true)}>
                  <Plus size={11} /> Grant
                </Button>
              )}
            </div>
            {tokens.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No tokens.</div>
            ) : (
              <ul className="space-y-1">
                {tokens.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded border border-border/50 bg-background/40 px-2 py-1 text-[11px]"
                  >
                    <Badge
                      variant={t.source === 'boost' ? 'default' : t.source === 'admin_grant' ? 'success' : 'warning'}
                      className="h-4 px-1.5 text-[9px] capitalize"
                    >
                      {t.source.replace('_', ' ')}
                    </Badge>
                    <span className="text-muted-foreground">earned {timeAgo(t.earned_at)}</span>
                    <span className="ml-auto" />
                    {isSuper && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                        title="Revoke this token"
                        onClick={() => doRevoke(t.id)}
                        disabled={revokingId === t.id}
                      >
                        {revokingId === t.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* ─── Inline grant form ─────────────────────────────── */}
            {grantOpen && isSuper && (
              <div className="mt-2 space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                <div className="text-[11px] font-medium text-emerald-400">Grant tokens</div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={grantCount}
                    onChange={(e) => setGrantCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    className="h-7 w-20 text-[11px]"
                    disabled={granting}
                  />
                  <span className="text-[11px] text-muted-foreground">×</span>
                  <Input
                    type="text"
                    placeholder="Reason (required)"
                    value={grantReason}
                    onChange={(e) => setGrantReason(e.target.value)}
                    className="h-7 flex-1 text-[11px]"
                    disabled={granting}
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={doGrant} disabled={granting || !grantReason.trim()} className="h-6 gap-1 px-2 text-[11px]">
                    {granting ? <Loader2 size={11} className="animate-spin" /> : 'Grant'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setGrantOpen(false); setGrantError(null); }} disabled={granting} className="h-6 px-2 text-[11px]">
                    Cancel
                  </Button>
                </div>
                {grantError && (
                  <div className="text-[10px] text-destructive">{grantError}</div>
                )}
              </div>
            )}
          </div>

          {/* ─── Rewards ─────────────────────────────────────────── */}
          <div>
            <div className="mb-1 text-[11px] font-medium">🎁 Rewards ({rewards.length})</div>
            {rewards.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No rewards.</div>
            ) : (
              <ul className="space-y-1">
                {rewards.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded border border-border/50 bg-background/40 px-2 py-1 text-[11px]"
                  >
                    {r.reward_kind === 'lifetime' ? (
                      <Crown size={11} className="text-amber-400" />
                    ) : (
                      <Gift size={11} className="text-blue-400" />
                    )}
                    <span className="font-medium">
                      {r.reward_kind === 'lifetime' ? 'Lifetime' : `${r.reward_days} days`}
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      {r.gifted_from_discord_id ? (
                        <>
                          gifted by{' '}
                          <DiscordTag
                            id={r.gifted_from_discord_id}
                            username={usernames[r.gifted_from_discord_id]}
                          />
                          {' '}· {timeAgo(r.gifted_at ?? r.spun_at)}
                        </>
                      ) : (
                        <>won {timeAgo(r.spun_at)}</>
                      )}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">#{r.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!isSuper && (
            <div className="text-[10px] text-muted-foreground">
              Grant / revoke tokens require super_admin.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
