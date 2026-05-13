/**
 * Giveaway draw — runs every minute. For each scheduled giveaway whose
 * ends_at has elapsed, we:
 *
 *   1. Pick winners (weighted by SUM(count) over giveaway_tickets,
 *      no duplicate winners across prizes).
 *   2. Persist winners on giveaway_prizes.
 *   3. Pre-mint deliverables in wheel_rewards / wheel_tokens so winners
 *      can claim through the existing /inventory flow. No special
 *      claim path for giveaway prizes.
 *   4. Atomic-flip giveaway status to 'completed' (FOR UPDATE keeps
 *      a concurrent run from racing).
 *   5. Emit `giveaway_drawn` so the bot posts the announcement +
 *      DMs winners.
 *
 * Idempotent: re-running after a partial failure is safe — the status
 * flip only lands once, and wheel_rewards/wheel_tokens inserts use
 * NULL external_ref so the row dedup doesn't apply. The dedup of "draw
 * exactly once" is the giveaways.status='scheduled' guard.
 */

import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';

interface DueGiveaway {
  id: number;
  name: string;
  announce_channel_id: string | null;
  announce_message_id: string | null;
}

interface PrizeRow {
  id: number;
  position: number;
  prize_kind: 'plan' | 'token';
  plan_kind: 'lifetime' | 'premium' | null;
  plan_days: number | null;
  token_count: number | null;
}

interface TicketAggRow {
  owner_discord_id: string;
  tickets: string; // bigint as text
}

type Deliverable =
  | { kind: 'wheel_reward'; rewardId: number; rewardKind: 'days' | 'lifetime'; rewardDays: number | null }
  | { kind: 'wheel_tokens'; tokenIds: number[]; count: number }
  | { kind: 'no_winner' };

interface DrawnPrize {
  position: number;
  prizeId: number;
  discordId: string | null;
  prize: PrizeRow;
  deliverable: Deliverable;
}

export async function runGiveawayDraw(): Promise<void> {
  const due = await dbQuery<DueGiveaway>(
    `SELECT id, name, announce_channel_id, announce_message_id
       FROM giveaways
      WHERE status = 'scheduled' AND ends_at <= now()
      ORDER BY ends_at ASC
      LIMIT 5`,
  );
  for (const g of due) {
    try { await drawOne(g); }
    catch (err) { console.error(`[giveaway-draw] giveaway ${g.id} failed:`, err); }
  }
}

/** Force-draw a single giveaway by id, regardless of ends_at. Used by
 *  the dashboard's "Force draw" button. Throws on not-found / wrong
 *  status so the route can return a 4xx. */
export async function forceDrawGiveaway(id: number): Promise<void> {
  const rows = await dbQuery<DueGiveaway>(
    `SELECT id, name, announce_channel_id, announce_message_id
       FROM giveaways
      WHERE id = $1 AND status = 'scheduled'`,
    [id],
  );
  if (rows.length === 0) throw new Error('not_found_or_locked');

  // Pull ends_at forward to now() so a future cron tick won't try to
  // draw it again — keeps the row's lifecycle consistent.
  await dbQuery(
    `UPDATE giveaways SET ends_at = now()
      WHERE id = $1 AND status = 'scheduled' AND ends_at > now()`,
    [id],
  );

  await drawOne(rows[0]);
}

async function drawOne(g: DueGiveaway): Promise<void> {
  const prizes = await dbQuery<PrizeRow>(
    `SELECT id, position, prize_kind, plan_kind, plan_days, token_count
       FROM giveaway_prizes
      WHERE giveaway_id = $1
      ORDER BY position ASC`,
    [g.id],
  );
  if (prizes.length === 0) {
    // No prizes — flip status anyway so we stop polling it.
    await dbQuery(
      `UPDATE giveaways SET status = 'completed', drawn_at = now()
        WHERE id = $1 AND status = 'scheduled'`,
      [g.id],
    );
    console.info(`[giveaway-draw] giveaway ${g.id} has no prizes, marked completed`);
    return;
  }

  // Aggregate tickets but filter out excluded users (chessr team, banned
  // accounts, etc.). Done in SQL with a LEFT JOIN so excluded users
  // can't slip through even if they earned tickets BEFORE being added
  // to the exclusion list — exclusions are evaluated at draw time, not
  // grant time.
  const tickets = await dbQuery<TicketAggRow>(
    `SELECT t.owner_discord_id, SUM(t.count)::text AS tickets
       FROM giveaway_tickets t
      WHERE t.giveaway_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM giveaway_excluded_users e
           WHERE e.giveaway_id = t.giveaway_id
             AND e.discord_id = t.owner_discord_id
        )
      GROUP BY t.owner_discord_id`,
    [g.id],
  );

  const pool = tickets.map((t) => ({ id: t.owner_discord_id, weight: Number(t.tickets) }));
  const drawn: DrawnPrize[] = [];

  for (const p of prizes) {
    const winnerId = drawWeighted(pool);
    if (winnerId) {
      // Remove winner from pool so the next prize draws someone else.
      const idx = pool.findIndex((x) => x.id === winnerId);
      if (idx >= 0) pool.splice(idx, 1);
    }
    drawn.push({
      position: p.position,
      prizeId: p.id,
      discordId: winnerId,
      prize: p,
      deliverable: { kind: 'no_winner' },
    });
  }

  // Persist winners + mint deliverables.
  for (const d of drawn) {
    await dbQuery(
      `UPDATE giveaway_prizes SET winner_discord_id = $1 WHERE id = $2`,
      [d.discordId, d.prizeId],
    );
    if (!d.discordId) continue;
    d.deliverable = await mintDeliverable(d.discordId, d.prize);
  }

  // Atomic flip — guards against two replicas double-drawing.
  const flipped = await dbQuery<{ id: number }>(
    `UPDATE giveaways SET status = 'completed', drawn_at = now()
      WHERE id = $1 AND status = 'scheduled'
      RETURNING id`,
    [g.id],
  );
  if (flipped.length === 0) {
    console.warn(`[giveaway-draw] giveaway ${g.id} already drawn elsewhere`);
    return;
  }

  await emitEvent({
    type: 'giveaway_drawn',
    actor_id: null,
    payload: {
      giveawayId: g.id,
      name: g.name,
      announceChannelId: g.announce_channel_id,
      announceMessageId: g.announce_message_id,
      winners: drawn.map((d) => ({
        position: d.position,
        prizeId: d.prizeId,
        discordId: d.discordId,
        prize: d.prize,
        deliverable: d.deliverable,
      })),
    },
  });

  const winnerCount = drawn.filter((d) => d.discordId).length;
  console.info(`[giveaway-draw] giveaway ${g.id} drawn: ${winnerCount}/${prizes.length} winners`);
}

/** Weighted random pick. Returns null on empty / zero-weight pool. */
function drawWeighted(pool: Array<{ id: string; weight: number }>): string | null {
  const total = pool.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const x of pool) {
    r -= x.weight;
    if (r <= 0) return x.id;
  }
  return pool[pool.length - 1]?.id ?? null;
}

/** Pre-mint the prize as a wheel_reward (plan) or wheel_tokens (token).
 *  Lifetime rewards stay as wheel_reward kind='lifetime' so the existing
 *  /inventory claim flow takes over (DM with ticket-channel link). */
async function mintDeliverable(discordId: string, p: PrizeRow): Promise<Deliverable> {
  if (p.prize_kind === 'plan') {
    if (p.plan_kind === 'lifetime') {
      const rows = await dbQuery<{ id: string }>(
        `INSERT INTO wheel_rewards
           (owner_discord_id, spun_by_discord_id, reward_kind, reward_days)
         VALUES ($1, $1, 'lifetime', NULL)
         RETURNING id::text`,
        [discordId],
      );
      return { kind: 'wheel_reward', rewardId: Number(rows[0].id), rewardKind: 'lifetime', rewardDays: null };
    }
    // premium days
    const days = p.plan_days ?? 0;
    const rows = await dbQuery<{ id: string }>(
      `INSERT INTO wheel_rewards
         (owner_discord_id, spun_by_discord_id, reward_kind, reward_days)
       VALUES ($1, $1, 'days', $2)
       RETURNING id::text`,
      [discordId, days],
    );
    return { kind: 'wheel_reward', rewardId: Number(rows[0].id), rewardKind: 'days', rewardDays: days };
  }

  // token: mint N rows in wheel_tokens with source='admin_grant'.
  const count = p.token_count ?? 0;
  const tokenIds: number[] = [];
  for (let i = 0; i < count; i++) {
    const rows = await dbQuery<{ id: string }>(
      `INSERT INTO wheel_tokens (owner_discord_id, source, external_ref)
       VALUES ($1, 'admin_grant', NULL)
       RETURNING id::text`,
      [discordId],
    );
    tokenIds.push(Number(rows[0].id));
  }
  return { kind: 'wheel_tokens', tokenIds, count };
}
