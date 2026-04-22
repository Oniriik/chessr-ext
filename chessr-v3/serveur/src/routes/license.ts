/**
 * POST /api/license/verify — premium-gate check for client-side WASM engines
 *                             (Patricia, Maia 2).
 *
 * The WASM engine calls this endpoint via `emscripten_fetch` BEFORE producing
 * each suggestion. If the response isn't signed by our Ed25519 key (held on
 * this server only), the engine refuses to produce output — so a user who
 * has patched the JS layer cannot forge a grant.
 *
 * Flow:
 *   1. Supabase JWT validated (Authorization: Bearer …)
 *   2. User plan must be in PREMIUM_PLANS
 *   3. Client nonce is echoed into the signed payload (anti-replay)
 *   4. Client timestamp must be within ±60s of server clock (anti-replay)
 *   5. Every hit (grant or deny) logged to `license_grants` for observability
 */

import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';
import { isUserPremium } from '../lib/premium.js';
import { signGrant } from '../lib/grantSigner.js';

const SUPPORTED_ENGINES = new Set(['patricia', 'maia2']);
const CLOCK_SKEW_MS = 60_000;      // accept client clocks off by up to 60s
const GRANT_LIFETIME_S = 60;       // grant valid for 60s after signing
const NONCE_HEX_LEN = 32;          // 16 raw bytes = 32 hex chars

// "Fire and forget" insert — audit row must never slow down or fail the hot path.
async function logGrant(opts: {
  userId: string;
  engine: string;
  ip: string | null;
  denied: boolean;
  reason?: string;
}): Promise<void> {
  try {
    await supabase.from('license_grants').insert({
      user_id:       opts.userId,
      engine:        opts.engine,
      ip:            opts.ip,
      denied:        opts.denied,
      denied_reason: opts.reason ?? null,
    });
  } catch { /* observability only — never rethrow */ }
}

interface VerifyBody {
  engine: unknown;
  nonce: unknown;
  timestamp: unknown;
}

export const licenseRoutes = new Hono();

licenseRoutes.post('/api/license/verify', async (c) => {
  // ─── 1. Bearer token → user ──────────────────────────────────────────
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'auth_required' }, 401);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return c.json({ error: 'bad_token' }, 401);
  const userId = authData.user.id;

  // IP for audit trail (honour reverse-proxy headers in prod)
  const ip = c.req.header('cf-connecting-ip')
          ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
          ?? null;

  // ─── 2. Parse + validate body ───────────────────────────────────────
  let body: VerifyBody;
  try { body = await c.req.json<VerifyBody>(); }
  catch { return c.json({ error: 'bad_body' }, 400); }

  const engine = typeof body.engine === 'string' ? body.engine : '';
  if (!SUPPORTED_ENGINES.has(engine)) {
    return c.json({ error: 'unknown_engine' }, 400);
  }

  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  if (!/^[0-9a-fA-F]+$/.test(nonce) || nonce.length !== NONCE_HEX_LEN) {
    return c.json({ error: 'bad_nonce' }, 400);
  }

  const ts = typeof body.timestamp === 'number' ? body.timestamp : NaN;
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > CLOCK_SKEW_MS) {
    // Could also mean a replay — log as denial.
    await logGrant({ userId, engine, ip, denied: true, reason: 'bad_timestamp' });
    return c.json({ error: 'stale_timestamp' }, 400);
  }

  // ─── 3. Premium check (cached 60s in premium.ts) ────────────────────
  const premium = await isUserPremium(userId);
  if (!premium) {
    await logGrant({ userId, engine, ip, denied: true, reason: 'free_plan' });
    return c.json({ error: 'premium_required' }, 403);
  }

  // ─── 4. Sign + return ───────────────────────────────────────────────
  const iat = Math.floor(now / 1000);
  const { certificate, signed_response } = signGrant({
    sub:    userId,
    engine: engine as 'patricia' | 'maia2',
    nonce,
    exp:    iat + GRANT_LIFETIME_S,
    iat,
    iss:    'chessr',
  });

  // Audit row — don't await; best-effort.
  void logGrant({ userId, engine, ip, denied: false });

  return c.json({
    certificate,            // master-signed employee certificate (rotates ~hourly)
    signed_response,        // employee-signed grant
    expires_in: GRANT_LIFETIME_S,
  });
});
