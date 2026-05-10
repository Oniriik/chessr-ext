'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, Plus, RefreshCw, Ticket, Users } from 'lucide-react';
import { format } from 'date-fns';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authQS, type Giveaway, StatusBadge } from '@/components/discord/giveaway-shared';

function relTime(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const min = Math.floor(abs / 60_000);
  const future = ms > 0;
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
  const days = Math.floor(h / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

export default function GiveawaysPage() {
  const [rows, setRows] = useState<Giveaway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways?token=${t}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.giveaways ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <AdminShell
      title="Giveaways"
      actions={
        <Link
          href="/discord/giveaways/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={13} /> New giveaway
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            {loading ? 'Loading…' : `${rows.length} giveaway${rows.length === 1 ? '' : 's'}`}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-7 gap-1.5">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {!loading && rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Ticket size={28} className="text-muted-foreground" />
              <div className="text-sm font-medium">No giveaways yet</div>
              <div className="text-xs text-muted-foreground">
                Create one to start collecting tickets.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((g) => (
              <Link
                key={g.id}
                href={`/discord/giveaways/${g.id}`}
                className="block rounded-md border border-border bg-card/40 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{g.name}</div>
                    <div className="num mt-0.5 text-[10px] text-muted-foreground">
                      {format(new Date(g.ends_at), 'PP p')} · {relTime(g.ends_at)}
                    </div>
                  </div>
                  <StatusBadge status={g.status} />
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="num inline-flex items-center gap-1 tabular-nums">
                    <Ticket size={11} /> {g.tickets ?? 0}
                  </span>
                  <span className="num inline-flex items-center gap-1 tabular-nums">
                    <Users size={11} /> {g.prize_count ?? 0} prizes
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
