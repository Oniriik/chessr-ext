/**
 * Subscribe to the shared `chessr:events` channel.
 *
 * Producers (serveur, dashboard via the proxy, this bot) publish to
 * Redis after persisting to the analytics-DB `events` table. The bot
 * listens here and dispatches to per-kind handlers — currently a
 * no-op while we ship the plumbing; real handlers (sync Discord role
 * on plan_changed, etc.) will be filled in as features land.
 *
 * Schema mirrors serveur/src/lib/events.ts so we can later promote
 * this to a shared package without a rename.
 */

import { redisSub } from './redis.js';
import { log } from './logger.js';

const CHANNEL = 'chessr:events';

export type IncomingEvent = {
  type: string;
  user_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
};

type Handler = (e: IncomingEvent) => void | Promise<void>;
const handlers = new Map<string, Handler[]>();

/** Register a handler for a specific event kind. Multiple handlers per
 *  kind are allowed and run sequentially in registration order. */
export function onEvent(type: string, fn: Handler): void {
  const list = handlers.get(type) ?? [];
  list.push(fn);
  handlers.set(type, list);
}

/** Connect to Redis pub/sub. Idempotent. */
let started = false;
export async function startEventBus(): Promise<void> {
  if (started) return;
  started = true;
  await redisSub.subscribe(CHANNEL);
  log.info('[events] subscribed to', CHANNEL);

  redisSub.on('message', async (ch, raw) => {
    if (ch !== CHANNEL) return;
    let event: IncomingEvent;
    try {
      event = JSON.parse(raw) as IncomingEvent;
    } catch (err) {
      log.warn('[events] malformed payload:', raw, err);
      return;
    }
    log.debug('[events]', event.type, event.user_id ?? '');

    const list = handlers.get(event.type);
    if (!list || list.length === 0) return;
    for (const fn of list) {
      try { await fn(event); }
      catch (err) {
        log.error(`[events] handler for ${event.type} threw:`, err);
      }
    }
  });
}
