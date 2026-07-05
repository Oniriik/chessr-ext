/**
 * Forensic, READ-ONLY probe: find every account linked to a seed email
 * by shared fingerprint, signup IP, or Discord ID. No writes, no Discord
 * notifications, no time window (all-time, unlike the 10-day live check).
 *
 * Run from the serveur dir so @supabase/supabase-js resolves:
 *   node --env-file=.env /tmp/chessr_abuse_probe.mjs lodalodi@gmail.com
 */
import { createClient } from '@supabase/supabase-js';

const SEED_EMAIL = (process.argv[2] || 'lodalodi@gmail.com').toLowerCase();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// ── Build a full user_id → {email, created_at} map (one pass, paginated)
async function loadAllUsers() {
  const byId = new Map();
  const byEmail = new Map();
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('listUsers: ' + error.message);
    const users = data?.users ?? [];
    for (const u of users) {
      const rec = { id: u.id, email: u.email ?? null, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at };
      byId.set(u.id, rec);
      if (u.email) byEmail.set(u.email.toLowerCase(), rec);
    }
    if (users.length < perPage) break;
    page++;
  }
  return { byId, byEmail };
}

const fmt = (rec, extra = '') =>
  `${rec?.email ?? '(no email)'}  [${rec?.id ?? '?'}]${extra}`;

async function main() {
  console.log(`\n=== Forensic probe for: ${SEED_EMAIL} ===\n`);
  console.log('Loading all auth users (paginated)…');
  const { byId, byEmail } = await loadAllUsers();
  console.log(`  → ${byId.size} total users in auth.\n`);

  const seed = byEmail.get(SEED_EMAIL);
  if (!seed) {
    console.log(`!! No auth user found with email ${SEED_EMAIL}.`);
    console.log('   (They may have used a different email, or the account was deleted.)');
    // still try fingerprint/ip search is impossible without a seed id — bail
    return;
  }
  console.log(`Seed account: ${fmt(seed)}`);
  console.log(`  created_at:      ${seed.created_at}`);
  console.log(`  last_sign_in_at: ${seed.last_sign_in_at}\n`);

  // ── Seed's fingerprints + IPs (all-time)
  const { data: seedFps } = await supabase
    .from('user_fingerprints').select('fingerprint, created_at').eq('user_id', seed.id);
  const { data: seedIps } = await supabase
    .from('signup_ips').select('ip_address, country, created_at').eq('user_id', seed.id);
  const fps = [...new Set((seedFps ?? []).map((r) => r.fingerprint))];
  const ips = [...new Set((seedIps ?? []).map((r) => r.ip_address))];
  console.log(`Seed fingerprints (${fps.length}): ${fps.join(', ') || '(none)'}`);
  console.log(`Seed signup IPs   (${ips.length}): ${ips.map((ip) => {
    const row = (seedIps ?? []).find((r) => r.ip_address === ip);
    return `${ip}${row?.country ? ` (${row.country})` : ''}`;
  }).join(', ') || '(none)'}\n`);

  // ── Seed's user_settings (plan / discord / freetrial)
  const { data: seedSettingsArr } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry, banned, ban_reason, discord_id, discord_username, freetrial_used, signup_source')
    .eq('user_id', seed.id);
  const seedSettings = seedSettingsArr?.[0];
  console.log('Seed settings:', JSON.stringify(seedSettings ?? {}, null, 2), '\n');

  // ── Find all user_ids sharing a fingerprint
  const linked = new Map(); // user_id -> Set of reasons
  const addLink = (uid, reason) => {
    if (!linked.has(uid)) linked.set(uid, new Set());
    linked.get(uid).add(reason);
  };

  if (fps.length) {
    const { data } = await supabase
      .from('user_fingerprints').select('user_id, fingerprint, created_at').in('fingerprint', fps);
    for (const r of data ?? []) addLink(r.user_id, `fp:${r.fingerprint.slice(0, 8)}`);
  }
  if (ips.length) {
    const { data } = await supabase
      .from('signup_ips').select('user_id, ip_address, country, created_at').in('ip_address', ips);
    for (const r of data ?? []) addLink(r.user_id, `ip:${r.ip_address}`);
  }
  // ── Discord ID sharing
  const seedDiscord = seedSettings?.discord_id;
  if (seedDiscord) {
    const { data } = await supabase
      .from('user_settings').select('user_id, discord_id').eq('discord_id', seedDiscord);
    for (const r of data ?? []) addLink(r.user_id, `discord:${r.discord_id}`);
  }

  linked.delete(seed.id); // drop the seed itself from the "others" list
  console.log(`=== Linked accounts (${linked.size}) ===\n`);

  if (linked.size === 0) {
    console.log('No other accounts share a fingerprint, signup IP, or Discord ID with the seed.');
  }

  const linkedIds = [...linked.keys()];
  // Pull settings for all linked ids in one query
  let settingsById = new Map();
  if (linkedIds.length) {
    const { data } = await supabase
      .from('user_settings')
      .select('user_id, plan, plan_expiry, banned, ban_reason, discord_id, discord_username, freetrial_used, signup_source')
      .in('user_id', linkedIds);
    for (const s of data ?? []) settingsById.set(s.user_id, s);
  }

  // Sort: trial/pro plans and banned first, then by created_at
  const rows = linkedIds.map((uid) => {
    const u = byId.get(uid);
    const s = settingsById.get(uid) ?? {};
    return { uid, u, s, reasons: [...linked.get(uid)] };
  }).sort((a, b) => (a.u?.created_at ?? '').localeCompare(b.u?.created_at ?? ''));

  for (const { uid, u, s, reasons } of rows) {
    console.log(`• ${u?.email ?? '(no email / deleted)'}  [${uid}]`);
    console.log(`    created:   ${u?.created_at ?? '?'}   lastSignIn: ${u?.last_sign_in_at ?? '—'}`);
    console.log(`    plan:      ${s.plan ?? 'free'}   expiry: ${s.plan_expiry ?? '—'}   freetrial_used: ${s.freetrial_used ?? '?'}`);
    console.log(`    banned:    ${s.banned ? 'YES — ' + (s.ban_reason ?? '') : 'no'}`);
    console.log(`    discord:   ${s.discord_id ? `${s.discord_id} (${s.discord_username ?? '?'})` : '—'}   source: ${s.signup_source ?? '—'}`);
    console.log(`    linked by: ${reasons.join(', ')}`);
    console.log('');
  }

  // Summary: all distinct discord IDs across the cluster
  const allDiscord = new Set();
  if (seedDiscord) allDiscord.add(seedDiscord);
  for (const { s } of rows) if (s.discord_id) allDiscord.add(s.discord_id);
  console.log('=== Discord IDs in this cluster (for events/trial-claim lookup on VPS) ===');
  console.log([...allDiscord].join('\n') || '(none linked)');
  console.log('\n=== All emails in cluster (seed + linked) ===');
  console.log([SEED_EMAIL, ...rows.map((r) => r.u?.email).filter(Boolean)].join('\n'));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
