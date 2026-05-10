/**
 * Shared helpers for reading a user's chess ratings from `linked_accounts`.
 *
 * The leaderboard + rank slash commands both run the same shape of
 * query: pull every active link for one user (or one mode for everyone)
 * and read the rating_bullet / rating_blitz / rating_rapid columns.
 *
 * Why platform-agnostic: the table accepts any platform string. As long
 * as the link flow populates rating_* (chess.com / lichess /
 * worldchess all do — see extension/lib/platformApi.ts), the same query
 * surfaces every world. World Chess in particular needs no special
 * casing here.
 */

import { supabase } from './supabase.js';

export type Mode = 'bullet' | 'blitz' | 'rapid';
export type Platform = 'chesscom' | 'lichess' | 'worldchess';

export const MODE_CONFIG: Record<Mode, { emoji: string; label: string; column: 'rating_bullet' | 'rating_blitz' | 'rating_rapid' }> = {
  bullet: { emoji: '⚡', label: 'Bullet', column: 'rating_bullet' },
  blitz:  { emoji: '🔥', label: 'Blitz',  column: 'rating_blitz' },
  rapid:  { emoji: '🕐', label: 'Rapid',  column: 'rating_rapid' },
};

export const PLATFORM_LABEL: Record<string, string> = {
  chesscom:   'Chess.com',
  lichess:    'Lichess',
  worldchess: 'World Chess',
};

/** Pretty-print a platform code falling back to a capitalised slug for
 *  unknown values (no need to crash if a future platform shows up). */
export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? (p.charAt(0).toUpperCase() + p.slice(1));
}

export interface LinkedAccount {
  platform: string;
  platform_username: string;
  rating_bullet: number | null;
  rating_blitz: number | null;
  rating_rapid: number | null;
}

/** Pull every active link (chess.com, lichess, worldchess, …) for a user. */
export async function getLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
  const { data } = await supabase
    .from('linked_accounts')
    .select('platform, platform_username, rating_bullet, rating_blitz, rating_rapid')
    .eq('user_id', userId)
    .is('unlinked_at', null);
  return (data ?? []) as LinkedAccount[];
}

/** Highest rating per mode across all the user's linked accounts.
 *  Mirrors the v2 bot — a single Bullet/Blitz/Rapid number per user. */
export function highestPerMode(accounts: LinkedAccount[]): Record<Mode, number> {
  const out: Record<Mode, number> = { bullet: 0, blitz: 0, rapid: 0 };
  for (const a of accounts) {
    if ((a.rating_bullet ?? 0) > out.bullet) out.bullet = a.rating_bullet ?? 0;
    if ((a.rating_blitz  ?? 0) > out.blitz)  out.blitz  = a.rating_blitz  ?? 0;
    if ((a.rating_rapid  ?? 0) > out.rapid)  out.rapid  = a.rating_rapid  ?? 0;
  }
  return out;
}

/** Tier color buckets — same thresholds as the v2 bot so a user's rank
 *  embed keeps the same color when they hit the same Elo. */
export function eloColor(elo: number): number {
  if (elo >= 2000) return 0xf59e0b; // gold
  if (elo >= 1800) return 0xa855f7; // purple
  if (elo >= 1600) return 0x3b82f6; // blue
  if (elo >= 1400) return 0x10b981; // green
  if (elo >= 1200) return 0x6366f1; // indigo
  if (elo >= 1000) return 0x8b5cf6; // violet
  if (elo >= 800)  return 0x64748b; // slate
  return 0x94a3b8;                  // gray
}
