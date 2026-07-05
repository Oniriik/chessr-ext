/**
 * Signup / signin abuse-detection endpoints.
 *
 * Three sub-flows, called by the extension's authStore:
 *
 *   POST /check-signup      → before supabase.auth.signUp. Pass
 *     { fingerprint, email }. We resolve the client IP from the
 *     request, look for fingerprint or IP collisions in user_fingerprints
 *     / signup_ips (excluding the email's own user, if any), and report
 *     back. The reply distinguishes "duplicate but okay" (we don't
 *     block — shared households are fine) from "duplicate AND a
 *     matched account is banned" (we block with an appeal message).
 *
 *   POST /report-signup     → after supabase.auth.signUp succeeds.
 *     Persists the fingerprint + signup IP for the new user_id so the
 *     next abuse check has a footprint to match against.
 *
 *   POST /report-banned-login → fire-and-forget. Sends a Discord embed
 *     to the admin channel when a banned user attempted to log in.
 *
 * All three accept JSON bodies; none require the admin token (these
 * are public flows triggered by the extension before auth completes).
 * The endpoints fail open — a slow / broken DB shouldn't lock legit
 * users out of signup.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/events.js';

export const abuseRoutes = new Hono();

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const NOTIF_CHAN = process.env.DISCORD_NOTIFICATION_CHANNEL_ID;
const APPEAL_INVITE = process.env.DISCORD_APPEAL_INVITE_URL || 'https://discord.gg/72j4dUadTu';
const USERCHECK_API_KEY = process.env.USERCHECK_API_KEY || 'prd_wAyzZvqbPGE3qb57kZnuHAeDJZdv';

// UserCheck disposable / spam-domain check. Fail-open on rate-limit /
// network error — we don't want a flaky third party blocking real
// signups. https://www.usercheck.com/docs/api
async function isDisposableEmail(email: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.usercheck.com/email/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${USERCHECK_API_KEY}` } },
    );
    if (res.status === 429 || !res.ok) return false;
    const data = await res.json() as { disposable?: boolean; spam?: boolean };
    return data.disposable === true || data.spam === true;
  } catch { return false; }
}

// IPv6-mapped IPv4 (`::ffff:1.2.3.4`) → `1.2.3.4`. Drops port suffixes
// when present. Returns null on garbage so callers can short-circuit.
function cleanIpAddress(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.split(',')[0]?.trim() ?? '';
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // Strip port if it sneaks in (rare but seen).
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip || null;
}

export function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string | null {
  // Trust the proxy's X-Forwarded-For — nginx in front of us already
  // strips spoofed values from the client. Falls back to no-IP if both
  // headers are missing (containerised dev environment).
  const xff = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip');
  return cleanIpAddress(xff);
}

// Best-effort country lookup via ip-api.com free tier (45 req/min/IP,
// no API key). Used to enrich signup events with geo so the bot can
// post "new user from FR" embeds. Falls back to nulls on error.
async function resolveIpCountry(ip: string): Promise<{ country: string | null; countryCode: string | null }> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`,
    );
    if (!res.ok) return { country: null, countryCode: null };
    const data = await res.json() as { status?: string; country?: string; countryCode?: string };
    if (data.status === 'success') {
      return { country: data.country ?? null, countryCode: data.countryCode ?? null };
    }
  } catch { /* ignore */ }
  return { country: null, countryCode: null };
}

interface MatchedAccount {
  user_id: string;
  banned: boolean;
  ban_reason: string | null;
  plan: string;
  email?: string | null;
}

async function fetchAccountsByIds(userIds: string[]): Promise<MatchedAccount[]> {
  if (userIds.length === 0) return [];
  const unique = [...new Set(userIds)];
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, banned, ban_reason')
    .in('user_id', unique);
  // Best-effort email enrichment — admin.listUsers per id, parallel.
  const enriched: MatchedAccount[] = [];
  for (const s of settings ?? []) {
    let email: string | null = null;
    try {
      const { data } = await supabase.auth.admin.getUserById(s.user_id);
      email = data?.user?.email ?? null;
    } catch { /* keep email null */ }
    enriched.push({
      user_id: s.user_id,
      plan: s.plan ?? 'free',
      banned: !!s.banned,
      ban_reason: s.ban_reason ?? null,
      email,
    });
  }
  return enriched;
}

// ─── POST /check-signup ─────────────────────────────────────────────────
abuseRoutes.post('/check-signup', async (c) => {
  let fingerprint: string | null = null;
  let email: string | null = null;
  try {
    const body = await c.req.json();
    fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : null;
    email       = typeof body?.email === 'string' ? body.email : null;
  } catch { /* empty body — proceed with nulls */ }

  const clientIp = getClientIp(c);

  // Step 1 — Supabase cross-check on fingerprint + IP (user_fingerprints
  // and signup_ips tables, both indexed). Still much cheaper than the
  // UserCheck call below — and deterministic when a banned account
  // matches, so we can skip UserCheck entirely on the bad-actor path.
  // No need for the auth.admin.listUsers email→id lookup the chessr-
  // next code did: a signup-flow email shouldn't exist yet, and
  // supabase.auth.signUp will reject duplicates later if it does.
  // No time window — matching is all-time. The 10-day window inherited
  // from v2 let multi-accounters simply wait it out; the cost is more
  // IP false positives (recycled carrier-grade NAT pools), which
  // moderators can triage via the matchedBy field on the event.
  let matchedUserIds: string[] = [];
  let reason = '';
  let fpMatch = false;
  let ipMatch = false;
  if (fingerprint) {
    const { data: rows, error } = await supabase
      .from('user_fingerprints')
      .select('user_id')
      .eq('fingerprint', fingerprint);
    if (error) console.warn('[abuse.check-signup] user_fingerprints select:', error);
    if (rows && rows.length > 0) {
      matchedUserIds = rows.map((r) => r.user_id as string);
      reason = 'fingerprint';
      fpMatch = true;
    }
  }
  if (clientIp) {
    const { data: rows, error } = await supabase
      .from('signup_ips')
      .select('user_id')
      .eq('ip_address', clientIp);
    if (error) console.warn('[abuse.check-signup] signup_ips select:', error);
    if (rows && rows.length > 0) {
      matchedUserIds = [...matchedUserIds, ...rows.map((r) => r.user_id as string)];
      if (!reason) reason = 'ip';
      ipMatch = true;
    }
  }
  // What actually triggered the match — moderators need to know if it
  // was the deterministic fingerprint hit (= same device/browser) or
  // an IP collision (very common with carrier-grade NAT / shared
  // households / VPNs). 'both' = highest confidence; 'ip'-only = the
  // false-positive candidate.
  const matchedBy: 'fingerprint' | 'ip' | 'both' | null =
    fpMatch && ipMatch ? 'both' : fpMatch ? 'fingerprint' : ipMatch ? 'ip' : null;

  // Self-exclusion — retrying a signup for the SAME email (typically after
  // a lost confirmation email) matches the half-created account's own
  // footprint. Blocking that traps legit users in a loop with no exit;
  // excluded matches fall through to supabase.signUp, which re-sends the
  // confirmation email for an unconfirmed account and lets the client's
  // already-registered flow guide confirmed ones. Lookup failures keep
  // the match (fail-closed on the exclusion, not on the block).
  if (matchedUserIds.length > 0 && email) {
    const targetEmail = email.toLowerCase();
    const stillMatched: string[] = [];
    for (const id of [...new Set(matchedUserIds)]) {
      try {
        const { data } = await supabase.auth.admin.getUserById(id);
        if ((data?.user?.email ?? '').toLowerCase() === targetEmail) continue;
      } catch { /* keep the match */ }
      stillMatched.push(id);
    }
    matchedUserIds = stillMatched;
  }
  console.log(`[abuse.check-signup] fp=${fingerprint?.slice(0,8) ?? 'none'} ip=${clientIp ?? 'none'} matched=${matchedUserIds.length} by=${matchedBy ?? '-'}`);

  // Step 2 — if any match, resolve their accounts and block. A banned
  // hit gets the dedicated appeal screen; any other match gets a
  // generic "you already have an account" message. Either way we
  // never reach UserCheck (saves rate budget on the bad-actor path).
  if (matchedUserIds.length > 0) {
    const matched = await fetchAccountsByIds(matchedUserIds);
    const bannedHit = matched.find((m) => m.banned);
    notifyDuplicateSignup({ email, reason, fingerprint, ip: clientIp, matched, blocked: true })
      .catch(() => {});
    const { country, countryCode } = clientIp
      ? await resolveIpCountry(clientIp)
      : { country: null, countryCode: null };

    if (bannedHit) {
      await emitEvent({
        type: 'signup_blocked',
        payload: {
          email,
          ip: clientIp,
          country,
          countryCode,
          fingerprint,
          reason: 'banned',
          matchedBy,
          // Strip out unused fields so the embed doesn't carry the
          // whole MatchedAccount shape — emails + plan + banned flag
          // is all the mod-channel needs.
          matchedAccounts: matched.map((m) => ({
            email:    m.email ?? null,
            plan:     m.plan,
            banned:   m.banned,
          })),
          linkedAccountIds: [...new Set(matchedUserIds)],
        },
      });
      return c.json({
        allowed: false,
        reason: 'banned',
        banReason: bannedHit.ban_reason ?? 'Your account was banned.',
        appealUrl: APPEAL_INVITE,
      });
    }

    await emitEvent({
      type: 'signup_blocked',
      payload: {
        email,
        ip: clientIp,
        country,
        countryCode,
        fingerprint,
        reason: 'duplicate',
        matchedBy,
        matchedAccounts: matched.map((m) => ({
          email:    m.email ?? null,
          plan:     m.plan,
          banned:   m.banned,
        })),
        linkedAccountIds: [...new Set(matchedUserIds)],
      },
    });
    return c.json({
      allowed: false,
      reason: 'duplicate',
      message: 'You already have an account.',
      appealUrl: APPEAL_INVITE,
    });
  }

  // Step 3 — only NOW do the rate-limited UserCheck call. Skipped
  // entirely when step 2 already concluded (banned link) — that path
  // doesn't waste a UserCheck request on someone we've decided to
  // reject anyway.
  if (email && await isDisposableEmail(email)) {
    const { country, countryCode } = clientIp
      ? await resolveIpCountry(clientIp)
      : { country: null, countryCode: null };
    await emitEvent({
      type: 'signup_blocked',
      payload: {
        email,
        ip: clientIp,
        country,
        countryCode,
        fingerprint,
        reason: 'disposable',
        linkedAccountIds: [...new Set(matchedUserIds)],
      },
    });
    return c.json({
      allowed: false,
      reason: 'disposable',
      message: 'Disposable email addresses are not allowed. Please use a permanent email.',
    });
  }

  return c.json({ allowed: true });
});

// ─── POST /report-signup ────────────────────────────────────────────────
abuseRoutes.post('/report-signup', async (c) => {
  let userId: string | null = null;
  let email: string | null = null;
  let fingerprint: string | null = null;
  /** Distinguishes a fresh `signup` (we emit signup_success + persist
   *  fingerprint+IP rows) from a `login` re-report (only persists, no
   *  event — login isn't a new user). Defaults to `signup` for back-
   *  compat with the chessr-next pattern. */
  let kind: 'signup' | 'login' = 'signup';
  /** Acquisition channel — set by the client that drove the signup.
   *  Persisted on user_settings.signup_source and surfaced in the
   *  Discord #users feed. Known values: 'unlocker', 'main', 'app'. */
  let source: string | null = null;
  try {
    const body = await c.req.json();
    userId      = typeof body?.userId === 'string' ? body.userId : null;
    email       = typeof body?.email === 'string' ? body.email : null;
    fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : null;
    source      = typeof body?.source === 'string' && body.source.length > 0 ? body.source : null;
    if (body?.kind === 'login') kind = 'login';
  } catch { /* empty */ }
  if (!userId) return c.json({ ok: false, error: 'Missing userId' }, 400);

  const clientIp = getClientIp(c);
  const { country, countryCode } = clientIp
    ? await resolveIpCountry(clientIp)
    : { country: null, countryCode: null };

  // Insert / upsert both records. The supabase builder doesn't reject
  // on DB errors — it resolves with { data, error }. So we have to
  // inspect `error` explicitly; otherwise schema/RLS/missing-table
  // failures end up silently swallowed.
  if (fingerprint) {
    const { error } = await supabase
      .from('user_fingerprints')
      .upsert(
        { user_id: userId, fingerprint },
        { onConflict: 'user_id,fingerprint', ignoreDuplicates: true },
      );
    if (error) console.warn('[abuse.report-signup] user_fingerprints upsert:', error);
  }
  if (clientIp) {
    const { error } = await supabase
      .from('signup_ips')
      .upsert(
        { user_id: userId, ip_address: clientIp, country, country_code: countryCode },
        { onConflict: 'user_id,ip_address', ignoreDuplicates: true },
      );
    if (error) console.warn('[abuse.report-signup] signup_ips upsert:', error);
  }

  // Persist the acquisition source on user_settings so analytics and the
  // admin dashboard can break down signups by channel. Supabase upsert
  // with onConflict=user_id only writes the columns we provide — other
  // user_settings fields keep their default / existing values. Best-
  // effort: a missing user_settings row (no DB trigger yet) just becomes
  // a fresh insert with `signup_source` set; everything else defaults.
  if (kind === 'signup' && source) {
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: userId, signup_source: source },
        { onConflict: 'user_id' },
      );
    if (error) console.warn('[abuse.report-signup] user_settings signup_source upsert:', error);
  }

  // Emit only on the signup path — re-logins don't represent a new
  // user joining and would spam the activity feed.
  if (kind === 'signup') {
    await emitEvent({
      type: 'signup_success',
      user_id: userId,
      payload: { email, ip: clientIp, country, countryCode, fingerprint, source },
    });
  }

  return c.json({ ok: true });
});

// ─── POST /report-banned-login ──────────────────────────────────────────
abuseRoutes.post('/report-banned-login', async (c) => {
  let userId: string | null = null;
  let email = '';
  let banReason = '';
  let fingerprint: string | null = null;
  try {
    const body = await c.req.json();
    userId      = typeof body?.userId === 'string' ? body.userId : null;
    email       = typeof body?.email === 'string' ? body.email : '';
    banReason   = typeof body?.banReason === 'string' ? body.banReason : '';
    fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : null;
  } catch { /* empty */ }

  const clientIp = getClientIp(c);
  const { country, countryCode } = clientIp
    ? await resolveIpCountry(clientIp)
    : { country: null, countryCode: null };

  // Audit trail — admin dashboard / activity feed reads from `events`,
  // so this is the durable record. Discord embed below is just the
  // real-time alert.
  await emitEvent({
    type: 'login_blocked',
    user_id: userId,
    payload: {
      email,
      ip: clientIp,
      country,
      countryCode,
      fingerprint,
      banReason,
    },
  });

  if (!BOT_TOKEN || !NOTIF_CHAN) return c.json({ ok: true, sent: false });

  fetch(`${DISCORD_API}/channels/${NOTIF_CHAN}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify({
      embeds: [{
        title: '🚫 Banned login attempt',
        color: 0xef4444,
        fields: [
          { name: '📧 Email', value: email || 'unknown', inline: true },
          { name: '🌐 IP',    value: clientIp || 'unknown', inline: true },
          { name: '🌍 Country', value: country || '—',    inline: true },
          { name: '📝 Ban reason', value: banReason || '—', inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'chessr.io' },
      }],
    }),
  }).catch((err) => console.warn('[abuse.report-banned-login] discord:', err));

  return c.json({ ok: true, sent: true });
});

// ─── POST /hooks/before-user-created ────────────────────────────────────
// Supabase Auth Hook — GoTrue calls this BEFORE creating any user, no
// matter how the signup was initiated (extension, raw API script with the
// public anon key, curl…). This closes the bypass where /check-signup is
// skipped entirely: the disposable-email gate is enforced here server-to-
// server. Fingerprint/IP gates can't run at this stage (no fingerprint
// exists yet and GoTrue doesn't forward the client IP), so multi-account
// enforcement stays with /check-signup + the free-trial claim gates.
//
// Setup (one-time, Supabase dashboard): Authentication → Hooks →
// "Before User Created" → HTTPS → https://<server>/hooks/before-user-created,
// then copy the generated secret into SUPABASE_BEFORE_USER_CREATED_SECRET.
//
// Payloads are signed with the standardwebhooks scheme (webhook-id /
// webhook-timestamp / webhook-signature headers, HMAC-SHA256 base64).
// Missing secret env → accept-with-warning so enabling the hook in the
// dashboard before deploying the env var can't brick every signup.
function verifyStandardWebhook(secret: string, msgId: string, timestamp: string, body: string, signatureHeader: string): boolean {
  const key = Buffer.from(secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${msgId}.${timestamp}.${body}`).digest('base64');
  return signatureHeader.split(' ').some((part) => {
    const sig = part.startsWith('v1,') ? part.slice(3) : part;
    try {
      const a = Buffer.from(sig, 'base64');
      const b = Buffer.from(expected, 'base64');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch { return false; }
  });
}

abuseRoutes.post('/hooks/before-user-created', async (c) => {
  const raw = await c.req.text();

  const secret = process.env.SUPABASE_BEFORE_USER_CREATED_SECRET;
  if (secret) {
    const msgId = c.req.header('webhook-id') ?? '';
    const ts = c.req.header('webhook-timestamp') ?? '';
    const sig = c.req.header('webhook-signature') ?? '';
    const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
    if (!msgId || !ts || !sig || !fresh || !verifyStandardWebhook(secret, msgId, ts, raw, sig)) {
      console.warn('[abuse.hook] before-user-created: signature verification failed');
      return c.json({ error: { http_code: 401, message: 'Invalid signature' } }, 401);
    }
  } else {
    console.warn('[abuse.hook] SUPABASE_BEFORE_USER_CREATED_SECRET not set — accepting unverified hook payload');
  }

  let email: string | null = null;
  try {
    const body = JSON.parse(raw) as { user?: { email?: string } };
    email = typeof body?.user?.email === 'string' ? body.user.email : null;
  } catch { /* malformed body → allow (GoTrue payload should always parse) */ }

  if (email && await isDisposableEmail(email)) {
    await emitEvent({
      type: 'signup_blocked',
      payload: { email, reason: 'disposable', source: 'auth-hook' },
    }).catch(() => {});
    return c.json({
      error: { http_code: 400, message: 'Disposable email addresses are not allowed. Please use a permanent email.' },
    }, 400);
  }

  // Continue user creation.
  return c.json({});
});

// ─── Discord embed for duplicate-signup events ──────────────────────────
async function notifyDuplicateSignup(args: {
  email: string | null;
  reason: string;
  fingerprint: string | null;
  ip: string | null;
  matched: MatchedAccount[];
  blocked: boolean;
}): Promise<void> {
  if (!BOT_TOKEN || !NOTIF_CHAN) return;
  const linked = args.matched
    .map((m) => `${m.email ?? m.user_id} (${m.plan}${m.banned ? ' · BANNED' : ''})`)
    .join('\n');
  const fields = [
    { name: '📧 Email',  value: args.email || 'unknown', inline: true },
    { name: '🔑 Reason', value: args.reason,             inline: true },
    { name: '🔒 IP',     value: args.ip ?? 'unknown',    inline: true },
  ];
  if (args.fingerprint) {
    fields.push({ name: '🖥️ Fingerprint', value: `\`${args.fingerprint}\``, inline: false });
  }
  if (linked) {
    fields.push({ name: '⚠️ Linked accounts', value: linked, inline: false });
  }
  await fetch(`${DISCORD_API}/channels/${NOTIF_CHAN}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify({
      embeds: [{
        title: args.blocked ? '🚫 Signup blocked — banned linked account' : '⚠️ Multi-account signup',
        color: args.blocked ? 0xef4444 : 0xfacc15,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'chessr.io' },
      }],
    }),
  });
}
