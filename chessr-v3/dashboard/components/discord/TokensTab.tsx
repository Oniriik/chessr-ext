'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { authQS, DiscordTag, Pagination, timeAgo, useDiscordUsernames } from './wheel-shared';

interface TokenRow {
  id: number;
  owner_discord_id: string;
  source: 'boost' | 'purchase' | 'admin_grant';
  external_ref: string | null;
  earned_at: string;
  spun_at: string | null;
  reward_id: number | null;
}

const LIMIT = 50;

export function TokensTab() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState<'all' | 'boost' | 'purchase' | 'admin_grant'>('all');
  const [status, setStatus] = useState<'all' | 'unspun' | 'spun'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const qs = new URLSearchParams();
      qs.set('limit', String(LIMIT));
      qs.set('offset', String(offset));
      if (source !== 'all') qs.set('source', source);
      if (status !== 'all') qs.set('status', status);
      if (search.trim()) qs.set('discordId', search.trim());
      qs.set('token', decodeURIComponent(t));
      const res = await fetch(`/api/admin/wheel/tokens?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.tokens ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  // Reload on filter / pagination change. Reset offset when filters
  // change so the user doesn't end up past the new total.
  useEffect(() => { setOffset(0); }, [source, status, search]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [offset, source, status]);
  // Search is on submit (Enter) — too many requests if we fire on every keystroke.

  const usernames = useDiscordUsernames(rows.map((r) => r.owner_discord_id));

  return (
    <div className="space-y-3">
      {/* ─── Filter bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] capitalize"
        >
          <option value="all">All sources</option>
          <option value="boost">boost</option>
          <option value="purchase">purchase</option>
          <option value="admin_grant">admin grant</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] capitalize"
        >
          <option value="all">Any status</option>
          <option value="unspun">unspun</option>
          <option value="spun">spun</option>
        </select>
        <form
          onSubmit={(e) => { e.preventDefault(); setOffset(0); load(); }}
          className="flex flex-1 items-center gap-1 sm:flex-none sm:w-64"
        >
          <Input
            placeholder="Filter by Discord ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-[12px]"
          />
        </form>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8 gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </Button>
      </div>

      {/* ─── Body ───────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {loading ? 'Loading…' : 'No tokens match.'}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-[12px]">
                  <thead className="border-b border-border/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Owner</th>
                      <th className="px-3 py-2 text-left">Source</th>
                      <th className="px-3 py-2 text-left">External ref</th>
                      <th className="px-3 py-2 text-left">Earned</th>
                      <th className="px-3 py-2 text-left">Spun</th>
                      <th className="px-3 py-2 text-left">Reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/30 hover:bg-muted/40">
                        <td className="px-3 py-2"><DiscordTag id={r.owner_discord_id} username={usernames[r.owner_discord_id]} /></td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={r.source === 'boost' ? 'default' : r.source === 'admin_grant' ? 'success' : 'warning'}
                            className="px-1.5 py-0.5 text-[10px] capitalize"
                          >
                            {r.source.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {r.external_ref ?? '—'}
                        </td>
                        <td className="num px-3 py-2 text-muted-foreground">{timeAgo(r.earned_at)}</td>
                        <td className="num px-3 py-2 text-muted-foreground">{timeAgo(r.spun_at)}</td>
                        <td className="num px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {r.reward_id ? `#${r.reward_id}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <ul className="divide-y divide-border/30 md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="space-y-1 p-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <DiscordTag id={r.owner_discord_id} username={usernames[r.owner_discord_id]} />
                      <Badge variant={r.source === 'boost' ? 'default' : r.source === 'admin_grant' ? 'success' : 'warning'}
                        className="px-1.5 py-0.5 text-[10px] capitalize">
                        {r.source.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>earned {timeAgo(r.earned_at)}</span>
                      <span>{r.spun_at ? `spun ${timeAgo(r.spun_at)}` : 'unspun'}</span>
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
