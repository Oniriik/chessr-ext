/**
 * POST /api/license/verify — premium-gate check for the client-side WASM
 *                             engines (Patricia, Maia 2).
 *
 * The WASM engine calls this endpoint via emscripten_fetch BEFORE producing
 * each suggestion. If the response isn't signed by our Ed25519 key (held on
 * this server only), the engine refuses to produce output — so a user who
 * has patched the JS layer cannot forge a grant.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signGrant } from "./grantSigner.js";

const SUPPORTED_ENGINES = new Set(["patricia", "maia2"]);
const PREMIUM_PLANS = new Set(["premium", "lifetime", "beta", "freetrial"]);
const CLOCK_SKEW_MS = 60_000;
const GRANT_LIFETIME_S = 60;
const NONCE_HEX_LEN = 32;
const MAX_BODY_BYTES = 2048;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}

async function logGrant(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    engine: string;
    ip: string | null;
    denied: boolean;
    reason?: string;
  },
): Promise<void> {
  try {
    await supabase.from("license_grants").insert({
      user_id: opts.userId,
      engine: opts.engine,
      ip: opts.ip,
      denied: opts.denied,
      denied_reason: opts.reason ?? null,
    });
  } catch {
    // observability only — never let an audit failure break the hot path
  }
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleLicenseVerify(
  req: IncomingMessage,
  res: ServerResponse,
  supabase: SupabaseClient,
): Promise<void> {
  console.log(
    "[license] hit from",
    req.headers["x-forwarded-for"] ?? req.socket.remoteAddress,
    "ua=",
    (req.headers["user-agent"] ?? "").toString().slice(0, 60),
  );
  // ─── 1. Bearer token → user ────────────────────────────────────────
  const authHeader = req.headers["authorization"];
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
  if (!token) {
    console.log("[license] denied: auth_required");
    return send(res, 401, { error: "auth_required" });
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !authData.user) {
    console.log("[license] denied: bad_token", authError?.message ?? "");
    return send(res, 401, { error: "bad_token" });
  }
  const userId = authData.user.id;

  const ip =
    (req.headers["cf-connecting-ip"] as string | undefined) ??
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ??
    req.socket.remoteAddress ??
    null;

  // ─── 2. Body validation ────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: "bad_body" });
  }
  const body = raw as { engine?: unknown; nonce?: unknown; timestamp?: unknown };

  const engine = typeof body.engine === "string" ? body.engine : "";
  if (!SUPPORTED_ENGINES.has(engine)) {
    return send(res, 400, { error: "unknown_engine" });
  }

  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!/^[0-9a-fA-F]+$/.test(nonce) || nonce.length !== NONCE_HEX_LEN) {
    return send(res, 400, { error: "bad_nonce" });
  }

  const ts = typeof body.timestamp === "number" ? body.timestamp : NaN;
  const now = Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > CLOCK_SKEW_MS) {
    await logGrant(supabase, {
      userId,
      engine,
      ip,
      denied: true,
      reason: "bad_timestamp",
    });
    return send(res, 400, { error: "stale_timestamp" });
  }

  // ─── 3. Premium check (matches existing pattern in index.ts) ───────
  const { data: settings } = await supabase
    .from("user_settings")
    .select("plan")
    .eq("user_id", userId)
    .single();
  const plan = settings?.plan || "free";
  if (!PREMIUM_PLANS.has(plan)) {
    console.log(`[license] denied: free_plan user=${userId} engine=${engine}`);
    await logGrant(supabase, {
      userId,
      engine,
      ip,
      denied: true,
      reason: "free_plan",
    });
    return send(res, 403, { error: "premium_required" });
  }
  console.log(`[license] grant user=${userId} engine=${engine} plan=${plan}`);

  // ─── 4. Sign + return ──────────────────────────────────────────────
  const iat = Math.floor(now / 1000);
  let signed;
  try {
    signed = signGrant({
      sub: userId,
      engine: engine as "patricia" | "maia2",
      nonce,
      exp: iat + GRANT_LIFETIME_S,
      iat,
      iss: "chessr",
    });
  } catch (err) {
    console.error("[license] signGrant failed:", err);
    return send(res, 500, { error: "signer_unavailable" });
  }

  void logGrant(supabase, { userId, engine, ip, denied: false });

  return send(res, 200, {
    certificate: signed.certificate,
    signed_response: signed.signed_response,
    expires_in: GRANT_LIFETIME_S,
  });
}
