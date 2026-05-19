import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const DID = '1493788517321543680';

const { data: hist } = await supa
  .from('discord_freetrial_history')
  .select('*').eq('discord_id', DID);
console.log('discord_freetrial_history:', hist);

const { data: us } = await supa
  .from('user_settings')
  .select('user_id, plan, plan_expiry, freetrial_used, discord_id, discord_username, discord_linked_at, discord_in_guild')
  .eq('discord_id', DID);
console.log('user_settings (current link):', us);
for (const r of us || []) {
  const { data: ou } = await supa.auth.admin.getUserById(r.user_id);
  console.log(' → email:', ou?.user?.email, 'created:', ou?.user?.created_at);
}

for (const h of hist || []) {
  const { data: ou } = await supa.auth.admin.getUserById(h.user_id);
  console.log(`history → user_id=${h.user_id} email=${ou?.user?.email} activated_at=${h.activated_at}`);
  const { data: logs } = await supa
    .from('plan_activity_logs')
    .select('action_type, old_plan, new_plan, new_expiry, reason, created_at')
    .eq('user_id', h.user_id).order('created_at', { ascending: false }).limit(5);
  console.log('  plan logs:', logs);
}
