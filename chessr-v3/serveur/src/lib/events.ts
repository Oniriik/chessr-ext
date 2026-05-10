/**
 * Event log — single emit point used by every producer in the serveur.
 *
 * Each call:
 *   1. INSERTs a row into the analytics-DB `events` table (durable).
 *   2. PUBLISHes the same row to the Redis channel `chessr:events`
 *      (real-time fanout for the bot + any future subscriber).
 *
 * Failures are logged but never re-thrown: the originating mutation
 * (plan change, ban, etc.) is the source of truth and must not roll
 * back because telemetry blew up. If both writes fail the data is
 * lost — that's the deliberate trade-off.
 *
 * Adding a new event kind:
 *   1. Append to EVENT_KINDS below.
 *   2. Document the payload shape inline (search for "// payload:").
 *   3. Call `emitEvent({ type, user_id, actor_id, payload })` from
 *      wherever the action happens.
 *
 * Dashboard reads via the proxy `GET /admin/events` (see admin routes).
 */

import { getDbPool } from './db.js';
import { redis } from '../queue/connection.js';

export const EVENT_KINDS = [
  // payload: { oldPlan, newPlan, oldExpiry?, newExpiry?, reason? }
  'plan_changed',
  // payload: { reason?: string }
  'user_banned',
  'user_unbanned',
  // payload: { previousPlan: string }
  'user_deleted',
  // payload: { discordId, discordUsername }
  'discord_linked',
  'discord_unlinked',
  // payload: { platform, platform_username }
  'chess_account_linked',
  'chess_account_unlinked',
  // payload: { oldRole, newRole }
  'role_changed',
  // payload: { oldEmail, newEmail }
  'email_changed',
  // payload: { expiresAt, durationDays, discordId? }
  // Emitted alongside plan_changed when a free trial gets claimed
  // (self-claim from the extension or auto-claim on Discord link).
  // Plan_changed handles the role sync; this kind is for clean
  // activity-log filtering ("how many trials this week").
  'freetrial_claimed',
  // payload: { email, ip, country, countryCode, fingerprint }
  // Emitted on every successful signup. Powers a Discord channel feed
  // ("new user from FR — visitor: abc123…") and onboarding analytics.
  'signup_success',
  // payload: { email, ip, country, countryCode, fingerprint, reason,
  //            linkedAccountIds }
  // Emitted when the abuse check rejects a signup. `reason` mirrors
  // what /check-signup returns:
  //   'banned'     — a linked account is banned (appeal screen on client)
  //   'duplicate'  — fingerprint or IP matches an existing non-banned
  //                  account → "you already have an account"
  //   'disposable' — UserCheck flagged the email
  'signup_blocked',
  // payload: { email, ip, country, countryCode, fingerprint, banReason }
  // Emitted when a banned user attempts to sign in via the form. The
  // signIn already calls supabase.auth.signOut so no token leaks.
  // user_id on the event row identifies the banned account.
  'login_blocked',
  // ─── Wheel-of-fortune lifecycle ───────────────────────────────────────
  // The wheel feature mints tokens, spins them into rewards, and lets
  // users claim or gift those rewards. Each lifecycle step emits an
  // event so the gift chain (A→B→C) is reconstructable, even though
  // wheel_rewards only stores the last-hop sender.
  // payload: { tokenId, source, externalRef?, discordId }
  'wheel_token_earned',
  // payload: { tokenId, rewardId, rewardKind, rewardDays?, discordId }
  'wheel_spin',
  // payload: { rewardId, fromDiscordId, toDiscordId }
  'wheel_gift',
  // payload: { rewardId, rewardKind, rewardDays?, rewardPath, discordId }
  'wheel_claim',
  // payload: { giveawayId, count, source, externalRef?, reason?, discordId }
  // A single grant of N tickets emits one event with count=N (matches
  // the 1-row, 1-DM model on the giveaway_tickets table).
  'giveaway_ticket_earned',
  // payload: { giveawayId, name, announceChannelId?, announceMessageId?,
  //            winners: [{ position, prizeId, discordId|null, prize: {...},
  //                        deliverable: {kind:'wheel_reward'|'wheel_tokens'|'lifetime_manual',
  //                                      rewardId?|tokenIds?|count?} }] }
  // Emitted by the giveaway-draw cron after winners are picked AND
  // prize deliverables are persisted (wheel_rewards / wheel_tokens
  // rows). The bot listens to post the public announcement + DM
  // winners.
  'giveaway_drawn',
  // payload: { giveawayId }
  // Emitted whenever a giveaway's header (name/ends_at/announce
  // channel) or prize list changes after the announcement message has
  // been posted. The bot re-fetches the giveaway and edits the
  // existing announce_message_id with the fresh embed so the channel
  // doesn't fall out of sync with the dashboard.
  'giveaway_updated',
  // payload: { ticketId, channelId, openerDiscordId }
  // Emitted by the ticket auto-delete cron when a closed ticket has
  // been sitting longer than the retention window (12h). The bot
  // deletes the Discord channel and POSTs /admin/tickets/:id/delete
  // to flip the row to 'deleted'. Idempotent — if the bot was offline
  // when the event fired, the next cron tick re-emits.
  'ticket_auto_delete',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export interface EmitEventArgs {
  type: EventKind;
  /** Subject of the event (chessr user_id). Null for system-wide events. */
  user_id?: string | null;
  /** Admin / actor that triggered it (null for self-service / system). */
  actor_id?: string | null;
  /** Per-kind payload. See EVENT_KINDS above for the documented shape. */
  payload?: Record<string, unknown>;
}

const REDIS_CHANNEL = 'chessr:events';

export async function emitEvent(args: EmitEventArgs): Promise<void> {
  const row = {
    type: args.type,
    user_id: args.user_id ?? null,
    actor_id: args.actor_id ?? null,
    payload: args.payload ?? {},
  };

  // Both writes run in parallel — the analytics DB row is the durable
  // record, but a slow Postgres shouldn't delay the real-time fanout.
  const pgPromise = getDbPool()
    .query(
      `INSERT INTO events (type, user_id, actor_id, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, created_at`,
      [row.type, row.user_id, row.actor_id, row.payload],
    )
    .then((res) => res.rows[0] as { id: string; created_at: string })
    .catch((err) => {
      console.error('[events] pg insert failed:', err.message);
      return null;
    });

  const redisPromise = redis
    .publish(REDIS_CHANNEL, JSON.stringify(row))
    .catch((err) => {
      console.error('[events] redis publish failed:', err.message);
    });

  await Promise.all([pgPromise, redisPromise]);
}

export const EVENTS_REDIS_CHANNEL = REDIS_CHANNEL;
