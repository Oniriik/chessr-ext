/**
 * Thin client over the serveur's /admin/tickets/* endpoints.
 */

import { config } from '../config.js';

function adminHeaders() {
  const adminToken = config.serveur.adminToken;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  return { 'Content-Type': 'application/json', 'x-admin-token': adminToken };
}

function url(path: string): string {
  return `${config.serveur.url}${path}`;
}

export interface TicketRow {
  id: number;
  opener_discord_id: string;
  opener_username: string | null;
  channel_id: string;
  status: 'open' | 'closed' | 'deleted';
  opened_at: string;
  closed_at: string | null;
  closed_by_discord_id: string | null;
  deleted_at: string | null;
  deleted_by_discord_id: string | null;
}

export async function openTicket(args: {
  openerDiscordId: string;
  openerUsername: string;
  channelId: string;
}): Promise<{ id: number }> {
  const res = await fetch(url('/admin/tickets/open'), {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`tickets/open HTTP ${res.status}`);
  return res.json() as Promise<{ id: number }>;
}

export async function closeTicket(id: number, closedByDiscordId: string): Promise<void> {
  const res = await fetch(url(`/admin/tickets/${id}/close`), {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ closedByDiscordId }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`tickets/close HTTP ${res.status}`);
}

export async function reopenTicket(id: number): Promise<void> {
  const res = await fetch(url(`/admin/tickets/${id}/reopen`), {
    method: 'POST', headers: adminHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`tickets/reopen HTTP ${res.status}`);
}

export async function deleteTicket(id: number, deletedByDiscordId: string): Promise<void> {
  const res = await fetch(url(`/admin/tickets/${id}/delete`), {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ deletedByDiscordId }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`tickets/delete HTTP ${res.status}`);
}

export async function getByChannel(channelId: string): Promise<TicketRow | null> {
  const res = await fetch(url(`/admin/tickets/by-channel/${channelId}`), { headers: adminHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tickets/by-channel HTTP ${res.status}`);
  return res.json() as Promise<TicketRow>;
}

export async function getOpenForOpener(discordId: string): Promise<TicketRow | null> {
  const res = await fetch(url(`/admin/tickets/open-for-opener/${discordId}`), { headers: adminHeaders() });
  if (!res.ok) throw new Error(`tickets/open-for-opener HTTP ${res.status}`);
  const json = (await res.json()) as { open: boolean; ticket?: TicketRow };
  return json.open && json.ticket ? json.ticket : null;
}

export interface TicketUserInfo {
  linked: boolean;
  discordId: string;
  userId?: string;
  email?: string | null;
  plan?: string;
  freetrialUsed?: boolean;
  discordUsername?: string;
  banned?: boolean;
  banReason?: string | null;
  linkedAccounts?: Array<{
    platform: string;
    platform_username: string;
    rating_bullet: number | null;
    rating_blitz: number | null;
    rating_rapid: number | null;
  }>;
  fingerprints?: string[];
  ips?: Array<{ ip: string; country: string | null }>;
}

export async function getTicketInfo(discordId: string): Promise<TicketUserInfo> {
  const res = await fetch(url(`/admin/tickets/info?discordId=${encodeURIComponent(discordId)}`), {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(`tickets/info HTTP ${res.status}`);
  return res.json() as Promise<TicketUserInfo>;
}
