/**
 * Ticket auto-delete — runs every 5 minutes. Queries closed tickets
 * that have been sitting longer than the retention window and emits
 * `ticket_auto_delete` for each. The bot owns the actual Discord
 * channel.delete() + DB row flip; this cron is just the timer.
 *
 * Retention is currently 12h (RETENTION_HOURS). If we need per-team
 * tuning later, move it to env or a config row.
 *
 * Re-emitting on every tick is fine — the bot's handler is idempotent
 * and the row flips to 'deleted' once the channel is gone, dropping
 * out of the WHERE.
 */

import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';

const RETENTION_HOURS = 12;

interface DueTicket {
  id: number;
  channel_id: string;
  opener_discord_id: string;
}

export async function runTicketAutoDelete(): Promise<void> {
  const due = await dbQuery<DueTicket>(
    `SELECT id, channel_id, opener_discord_id
       FROM tickets
      WHERE status = 'closed'
        AND closed_at <= now() - ($1::int * INTERVAL '1 hour')
      ORDER BY closed_at ASC
      LIMIT 50`,
    [RETENTION_HOURS],
  );

  for (const t of due) {
    await emitEvent({
      type: 'ticket_auto_delete',
      actor_id: null,
      payload: {
        ticketId: t.id,
        channelId: t.channel_id,
        openerDiscordId: t.opener_discord_id,
      },
    });
  }

  if (due.length > 0) {
    console.info(`[ticket-auto-delete] dispatched ${due.length} delete event(s)`);
  }
}
