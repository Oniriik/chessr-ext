import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Service-role client — the bot needs admin reads/writes (sync roles,
// resolve email by user_id, etc.). Auth state is irrelevant on the bot
// side, so we disable session persistence to keep the singleton stateless.
export const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
