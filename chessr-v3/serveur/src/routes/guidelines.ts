/**
 * Onboarding-guidelines acceptance endpoint.
 *
 * The extension shows a one-shot "how to stay undetected" guidelines modal
 * the first time an authenticated user is seen with no acceptance stamp.
 * On accept it POSTs here; we stamp `guidelines_accepted_at` so the modal
 * never shows again for that account — including after a reinstall or on a
 * fresh Chrome profile (the stamp lives in the DB, not local storage).
 *
 * Same trust-on-userId model as POST /freetrial/ended-ack.
 */

import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';

const app = new Hono();

app.post('/guidelines/accept', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return c.json({ ok: false, error: 'Missing userId' }, 400);

  const { error } = await supabase
    .from('user_settings')
    .update({ guidelines_accepted_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) {
    console.error('[guidelines.accept] update failed:', error.message);
    return c.json({ ok: false }, 500);
  }
  return c.json({ ok: true });
});

export { app as guidelinesRoutes };
