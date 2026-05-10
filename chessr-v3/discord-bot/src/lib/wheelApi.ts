/**
 * Thin client over the serveur's /admin/wheel/* endpoints. The bot
 * never touches the local-postgres directly — every wheel mutation
 * goes through these so the serveur can run the atomic transactions
 * (FOR UPDATE SKIP LOCKED on spin, atomic UPDATEs on claim/gift).
 */

import { config } from '../config.js';

interface InventoryReward {
  id: number;
  reward_kind: 'days' | 'lifetime';
  reward_days: number | null;
  spun_at: string;
  spun_by_discord_id: string;
  gifted_from_discord_id: string | null;
  gifted_at: string | null;
}

interface InventoryToken {
  id: number;
  source: string;
  earned_at: string;
}

export interface Inventory {
  tokens: InventoryToken[];
  rewards: InventoryReward[];
}

function adminHeaders() {
  const adminToken = config.serveur.adminToken;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  return { 'Content-Type': 'application/json', 'x-admin-token': adminToken };
}

function url(path: string): string {
  return `${config.serveur.url}${path}`;
}

export async function getInventory(discordId: string): Promise<Inventory> {
  const res = await fetch(
    url(`/admin/wheel/inventory?discordId=${encodeURIComponent(discordId)}`),
    { headers: adminHeaders() },
  );
  if (!res.ok) throw new Error(`inventory HTTP ${res.status}`);
  const raw = (await res.json()) as Inventory;
  // Postgres returns bigint (bigserial PK) as strings over the wire so
  // a 64-bit value doesn't lose precision in JSON. Coerce here so the
  // bot's `r.id === rewardId` comparisons after select work — the
  // dropdown round-trips IDs as strings, then we Number() them in the
  // handler. Without this, inv.rewards.find never matches.
  return {
    tokens: raw.tokens.map((t) => ({ ...t, id: Number(t.id) })),
    rewards: raw.rewards.map((r) => ({ ...r, id: Number(r.id) })),
  };
}

export interface SpinResult {
  spun: boolean;
  tokenId?: number;
  rewardId?: number;
  rewardKind?: 'days' | 'lifetime';
  rewardDays?: number | null;
}

export async function spin(discordId: string): Promise<SpinResult> {
  const res = await fetch(url('/admin/wheel/spin'), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ discordId }),
  });
  if (!res.ok) throw new Error(`spin HTTP ${res.status}`);
  const raw = (await res.json()) as SpinResult;
  // Same bigint-as-string normalisation as getInventory().
  if (raw.tokenId !== undefined && raw.tokenId !== null) raw.tokenId = Number(raw.tokenId);
  if (raw.rewardId !== undefined && raw.rewardId !== null) raw.rewardId = Number(raw.rewardId);
  return raw;
}

export interface ClaimResult {
  claimed?: boolean;
  rewardKind?: 'days' | 'lifetime';
  rewardDays?: number | null;
  rewardPath?: 'paddle' | 'dashboard' | 'lifetime_set';
  userId?: string;
  // Error states (when claimed===undefined):
  error?: 'not_owner_or_already_claimed' | 'lifetime_manual' | 'not_linked'
        | 'plan_no_extend' | 'claim_race_lost' | 'extend_failed';
  message?: string;
  plan?: string;
}

export async function claim(rewardId: number, callerDiscordId: string): Promise<ClaimResult> {
  const res = await fetch(url('/admin/wheel/claim'), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ rewardId, callerDiscordId }),
  });
  return res.json() as Promise<ClaimResult>;
}

export interface GiftResult {
  gifted?: boolean;
  error?: 'not_owner_or_already_claimed' | 'cannot_gift_to_self';
}

export async function gift(
  rewardId: number,
  fromDiscordId: string,
  toDiscordId: string,
): Promise<GiftResult> {
  const res = await fetch(url('/admin/wheel/gift'), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ rewardId, fromDiscordId, toDiscordId }),
  });
  return res.json() as Promise<GiftResult>;
}
