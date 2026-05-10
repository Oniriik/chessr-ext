'use client';

/** Helpers shared across the Wheel Spin admin tabs. Keeping styling
 *  bits + tiny helpers in one file so each tab component stays focused
 *  on its own filters + table. */

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

/** Render a Discord ID as a Discord mention tag — clickable so the
 *  recipient resolves it, monospace so multiple IDs line up nicely. */
export function DiscordTag({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono text-[11px]">&lt;@{id}&gt;</span>;
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
