/**
 * Notify New Signups
 * Checks for new users since last run and sends Discord webhook notifications
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DISCORD_WEBHOOK_URL = process.env.DISCORD_SIGNUP_WEBHOOK_URL;
const LAST_CHECK_KEY = 'last_signup_check';

async function getLastCheckTime(): Promise<string> {
  const { data } = await supabase
    .from('global_stats')
    .select('value')
    .eq('key', LAST_CHECK_KEY)
    .single();

  if (data?.value) {
    return new Date(Number(data.value)).toISOString();
  }

  // First run: use 1 hour ago to avoid spamming
  return new Date(Date.now() - 3600_000).toISOString();
}

async function updateLastCheckTime(): Promise<void> {
  const now = Date.now().toString();
  const { error } = await supabase
    .from('global_stats')
    .upsert({ key: LAST_CHECK_KEY, value: now }, { onConflict: 'key' });

  if (error) {
    console.error('[Signup] Failed to update last check time:', error.message);
  }
}

function getCountryFromEmail(email: string): { flag: string; country: string } | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  const tld = domain.split('.').pop();
  const tldMap: Record<string, { flag: string; country: string }> = {
    fr: { flag: '🇫🇷', country: 'France' },
    de: { flag: '🇩🇪', country: 'Germany' },
    uk: { flag: '🇬🇧', country: 'UK' },
    es: { flag: '🇪🇸', country: 'Spain' },
    it: { flag: '🇮🇹', country: 'Italy' },
    nl: { flag: '🇳🇱', country: 'Netherlands' },
    be: { flag: '🇧🇪', country: 'Belgium' },
    ch: { flag: '🇨🇭', country: 'Switzerland' },
    pt: { flag: '🇵🇹', country: 'Portugal' },
    pl: { flag: '🇵🇱', country: 'Poland' },
    ru: { flag: '🇷🇺', country: 'Russia' },
    br: { flag: '🇧🇷', country: 'Brazil' },
    jp: { flag: '🇯🇵', country: 'Japan' },
    kr: { flag: '🇰🇷', country: 'South Korea' },
    cn: { flag: '🇨🇳', country: 'China' },
    in: { flag: '🇮🇳', country: 'India' },
    au: { flag: '🇦🇺', country: 'Australia' },
    ca: { flag: '🇨🇦', country: 'Canada' },
    mx: { flag: '🇲🇽', country: 'Mexico' },
    ar: { flag: '🇦🇷', country: 'Argentina' },
    se: { flag: '🇸🇪', country: 'Sweden' },
    no: { flag: '🇳🇴', country: 'Norway' },
    dk: { flag: '🇩🇰', country: 'Denmark' },
    fi: { flag: '🇫🇮', country: 'Finland' },
    at: { flag: '🇦🇹', country: 'Austria' },
    cz: { flag: '🇨🇿', country: 'Czech Republic' },
    ro: { flag: '🇷🇴', country: 'Romania' },
    hu: { flag: '🇭🇺', country: 'Hungary' },
    gr: { flag: '🇬🇷', country: 'Greece' },
    tr: { flag: '🇹🇷', country: 'Turkey' },
    za: { flag: '🇿🇦', country: 'South Africa' },
    ie: { flag: '🇮🇪', country: 'Ireland' },
    nz: { flag: '🇳🇿', country: 'New Zealand' },
  };

  if (tld && tldMap[tld]) return tldMap[tld];
  return null;
}

async function sendDiscordWebhook(email: string, createdAt: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.error('[Signup] DISCORD_SIGNUP_WEBHOOK_URL not set');
    return;
  }

  const countryInfo = getCountryFromEmail(email);
  const countryText = countryInfo ? `${countryInfo.flag} ${countryInfo.country}` : '🌍 Unknown';

  const embed = {
    title: '🎉 New User Signup',
    color: 0x10b981, // emerald
    fields: [
      {
        name: '📧 Email',
        value: email,
        inline: true,
      },
      {
        name: '🌍 Country',
        value: countryText,
        inline: true,
      },
    ],
    timestamp: createdAt,
    footer: {
      text: 'Chessr.io',
      icon_url: 'https://chessr.io/chessr-logo.png',
    },
  };

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
      console.error(`[Signup] Discord webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error('[Signup] Discord webhook error:', error);
  }
}

async function notifySignups() {
  console.log(`[Signup] Checking for new signups at ${new Date().toISOString()}`);

  try {
    const lastCheck = await getLastCheckTime();
    console.log(`[Signup] Last check: ${lastCheck}`);

    // Get all auth users, paginated
    const newUsers: { email: string; created_at: string }[] = [];
    let page = 1;

    while (true) {
      const { data: batch } = await supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

      if (!batch?.users.length) break;

      for (const user of batch.users) {
        if (user.created_at > lastCheck && user.email) {
          newUsers.push({ email: user.email, created_at: user.created_at });
        }
      }

      if (batch.users.length < 1000) break;
      page++;
    }

    if (newUsers.length === 0) {
      console.log('[Signup] No new signups');
      await updateLastCheckTime();
      return;
    }

    console.log(`[Signup] Found ${newUsers.length} new signup(s)`);

    // Sort by creation date (oldest first)
    newUsers.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const user of newUsers) {
      await sendDiscordWebhook(user.email, user.created_at);
      console.log(`[Signup] Notified: ${user.email}`);
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }

    await updateLastCheckTime();
    console.log('[Signup] Check complete');
  } catch (error) {
    console.error('[Signup] Unexpected error:', error);
  }
}

// Run immediately
notifySignups();
