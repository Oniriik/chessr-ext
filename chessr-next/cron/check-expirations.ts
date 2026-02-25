/**
 * Check Plan Expirations
 * Downgrades users whose plan has expired to 'free'
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkExpirations() {
  const now = new Date().toISOString();
  console.log(`[Cron] Checking plan expirations at ${now}`);

  try {
    // Find all users with expired plans (premium or freetrial with plan_expiry < now)
    const { data: expiredUsers, error: selectError } = await supabase
      .from('user_settings')
      .select('user_id, plan, plan_expiry')
      .in('plan', ['premium', 'freetrial'])
      .not('plan_expiry', 'is', null)
      .lt('plan_expiry', now);

    if (selectError) {
      console.error('[Cron] Error fetching expired users:', selectError.message);
      return;
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      console.log('[Cron] No expired plans found');
      return;
    }

    console.log(`[Cron] Found ${expiredUsers.length} expired plan(s)`);

    // Downgrade each user to free
    for (const user of expiredUsers) {
      const { error: updateError } = await supabase
        .from('user_settings')
        .update({
          plan: 'free',
          plan_expiry: null,
        })
        .eq('user_id', user.user_id);

      if (updateError) {
        console.error(`[Cron] Failed to downgrade user ${user.user_id}:`, updateError.message);
      } else {
        console.log(`[Cron] Downgraded user ${user.user_id} from ${user.plan} to free (expired: ${user.plan_expiry})`);
      }
    }

    console.log('[Cron] Expiration check complete');
  } catch (error) {
    console.error('[Cron] Unexpected error:', error);
  }
}

// Run immediately
checkExpirations();
