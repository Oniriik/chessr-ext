'use client';

/** Helpers shared across the Wheel Spin admin tabs. Keeping styling
 *  bits + tiny helpers in one file so each tab component stays focused
 *  on its own filters + table. */

import { useEffect, useState } from 'react';
import { Crown, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Render a Discord ID. When `username` is provided (resolved via
 *  /admin/discord/usernames) we show the human-friendly handle. When
 *  not — typically because the user hasn't linked their Discord to a
 *  Chessr account — we fall back to a shortened `user #ABCD` (last 4
 *  of the Snowflake) with the full ID in a tooltip. The raw 19-digit
 *  mention is too long to read inline. */
export function DiscordTag({
  id, username,
}: {
  id: string | null | undefined;
  username?: string | null;
}) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  if (username) {
    return (
      <span className="font-medium" title={id}>
        @{username}
      </span>
    );
  }
  const short = id.length > 4 ? id.slice(-4) : id;
  return (
    <span className="font-mono text-[11px] text-muted-foreground" title={id}>
      user #{short}
    </span>
  );
}

/** Module-level cache so each tab swap doesn't re-fetch handles we
 *  already know. Keyed by Discord ID; null = known-unlinked. */
const usernameCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<void>>();

/** Hook: takes a list of Discord IDs (any falsy entries are ignored),
 *  fetches missing handles in a single batched request, and returns a
 *  map { discord_id → username | null }. Components render via
 *  <DiscordTag id={x} username={map[x]}/>. */
export function useDiscordUsernames(ids: (string | null | undefined)[]): Record<string, string | null> {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    const missing = unique.filter((id) => !usernameCache.has(id) && !inflight.has(id));
    if (missing.length === 0) return;

    const promise = (async () => {
      try {
        const t = await authQS();
        const url = `/api/admin/discord/usernames?ids=${encodeURIComponent(missing.join(','))}&token=${t}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = (await res.json()) as { usernames?: Record<string, string | null> };
        for (const id of missing) {
          usernameCache.set(id, json.usernames?.[id] ?? null);
        }
        setVersion((v) => v + 1);
      } finally {
        for (const id of missing) inflight.delete(id);
      }
    })();
    for (const id of missing) inflight.set(id, promise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  // Build the map fresh on each render — `version` triggers a re-run
  // after a fetch resolves. Only ever pulls from cache, never refetches.
  const map: Record<string, string | null> = {};
  for (const id of ids) {
    if (id) map[id] = usernameCache.get(id) ?? null;
  }
  // Reference `version` so React re-renders when cache updates.
  void version;
  return map;
}

export function RewardChip({
  kind, days, size = 'sm',
}: {
  kind: 'days' | 'lifetime';
  days?: number | null;
  size?: 'sm' | 'md';
}) {
  if (kind === 'lifetime') {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-400',
        size === 'md' ? 'text-[12px]' : 'text-[10px]',
      )}>
        <Crown size={size === 'md' ? 13 : 11} />
        Lifetime
      </span>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 font-medium text-blue-400',
      size === 'md' ? 'text-[12px]' : 'text-[10px]',
    )}>
      <Gift size={size === 'md' ? 13 : 11} />
      {days} days
    </span>
  );
}

export function PathBadge({ path }: { path: string | null }) {
  if (!path) return <span className="text-muted-foreground">—</span>;
  const variant: 'default' | 'success' | 'warning' =
    path === 'paddle' ? 'default' : path === 'lifetime_set' ? 'warning' : 'success';
  return <Badge variant={variant} className="px-1.5 py-0.5 text-[10px]">{path}</Badge>;
}

/** Cursor-style pagination — total + offset + limit. We'd want
 *  keyset pagination at scale, but at < 10k rows offset is fine. */
export function Pagination({
  total, offset, limit, onChange, loading,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
  loading: boolean;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = end < total;
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-[11px]">
      <span className="text-muted-foreground">
        {total === 0 ? 'No results' : `${start}-${end} of ${total}`}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={!canPrev || loading}
          onClick={() => onChange(Math.max(0, offset - limit))} className="h-6 px-2 text-[11px]">
          Prev
        </Button>
        <Button size="sm" variant="outline" disabled={!canNext || loading}
          onClick={() => onChange(offset + limit)} className="h-6 px-2 text-[11px]">
          Next
        </Button>
      </div>
    </div>
  );
}

/** Tiny hook-less helper to read the auth token. Avoids a useEffect
 *  in every tab — we just call it inline before each fetch. */
export async function authQS(): Promise<string> {
  const { getSupabase } = await import('@/lib/supabase');
  const { data } = await getSupabase().auth.getSession();
  return encodeURIComponent(data.session?.access_token ?? '');
}
