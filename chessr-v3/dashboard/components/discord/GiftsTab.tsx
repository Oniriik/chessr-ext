'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authQS, DiscordTag, Pagination, timeAgo, useDiscordUsernames } from './wheel-shared';

interface GiftEvent {
  id: string;
  created_at: string;
  payload: {
    rewardId?: number;
    fromDiscordId?: string;
    toDiscordId?: string;
  };
}

const LIMIT = 50;

export function GiftsTab() {
  const [rows, setRows] = useState<GiftEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
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
      if (search.trim()) qs.set('discordId', search.trim());
      qs.set('token', decodeURIComponent(t));
      const res = await fetch(`/api/admin/wheel/gifts?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.gifts ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { setOffset(0); }, [search]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [offset]);

  const usernames = useDiscordUsernames(
    rows.flatMap((g) => [g.payload.fromDiscordId, g.payload.toDiscordId]),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setOffset(0); load(); }} className="flex flex-1 sm:flex-none sm:w-72">
          <Input
            placeholder="Filter by Discord ID (sender or recipient)…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-[12px]"
          />
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
            <div className="p-6 text-center text-sm text-muted-foreground">{loading ? 'Loading…' : 'No gifts.'}</div>
          ) : (
            <ul className="divide-y divide-border/30">
              {rows.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-3 py-2.5 text-[12px] hover:bg-muted/40">
                  <DiscordTag id={g.payload.fromDiscordId} username={g.payload.fromDiscordId ? usernames[g.payload.fromDiscordId] : null} />
                  <ArrowRight size={12} className="text-muted-foreground" />
                  <DiscordTag id={g.payload.toDiscordId} username={g.payload.toDiscordId ? usernames[g.payload.toDiscordId] : null} />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    reward #{g.payload.rewardId}
                  </span>
                  <span className="num ml-auto text-[10px] text-muted-foreground tabular-nums">
                    {timeAgo(g.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Pagination total={total} offset={offset} limit={LIMIT} loading={loading} onChange={setOffset} />
    </div>
  );
}
