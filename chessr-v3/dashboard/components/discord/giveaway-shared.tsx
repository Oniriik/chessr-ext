'use client';

/** Shared bits for the giveaway admin pages. */

import type { CSSProperties } from 'react';
import { Crown, Gift, Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type GiveawayStatus = 'scheduled' | 'cancelled' | 'completed';
export type PrizeKind = 'plan' | 'token';
export type PlanKind = 'lifetime' | 'premium';

export interface Giveaway {
  id: number;
  name: string;
  ends_at: string;
  status: GiveawayStatus;
  created_at: string;
  created_by_user_id: string | null;
  drawn_at: string | null;
  tickets?: number;
  prize_count?: number;
}

export interface Prize {
  id?: number;
  position: number;
  prize_kind: PrizeKind;
  plan_kind?: PlanKind | null;
  plan_days?: number | null;
  token_count?: number | null;
  winner_discord_id?: string | null;
  winner_user_id?: string | null;
}

export interface GiveawayDetail {
  giveaway: Giveaway;
  prizes: Prize[];
  stats: { tickets: number; participants: number };
}

/** Discord-rendered timestamp tag. Pattern: <t:UNIX:F> = Friday, May 9 2026 6:30 PM. */
export function discordTimestamp(iso: string, fmt: 'F' | 'R' | 'f' | 'D' = 'F'): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${fmt}>`;
}

export function StatusBadge({ status }: { status: GiveawayStatus }) {
  const cfg: Record<GiveawayStatus, { label: string; style: CSSProperties }> = {
    scheduled: { label: 'Scheduled', style: { backgroundColor: 'rgba(96,165,250,0.18)', color: '#93C5FD' } },
    cancelled: { label: 'Cancelled', style: { backgroundColor: 'rgba(239,68,68,0.18)',  color: '#FCA5A5' } },
    completed: { label: 'Completed', style: { backgroundColor: 'rgba(16,185,129,0.18)', color: '#6EE7B7' } },
  };
  const c = cfg[status];
  return <Badge className="border-transparent capitalize" style={c.style}>{c.label}</Badge>;
}

export function PrizeChip({ p }: { p: Prize }) {
  if (p.prize_kind === 'plan') {
    if (p.plan_kind === 'lifetime') {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
          <Crown size={11} /> Lifetime
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-400">
        <Gift size={11} /> Premium · {p.plan_days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[11px] font-medium text-purple-400">
      <Ticket size={11} /> {p.token_count} tokens
    </span>
  );
}

/** Pretty-print a prize as a single line string (e.g. for confirm dialogs). */
export function prizeLabel(p: Prize): string {
  if (p.prize_kind === 'plan') {
    return p.plan_kind === 'lifetime' ? 'Lifetime' : `Premium ${p.plan_days} days`;
  }
  return `${p.token_count} tokens`;
}

export async function authQS(): Promise<string> {
  const { getSupabase } = await import('@/lib/supabase');
  const { data } = await getSupabase().auth.getSession();
  return encodeURIComponent(data.session?.access_token ?? '');
}
