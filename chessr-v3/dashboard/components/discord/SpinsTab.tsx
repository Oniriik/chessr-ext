'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authQS, DiscordTag, PathBadge, Pagination, RewardChip, timeAgo } from './wheel-shared';

interface SpinRow {
  id: number;
  spun_by_discord_id: string;
  owner_discord_id: string;
  reward_kind: 'days' | 'lifetime';
  reward_days: number | null;
  spun_at: string;
  claimed_at: string | null;
  reward_path: string | null;
}

const LIMIT = 50;

export function SpinsTab() {
  const [rows, setRows] = useState<SpinRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState<'all' | 'days' | 'lifetime'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const t = await authQS();
      const qs = new URLSearchParams();
      qs.set('limit', String(LIMIT));
      qs.set('offset', String(offset));
      if (kind !== 'all') qs.set('kind', kind);
      if (search.trim()) qs.set('discordId', search.trim());
      qs.set('token', decodeURIComponent(t));
      const res = await fetch(`/api/admin/wheel/spins?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.spins ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { setOffset(0); }, [kind, search]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [offset, kind]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px]">
          <option value="all">All kinds</option>
          <option value="days">days</option>
          <option value="lifetime">lifetime</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setOffset(0); load(); }} className="flex flex-1 sm:flex-none sm:w-64">
          <Input placeholder="Filter by spinner Discord ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-[12px]" />
        </form>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8 gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{loading ? 'Loading…' : 'No spins.'}</div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-[12px]">
                  <thead className="border-b border-border/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Reward</th>
                      <th className="px-3 py-2 text-left">Spinner</th>
                      <th className="px-3 py-2 text-left">Current owner</th>
                      <th className="px-3 py-2 text-left">Outcome</th>
                      <th className="px-3 py-2 text-left">Spun</th>
                      <th className="px-3 py-2 text-left">Claim status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/30 hover:bg-muted/40">
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">#{r.id}</td>
                        <td className="px-3 py-2"><DiscordTag id={r.spun_by_discord_id} /></td>
                        <td className="px-3 py-2">
                          {r.owner_discord_id === r.spun_by_discord_id
                            ? <span className="text-muted-foreground">— same</span>
                            : <DiscordTag id={r.owner_discord_id} />}
                        </td>
                        <td className="px-3 py-2"><RewardChip kind={r.reward_kind} days={r.reward_days} /></td>
                        <td className="num px-3 py-2 text-muted-foreground">{timeAgo(r.spun_at)}</td>
                        <td className="px-3 py-2">
                          {r.claimed_at
                            ? <span className="flex items-center gap-1 text-emerald-400">claimed · <PathBadge path={r.reward_path} /></span>
                            : <span className="text-amber-400">in inventory</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border/30 md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="space-y-1 p-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">#{r.id}</span>
                      <RewardChip kind={r.reward_kind} days={r.reward_days} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span>spinner: <DiscordTag id={r.spun_by_discord_id} /></span>
                      <span className="text-muted-foreground">{timeAgo(r.spun_at)}</span>
                    </div>
                    <div className="text-[10px]">
                      {r.claimed_at
                        ? <span className="text-emerald-400">claimed · {r.reward_path}</span>
                        : <span className="text-amber-400">in inventory of <DiscordTag id={r.owner_discord_id} /></span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Pagination total={total} offset={offset} limit={LIMIT} loading={loading} onChange={setOffset} />
    </div>
  );
}
