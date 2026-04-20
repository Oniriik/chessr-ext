import type { Context, Next } from 'hono';
import { supabase } from '../lib/supabase.js';

export async function authMiddleware(c: Context, next: Next) {
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: 'Missing token' }, 401);
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', data.user);
  await next();
}
