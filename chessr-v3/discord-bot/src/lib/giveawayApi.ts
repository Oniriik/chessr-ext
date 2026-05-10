/**
 * Thin client over the serveur's /admin/giveaway/* endpoints. Same
 * pattern as wheelApi.ts — bot stays out of the DB, serveur owns
 * storage and validation.
 */

import { config } from '../config.js';

export type GiveawayStatus = 'scheduled' | 'cancelled' | 'completed';
export type PrizeKind = 'plan' | 'token';
export type PlanKind = 'lifetime' | 'premium';

export interface Giveaway {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string;
  status: GiveawayStatus;
  announce_channel_id: string | null;
  announce_message_id: string | null;
  announced_at: string | null;
  created_at: string;
  drawn_at: string | null;
}

export interface PendingAnnounce extends Giveaway {
  prizes: Prize[];
}

export interface Prize {
  id: number;
  giveaway_id: number;
  position: number;
  prize_kind: PrizeKind;
  plan_kind: PlanKind | null;
  plan_days: number | null;
  token_count: number | null;
  winner_discord_id: string | null;
  winner_user_id: string | null;
}

export interface GiveawayDetail {
  giveaway: Giveaway;
  prizes: Prize[];
  stats: { tickets: number; participants: number };
}

export interface MyStanding {
  tickets: number;
  rank: number | null;
  total_tickets: number;
  total_participants: number;
}

export interface LeaderboardRow {
  discord_id: string;
  tickets: number;
}

function adminHeaders() {
  const adminToken = config.serveur.adminToken;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  return { 'Content-Type': 'application/json', 'x-admin-token': adminToken };
}

function url(path: string): string {
  return `${config.serveur.url}${path}`;
}

export async function getDetail(giveawayId: number): Promise<GiveawayDetail | null> {
  const res = await fetch(url(`/admin/giveaway/${giveawayId}`), { headers: adminHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`giveaway/:id HTTP ${res.status}`);
  return (await res.json()) as GiveawayDetail;
}

/** Returns the soonest-ending scheduled giveaway, or null if none. */
export async function getCurrent(): Promise<GiveawayDetail | null> {
  const res = await fetch(url('/admin/giveaway/current'), { headers: adminHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`giveaway/current HTTP ${res.status}`);
  return (await res.json()) as GiveawayDetail;
}

export async function getMyStanding(giveawayId: number, discordId: string): Promise<MyStanding> {
  const res = await fetch(
    url(`/admin/giveaway/${giveawayId}/me?discordId=${encodeURIComponent(discordId)}`),
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`giveaway/me HTTP ${res.status}`);
  return (await res.json()) as MyStanding;
}

export async function getPendingAnnounce(): Promise<PendingAnnounce[]> {
  const res = await fetch(url('/admin/giveaways/pending-announce'), { headers: adminHeaders() });
  if (!res.ok) throw new Error(`giveaways/pending-announce HTTP ${res.status}`);
  const json = (await res.json()) as { giveaways: PendingAnnounce[] };
  return json.giveaways;
}

export async function markAnnounced(
  giveawayId: number,
  messageId: string,
  channelId: string,
): Promise<void> {
  const res = await fetch(url(`/admin/giveaway/${giveawayId}/announce`), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ messageId, channelId }),
  });
  // 409 = already announced — fine, the row is in the desired state.
  if (!res.ok && res.status !== 409) {
    throw new Error(`giveaway/announce HTTP ${res.status}`);
  }
}

export interface RegisterResult {
  registered?: boolean;
  already?: boolean;
  error?: string;
  status?: string;
}

export async function registerForGiveaway(
  giveawayId: number,
  discordId: string,
): Promise<RegisterResult> {
  const res = await fetch(url(`/admin/giveaway/${giveawayId}/register`), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ discordId }),
  });
  return res.json() as Promise<RegisterResult>;
}

export async function getLeaderboard(giveawayId: number, limit = 10): Promise<LeaderboardRow[]> {
  const res = await fetch(
    url(`/admin/giveaway/${giveawayId}/leaderboard?limit=${limit}`),
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`giveaway/leaderboard HTTP ${res.status}`);
  const json = (await res.json()) as { leaderboard: LeaderboardRow[] };
  return json.leaderboard;
}

// ─── Invite tracking ─────────────────────────────────────────────────────

export interface InviteUseResult {
  logged?: boolean;
  already?: boolean;
  ticketsGranted?: number;
  error?: string;
}

export async function logInviteUse(args: {
  guildId: string;
  inviteeDiscordId: string;
  inviterDiscordId: string | null;
  inviteCode: string | null;
}): Promise<InviteUseResult> {
  const res = await fetch(url('/admin/invites/use'), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(args),
  });
  return res.json() as Promise<InviteUseResult>;
}

/** Pretty-print a prize as a single chip-friendly string. */
export function prizeLabel(p: Prize): string {
  if (p.prize_kind === 'plan') {
    if (p.plan_kind === 'lifetime') return '🌟 Lifetime';
    return `💎 Premium ${p.plan_days}d`;
  }
  return `🎟️ ${p.token_count} tokens`;
}

/** Discord-rendered timestamp tag. <t:UNIX:F> renders in viewer's locale. */
export function discordTs(iso: string, fmt: 'F' | 'R' | 'f' | 'D' = 'F'): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${fmt}>`;
}
