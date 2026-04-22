# Chessr — License system (premium-gated WASM engines)

Cryptographic license enforcement for client-side WASM engines (Patricia,
Maia 2). Prevents free users from bypassing the premium gate by patching
the JS layer of the extension.

> **TL;DR for someone unfamiliar:** Each premium engine makes its own
> HTTPS call **from inside the WASM binary** to our server before every
> suggestion. The server only signs grants for premium users (Ed25519).
> The WASM verifies the signature against a master public key baked at
> build time. No valid signature → engine returns nothing. Bypass requires
> reverse-engineering the WASM bytecode (hours, redo on every release)
> instead of patching one JS line (works in 30 seconds today).

---

## Table of contents

- [Architecture](#architecture)
- [Components](#components)
- [Per-suggestion flow](#per-suggestion-flow)
- [First-time setup](#first-time-setup)
- [Local testing](#local-testing)
- [Production deployment](#production-deployment)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Threat model](#threat-model)
- [References](#references)

---

## Architecture

Two-level PKI (master + rotating employees):

```
[MASTER keypair]
   private key  →  on your laptop, offline, in 1Password — NEVER on the server
   public key   →  baked into patricia.wasm + maia.wasm at build time

   │ master signs (offline, one batch per year of 8760 entries)
   ▼

[EMPLOYEE keypairs]  (one valid per hour)
   private keys  →  on the production server (employees_2026.json)
   public keys   →  embedded in their respective master-signed certificates
                    (also in employees_2026.json), shipped to the client
                    in every grant response

   │ current employee signs (online, on Hetzner, per request)
   ▼

[GRANT]  (signed for one specific user + nonce + 60s window)
```

**Why hierarchical**: if an employee key leaks (server compromise), the blast
radius is at most 1 hour before rotation invalidates it. The master key never
leaves your offline backup, so there is no online attack surface that can
compromise the root of trust.

---

## Components

### Server side — `chessr-v3/serveur/`

| File | Role |
|------|------|
| `src/routes/license.ts` | `POST /api/license/verify` endpoint |
| `src/lib/grantSigner.ts` | Loads employee batch, picks current, signs grant |
| `src/routes/LICENSE_SETUP.md` | Operator-facing setup notes |
| `migrations/20260422_license_grants.sql` | Audit table (granted/denied logs) |
| `scripts/generate_employee_batch.mjs` | **Offline** tool — generates the yearly batch on your laptop |

Dependencies: `jose` (Ed25519 sign), reuses existing `@supabase/supabase-js`
+ `lib/premium.ts` for plan check (cache 60s).

### WASM side — `maia2-wasm/`

| File | Role |
|------|------|
| `patricia-build/wasm/license.{cpp,h}` | Verify chain (master → cert → grant) in C++ |
| `patricia-build/wasm/monocypher/` | Vendored Ed25519 verifier (public domain) |
| `patricia-build/wasm/build.sh` | em++ build, injects `MASTER_PUBLIC_KEY_HEX` via sed |
| `patricia-build/LICENSE_DESIGN.md` | Architecture deep-dive (paired with this doc) |
| `maia-runtime/src/{ops,model,encoding}.{cpp,h}` | Custom ONNX runtime for Maia (replaces onnxruntime-web) |
| `maia-runtime/scripts/extract_weights.py` | Extracts Maia 2 PyTorch weights into a flat C array |
| `maia-runtime/scripts/make_reference.py` | Generates PyTorch ground-truth for parity testing |
| `maia-runtime/tests/parity_test.mjs` | Validates 100% top-3 match vs PyTorch on 10 positions |

The Maia runtime imports the same `license.cpp` + `monocypher/` from the
Patricia build dir — single license-check codebase, two engines.

### Extension side — `chessr-v3/extension/`

| File | Role |
|------|------|
| `entrypoints/content/lib/patriciaSuggestionEngine.ts` | Worker, push JWT, search wrapper |
| `entrypoints/content/lib/maiaSuggestionEngine.ts` | Worker, push JWT, post-processing (legal moves, polyglot book) |
| `public/engine/patricia.{js,wasm}` | Built artifacts (gitignored) |
| `public/engine/maia2/maia.{js,wasm}` | Built artifacts (gitignored) |
| `public/engine/maia2/{moves.json, zobrist.bin}` | Static data (small, tracked OK) |

---

## Per-suggestion flow

```
┌─ User plays a move ───────────────────────────────────────────────────────┐
│                                                                           │
│  1. WASM generates random 16-byte nonce + Unix-ms timestamp               │
│  2. WASM → POST /api/license/verify                                       │
│     {engine, nonce, timestamp} + Bearer <Supabase JWT>                    │
│                                                                           │
│  3. Server: validate JWT (offline)                                        │
│  4. Server: isUserPremium(user_id)  (60s cache)                           │
│  5. Server: pick current employee (whose valid_from ≤ now < valid_to)     │
│  6. Server: sign grant {sub, engine, nonce, exp+60s} with employee key    │
│  7. Server → returns {certificate, signed_response, expires_in}           │
│                                                                           │
│  8. WASM: crypto_eddsa_check(certificate, MASTER_PUBLIC_KEY)              │
│  9. WASM: parse cert payload → extract employee_pubkey + valid window     │
│ 10. WASM: crypto_eddsa_check(signed_response, employee_pubkey)            │
│ 11. WASM: parse grant payload, check engine + nonce echo + exp            │
│                                                                           │
│ 12. ✅ all OK → compute suggestion → return                                │
│     ❌ any fail → return nothing → no suggestion in UI                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

No client-side caching of grants. Each suggestion = one fresh server call.
Strict offline behaviour: no network = no suggestion.

---

## First-time setup

Done **once**, on your laptop, when you bootstrap the system.

### 1. Generate the master keypair (offline)

```bash
mkdir -p ~/Documents/chessr-license
cd ~/Documents/chessr-license

openssl genpkey -algorithm Ed25519 -out license_master.pem
chmod 400 license_master.pem
```

**Backup the `.pem` immediately** in 1Password (or equivalent). Title it
clearly: "Chessr License Master Key — DO NOT LOSE". Without it you cannot
generate new employee batches and rotation eventually fails.

### 2. Generate the first yearly employee batch

```bash
cd /path/to/chessr/repo

node chessr-v3/serveur/scripts/generate_employee_batch.mjs \
  --master ~/Documents/chessr-license/license_master.pem \
  --year 2026 \
  --window 3600 \
  --out ~/Documents/chessr-license/employees_2026.json
```

Output:
- `employees_2026.json` — 8760 employees pre-signed, ~3.8 MB
- Printed `MASTER_PUBLIC_KEY_HEX` — copy this hex string for step 3

### 3. Bake the master public key into both WASMs

```bash
export MASTER_PUBLIC_KEY_HEX=<hex from step 2>

cd maia2-wasm/patricia-build/wasm
./build.sh

cd ../../maia-runtime/wasm
./build.sh
```

Outputs:
- `maia2-wasm/patricia-build/wasm/patricia.{js,wasm}` (~4.7 MB)
- `maia2-wasm/maia-runtime/wasm/maia.{js,wasm}` (~81 MB)

### 4. Copy WASM artifacts into the extension

```bash
cp maia2-wasm/patricia-build/wasm/patricia.{js,wasm} \
   chessr-v3/extension/public/engine/

cp maia2-wasm/maia-runtime/wasm/maia.{js,wasm} \
   chessr-v3/extension/public/engine/maia2/
```

### 5. Build the extension

```bash
cd chessr-v3/extension
npx wxt build
```

Output at `.output/chrome-mv3/` — load unpacked in Chrome to test.

### 6. Apply the Supabase migration

In the Supabase dashboard SQL editor, run the contents of:

```
chessr-v3/serveur/migrations/20260422_license_grants.sql
```

Creates the `license_grants` audit table.

---

## Local testing

### Quick (Niveau 1) — server endpoint with curl

```bash
# 1. Set env on your local serveur
cd chessr-v3/serveur
echo "LICENSE_EMPLOYEES_PATH=$HOME/Documents/chessr-license/employees_2026.json" >> .env

# 2. Run dev server
npm run dev   # listens on http://localhost:8080

# 3. Get a Supabase JWT from your existing extension's authStore
#    (DevTools → Application → Local Storage → sb-…-auth-token → access_token)
export JWT="eyJ..."

# 4. Test grant request — premium user → 200 + signed_response
curl -s http://localhost:8080/api/license/verify \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"engine\":\"patricia\",\"nonce\":\"$(openssl rand -hex 16)\",\"timestamp\":$(date +%s)000}" | jq

# Expected:
# {
#   "certificate": "Z2K5...",
#   "signed_response": "abc...",
#   "expires_in": 60
# }

# 5. Stale timestamp → 400
curl -s http://localhost:8080/api/license/verify \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"engine":"patricia","nonce":"aaaabbbbccccddddaaaabbbbccccdddd","timestamp":0}' | jq
# → {"error":"stale_timestamp"}

# 6. Check audit table
# In Supabase SQL: SELECT * FROM license_grants ORDER BY granted_at DESC LIMIT 10;
```

### Full (Niveau 2) — extension + Chrome

For end-to-end testing with a local serveur, **rebuild the WASMs with the
local server URL** so the engine talks to localhost instead of prod:

```bash
cd maia2-wasm/patricia-build/wasm
MASTER_PUBLIC_KEY_HEX=<your hex> \
LICENSE_URL=http://localhost:8080/api/license/verify \
./build.sh

cd ../../maia-runtime/wasm
MASTER_PUBLIC_KEY_HEX=<your hex> \
LICENSE_URL=http://localhost:8080/api/license/verify \
./build.sh

# Copy into extension + rebuild
cp ../../patricia-build/wasm/patricia.{js,wasm} \
   ../../../chessr-v3/extension/public/engine/
cp maia.{js,wasm} ../../../chessr-v3/extension/public/engine/maia2/
cd ../../../chessr-v3/extension && npx wxt build
```

Then:
1. Chrome → `chrome://extensions` → Developer mode → Load unpacked →
   `chessr-v3/extension/.output/chrome-mv3/`
2. Disable any production Chessr install (avoid conflicts)
3. Log in with a premium account, open chess.com, start a game
4. Settings → Engine → switch to Patricia / Maia 2
5. DevTools → Network tab → filter on `localhost:8080` — every move
   triggers one POST to `/api/license/verify`

### Bypass tests (proves the gate works)

| Test | Expected |
|------|----------|
| Kill the local serveur | Suggestions disappear instantly (no fetch ⇒ no signature ⇒ no output) |
| In Chrome DevTools, patch the worker bootstrap to skip the JWT push | WASM has no Bearer ⇒ server returns 401 ⇒ no suggestion |
| Block the `/api/license/verify` request via DevTools "Block request URL" | Same as kill: no suggestion |
| Try to forge a fake response with arbitrary bytes | `crypto_eddsa_check` fails ⇒ no suggestion |
| Patch the WASM bytecode to short-circuit `license_verify` to `true` | This is the **only** working bypass — costs hours per release, redo every update |

---

## Production deployment

After local testing passes, deploy to the Hetzner VPS.

### A) Push the employee batch

```bash
scp -i ~/.ssh/id_ed25519 \
    ~/Documents/chessr-license/employees_2026.json \
    root@91.99.78.172:/opt/chessr/license/
```

### B) Configure the env var on the VPS

```bash
ssh -i ~/.ssh/id_ed25519 root@91.99.78.172 \
    'echo "LICENSE_EMPLOYEES_PATH=/opt/chessr/license/employees_2026.json" \
     >> /opt/chessr/app/chessr-v3/.env'
```

### C) Restart the serveur

```bash
ssh -i ~/.ssh/id_ed25519 root@91.99.78.172 \
    'cd /opt/chessr/app && docker compose restart server'
```

### D) Build and ship the extension

The WASMs in `extension/public/engine/` MUST be the ones built with the
**production** master pubkey (not test/dummy). Verify with:

```bash
strings chessr-v3/extension/public/engine/patricia.wasm | grep -A1 "engine.chessr.io"
# Should show your real LICENSE_URL_OVERRIDE
```

Then ship the extension to users via your usual channel
(`extension/scripts/publish.sh` if applicable, or Chrome Web Store, or
chessr.io download).

### E) Smoke test in production

1. Install the published extension in Chrome
2. Log in with a real premium account
3. Play a move on chess.com → suggestions should appear
4. In Supabase: `SELECT count(*) FROM license_grants WHERE denied = false AND granted_at > now() - interval '5 minutes';` should be > 0

---

## Operations

### Yearly batch renewal (~30 seconds of work)

When `batchHealth().exhausted_in_ms` falls below ~1 month (monitor in admin
dashboard, or just set a calendar reminder for 1 December every year):

```bash
cd /path/to/chessr/repo

node chessr-v3/serveur/scripts/generate_employee_batch.mjs \
  --master ~/Documents/chessr-license/license_master.pem \
  --year 2027 \
  --out ~/Documents/chessr-license/employees_2027.json

scp -i ~/.ssh/id_ed25519 \
    ~/Documents/chessr-license/employees_2027.json \
    root@91.99.78.172:/opt/chessr/license/

ssh -i ~/.ssh/id_ed25519 root@91.99.78.172 \
    'sed -i "s|employees_2026|employees_2027|" /opt/chessr/app/chessr-v3/.env \
     && cd /opt/chessr/app && docker compose restart server'
```

The master pubkey is unchanged across batches → **no extension rebuild needed**.

### Compromised employee (suspected key leak)

If you spot anomalous patterns in `license_grants` (e.g. one user_id with
50× the normal grant rate, or impossible IP geo-spread):

```sql
-- Identify the offending employee_id from logs (cross-reference granted_at
-- with batch valid_from windows)
```

Then on the VPS, edit the JSON to expire the suspect employee immediately:

```bash
ssh -i ~/.ssh/id_ed25519 root@91.99.78.172
jq '(.employees[] | select(.id == 437)).valid_to_ms = (now * 1000 | floor)' \
   /opt/chessr/license/employees_2026.json > /tmp/patched.json
mv /tmp/patched.json /opt/chessr/license/employees_2026.json
cd /opt/chessr/app && docker compose restart server
```

The WASM rejects any grant signed by the compromised employee from now on
(cert validity window check fails).

### Compromised master (catastrophe)

If the master `.pem` itself leaks (your laptop is stolen, 1Password breached,
etc.):

```bash
# 1. Generate a new master
openssl genpkey -algorithm Ed25519 -out license_master_v2.pem
chmod 400 license_master_v2.pem

# 2. Generate a new batch with the new master
node chessr-v3/serveur/scripts/generate_employee_batch.mjs \
  --master license_master_v2.pem --year 2026 --out employees_2026_v2.json

# 3. Rebuild WASMs with the new MASTER_PUBLIC_KEY_HEX (printed in step 2)
cd maia2-wasm/patricia-build/wasm && MASTER_PUBLIC_KEY_HEX=<new hex> ./build.sh
cd ../../maia-runtime/wasm && MASTER_PUBLIC_KEY_HEX=<new hex> ./build.sh

# 4. Ship a new extension version IMMEDIATELY
#    Old extensions stop working when their cached cert expires (next request)
```

Old extensions will still work for whatever batch is on the server until:
- You replace `employees_2026.json` on the server with `employees_2026_v2.json`
- AND old extensions request a grant whose cert verification fails against
  the **new** master pubkey baked into v2 of the extension

**Order of operations matters**: ship the new extension FIRST (Chrome Web
Store auto-update takes ~24h), THEN replace the server batch. Otherwise old
extensions break before users update.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `LICENSE_EMPLOYEES_PATH not set` at server boot | Env var missing | Add it to `.env`, restart |
| All requests return 401 `bad_token` | JWT expired or invalid | Re-login on the extension; the auto-refresh listener should push a fresh token |
| All requests return 403 `premium_required` | User is not premium in Supabase | Check `user_settings.plan` for that user |
| Requests return 400 `stale_timestamp` | Server or client clock drift > 60s | NTP on VPS (`systemctl status systemd-timesyncd`); on user side rare |
| `License employee batch exhausted` error | Past `valid_to_ms` of the last entry | Generate next year's batch (see "Yearly renewal") |
| Suggestions disappear suddenly for all users | Batch file unreadable, malformed JSON, or master pubkey mismatch | Check serveur logs; re-upload the batch; verify build env's `MASTER_PUBLIC_KEY_HEX` matches what's in the WASMs |
| New extension version: nothing works | Built with wrong/dummy `MASTER_PUBLIC_KEY_HEX` (e.g. the placeholder `0000…0001`) | Rebuild with the real hex from `openssl pkey -in license_master.pem -pubout -outform DER \| tail -c 32 \| xxd -p -c 64` |
| Extension works in dev, not prod | Built with `LICENSE_URL=http://localhost:…` instead of `https://engine.chessr.io/…` | Rebuild without overriding `LICENSE_URL` (defaults to prod URL) |

### Useful queries on `license_grants`

```sql
-- Recent denials by reason (last 24h)
SELECT denied_reason, COUNT(*) FROM license_grants
WHERE granted_at > now() - interval '24 hours' AND denied = true
GROUP BY denied_reason ORDER BY 2 DESC;

-- Top users by grant volume (last 24h)
SELECT user_id, COUNT(*) FROM license_grants
WHERE granted_at > now() - interval '24 hours' AND denied = false
GROUP BY user_id ORDER BY 2 DESC LIMIT 10;

-- Free users who somehow obtained grants (should always be 0)
SELECT lg.user_id, COUNT(*) FROM license_grants lg
JOIN user_settings us ON us.user_id = lg.user_id
WHERE lg.granted_at > now() - interval '24 hours'
  AND lg.denied = false
  AND us.plan NOT IN ('premium', 'lifetime', 'beta', 'freetrial')
GROUP BY lg.user_id;
```

---

## Threat model

### What this design blocks

| Attack | Blocked because |
|--------|-----------------|
| Patch `if (plan === 'premium')` in JS | The decision is on the server, not the client |
| Patch the JS engine wrapper to skip the license call | The WASM does its own `emscripten_fetch`; it doesn't trust the JS to call out |
| Patch `emscripten_fetch` shim to forge a response | Forged responses fail the Ed25519 signature check against the master pubkey |
| Capture a valid response and replay it on a different request | The grant payload contains the original nonce; it won't match a freshly-generated one |
| Cancel premium and keep using engines | Every suggestion re-checks; server returns 403 silently |
| Leak the master public key from the WASM | Public key is, well, public; useless without the matching private key |
| Compromise the production server (RCE) | Attacker gets the **employee** keys (max 1h validity each), not the master. Rotation invalidates within an hour. |

### What this design does NOT block (acted)

- **Reverse-engineering the WASM** to patch `license_verify` to always return
  `true`. Cost: hours per release, redo on every update. We monitor this
  server-side: a user actively using engines should generate `/verify` calls.
- **Sharing premium credentials**. If a paying user shares their Supabase
  session with friends, those friends become "effectively premium". Mitigated
  by rate limiting per `user_id` + IP fingerprinting.
- **Engines themselves are public upstream** (Patricia MIT on GitHub,
  Maia 2 on CSSLab/maia2). This design protects **our Chessr build**, not the
  engines as standalone software. Someone who just wants Patricia or Maia 2
  can clone upstream and recompile.

---

## References

### Primitives we use
- [RFC 8032 — Ed25519](https://datatracker.ietf.org/doc/html/rfc8032)
- [Monocypher](https://monocypher.org) — the Ed25519 verifier we vendored
  (single-file, public domain)
- [jose](https://github.com/panva/jose) — Node ESM lib for Ed25519 sign

### Patterns we modelled on
- [Google Play Licensing (LVL)](https://developer.android.com/google/play/licensing/overview)
  — same architecture, different crypto
- [Apple App Store Receipt Validation](https://developer.apple.com/documentation/appstorereceipts/validating_receipts_with_the_app_store)
  — same idea (server-signed payload verified client-side)
- [Widevine DRM](https://developers.google.com/widevine) — same family, more
  involved (DRM video)

### Internal companion docs
- [`maia2-wasm/patricia-build/LICENSE_DESIGN.md`](../maia2-wasm/patricia-build/LICENSE_DESIGN.md)
  — architecture deep-dive (technical, repo-internal)
- [`chessr-v3/serveur/src/routes/LICENSE_SETUP.md`](../chessr-v3/serveur/src/routes/LICENSE_SETUP.md)
  — minimal operator setup (env vars, scp commands)
