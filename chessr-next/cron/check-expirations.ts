/**
 * Check Plan Expirations
 * Downgrades users whose plan has expired to 'free'
 * Sends Discord notification for each downgrade via Bot API
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_PLANS || process.env.DISCORD_NOTIFICATION_CHANNEL_ID;

async function sendDowngradeNotification(
  email: string,
  oldPlan: string,
  expiry: string,
  discordId: string | null,
): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) return;

  try {
    const fields = [
      { name: '📧 Email', value: email || 'Unknown', inline: true },
    ];

    if (discordId) {
      fields.push({ name: '🎮 Discord', value: `<@${discordId}>`, inline: true });
    }

    fields.push(
      { name: '📉 Plan', value: `${oldPlan} → free`, inline: true },
      { name: '📅 Expired', value: new Date(expiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), inline: true },
    );

    const res = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        embeds: [{
          title: '⏰ Plan Expired',
          color: 0xef4444,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      }),
    });

    if (!res.ok) {
      console.error(`[Cron] Discord API failed: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error('[Cron] Discord API error:', error);
  }
}

async function checkExpirations() {
  const now = new Date().toISOString();
  console.log(`[Cron] Checking plan expirations at ${now}`);

  try {
    // Find all users with expired plans (premium or freetrial with plan_expiry < now)
    const { data: expiredUsers, error: selectError } = await supabase
      .from('user_settings')
      .select('user_id, plan, plan_expiry, discord_id')
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

    // Get user emails from auth.users with pagination
    const emailMap = new Map<string, string>();
    let authPage = 1;
    while (true) {
      const { data: authBatch } = await supabase.auth.admin.listUsers({ page: authPage, perPage: 1000 });
      if (!authBatch?.users?.length) break;
      authBatch.users.forEach((u) => {
        if (u.email) emailMap.set(u.id, u.email);
      });
      if (authBatch.users.length < 1000) break;
      authPage++;
    }

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
        const email = emailMap.get(user.user_id) || null;
        console.log(`[Cron] Downgraded user ${user.user_id} from ${user.plan} to free (expired: ${user.plan_expiry})`);

        // Log the plan change
        const { error: logError } = await supabase.from('plan_activity_logs').insert({
          user_id: user.user_id,
          user_email: email,
          action_type: 'cron_downgrade',
          old_plan: user.plan,
          new_plan: 'free',
          old_expiry: user.plan_expiry,
          new_expiry: null,
          reason: 'Plan expired',
        });

        if (logError) {
          console.error(`[Cron] Failed to log downgrade for ${user.user_id}:`, logError.message);
        }

        // Send Discord notification
        await sendDowngradeNotification(
          email || 'Unknown',
          user.plan,
          user.plan_expiry,
          user.discord_id || null,
        );
      }
    }

    console.log('[Cron] Expiration check complete');
  } catch (error) {
    console.error('[Cron] Unexpected error:', error);
  }
}

// Run immediately
checkExpirations();
