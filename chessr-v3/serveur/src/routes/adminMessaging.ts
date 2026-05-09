/**
 * Admin → user system message broadcast.
 *
 * Used by the dashboard's Messages page to push a one-off announcement
 * into the floating widget on every (or selected) connected extension
 * instance. The WS frame shape mirrors the extension's
 * `widgetStore.SystemMessage`, with one extra `kind: 'system_message'`
 * tag so the receive-side dispatcher can route correctly.
 *
 * Recipients:
 *   - `'all'`         → every connected user (gets one push each)
 *   - `string[]`      → specific user_ids; offline users are silently
 *                       skipped (we don't queue server-side, the
 *                       widget is a "live nudge" not a mailbox)
 */

import { Hono, type Context } from 'hono';
import { sendToClient, getConnectedUsers } from './ws.js';

export const adminMessagingRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

interface SystemMessagePayload {
  id: string;
  category: 'info' | 'discord' | 'trial' | 'admin' | 'howto';
  title: string;
  body?: string;
  cta?: {
    label: string;
    action:
      | { kind: 'discord-link' }
      | { kind: 'discord-join'; url: string }
      | { kind: 'open-url'; url: string }
      | { kind: 'open-tab'; tab: string }
      | { kind: 'dismiss' };
  };
  ttl?: number;
}

interface BroadcastBody {
  recipients: 'all' | string[];
  message: SystemMessagePayload;
}

adminMessagingRoutes.post('/admin/system-message', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const body = (await c.req.json().catch(() => ({}))) as Partial<BroadcastBody>;
  const message = body.message;
  if (!message?.id || !message?.title || !message?.category) {
    return c.json({ error: 'message.id, title and category are required' }, 400);
  }

  const targets: string[] =
    body.recipients === 'all'
      ? getConnectedUsers().map((u) => u.userId)
      : Array.isArray(body.recipients)
        ? body.recipients
        : [];

  if (targets.length === 0) {
    return c.json({ ok: true, delivered: 0, recipients: 0 });
  }

  // Wrap in the WS envelope the extension's dispatcher expects.
  const frame = { kind: 'system_message', message };
  let delivered = 0;
  for (const uid of targets) {
    sendToClient(uid, frame);
    delivered++;
  }

  return c.json({
    ok: true,
    recipients: targets.length,
    delivered,
    online: getConnectedUsers().length,
  });
});
