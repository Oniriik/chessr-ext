# License-check architecture (Patricia + Maia 2)

## What this is

Premium-only client-side WASM engines (Patricia, Maia 2) that **cannot be
unlocked by patching the JS side of the extension**. Every grant is verified
through a 2-layer Ed25519 signature chain inside the WASM binary itself.

## Why this exists

Patricia and Maia 2 are paid features in Chessr. Free users would otherwise
trivially bypass the gate by editing a single line of JS like
`if (user.plan === 'premium')` to flip it true. This design moves the
enforcement boundary from JS into compiled WASM bytecode, raising the
attack cost from "1-line patch" to "decompile + identify + patch the
bytecode of `license_verify`".

## The trust chain

```
              MASTER keypair                                   ← never on the server, in user's offline safe
                  │
                  │ signs (yearly, batch of 8760 entries)
                  ▼
           EMPLOYEE certificates                               ← rotate every 1 hour
        (one valid window per row)
                  │
                  │ employee signs (online, on Hetzner)
                  ▼
                GRANT                                          ← signed per-request, contains user_id + nonce + exp
                  │
                  │ both certificate + grant returned
                  ▼
              WASM client
                  │
                  ├─ verify(certificate, MASTER pubkey)   → learn employee pubkey
                  ├─ check now ∈ [valid_from, valid_to]
                  ├─ verify(grant, employee pubkey)
                  └─ check engine, nonce echo, exp
                  │
                  ▼
            allow / deny `go`
```

## Components

### 1. Master keypair (offline, never online)

Generated **once** on the user's laptop:

```bash
openssl genpkey -algorithm Ed25519 -out license_master.pem
```

Stored in a password manager / hardware token / paper backup. The 32-byte
public key is baked into every WASM binary at build time and changes only
in the catastrophic case of master compromise.

### 2. Employee batch (regenerated yearly)

Run on the user's laptop (offline session):

```bash
node serveur/scripts/generate_employee_batch.mjs \
  --master /secure/license_master.pem \
  --year 2026 \
  --window 3600 \
  --out employees_2026.json
```

This generates 8760 ed25519 keypairs (one per hour for the year) and signs
each with the master. Output is a single JSON file (~30 MB) containing:
- For each employee: `{ private_key_pem, certificate_b64, valid_from_ms, valid_to_ms, id }`
- The certificate is `base64url( master_signature[64] || cert_payload_utf8 )`
- The cert payload describes the employee pubkey + its 1-hour validity window

The user uploads this file to the production server (`scp employees_2026.json
root@vps:/opt/chessr/license/`) and points `LICENSE_EMPLOYEES_PATH` at it.
**The master private key never leaves the laptop.**

### 3. Server endpoint (`POST /api/license/verify`)

For each request:
1. Validate the Supabase JWT (Bearer header) → resolve to `user_id`
2. Check `isUserPremium(user_id)` (cached 60s)
3. Validate `nonce` format (16 bytes hex) + `timestamp` within ±60s
4. Pick the currently-active employee from the batch (whose
   `valid_from_ms <= now < valid_to_ms`)
5. Sign a grant payload `{ sub, engine, nonce, exp, iat, iss }` with the
   employee's private key
6. Return both:
   - `certificate`: the master-signed employee cert (rotates hourly, but
     identical for all users in the same hour)
   - `signed_response`: this user's grant signed by the current employee
7. Insert one row in `license_grants` for observability

### 4. Client WASM verification

The WASM does NOT cache anything. Every `go` triggers a fresh server call.
The server's `isUserPremium` cache (60s in-memory) keeps each call cheap
(~5ms server-side). Strict offline behaviour — no network = no suggestions.

For each `go`:
1. Generate fresh nonce (Web Crypto, 16 bytes)
2. Synchronous `emscripten_fetch` POST to the server with the user's JWT
3. Parse response; verify certificate signature against baked MASTER key;
   extract the employee pubkey + window
4. Verify the grant signature against the employee pubkey
5. Check the cert window is current
6. Check the grant payload's engine claim, nonce echo, expiry

Any single failure → `false` returned → the WASM emits no `bestmove`.

## Why hierarchical (master + employees)?

Without hierarchy: one private key on the server. If it leaks (Hetzner
compromise, sloppy backup, etc.) → attacker can sign grants for any user
forever, until you ship a new extension version with a new public key
(takes ~24 hours via Chrome Web Store auto-update, during which the
attacker has free reign).

With hierarchy: only employee keys live on the server. If one leaks:
- The attacker has at most **1 hour** of validity before the next employee
  takes over (cert expires)
- You can immediately mark that employee as compromised in the server
  config and force-skip to the next one
- The master is in your safe, untouched
- **No client update required** — the next hour's cert is signed by the
  same master, so the WASM accepts it transparently

Master rotation is reserved for the catastrophic case (master itself
leaks) and DOES require a new extension build + roll-out.

## Threat model (what's blocked, what isn't)

**Blocked by this design:**
- `if (plan === 'premium')` patch in JS → server still issues no grant
- `requestGrant()` helper patch in JS → no longer exists; WASM does the call
- Patching the `emscripten_fetch` shim to forge a response → fails
  master-key signature verification
- Replaying a captured response on a different user → grant payload's
  `sub` claim doesn't match (verified server-side via JWT)
- Replaying a captured response after 60s → cert + grant exp both reject
- Capturing an employee key from disk → 1-hour blast radius, then dead

**Not blocked (acted limitations):**
- Decompiling the WASM (`wabt`, `binaryen`), identifying the verify
  function, and patching it to always return `true`. Effort: hours per
  build, must redo on every new extension version. Detectable
  server-side: zero `/api/license/verify` calls from a user who claims
  to use Patricia.
- A genuinely-premium user sharing their session token with friends.
  Mitigation: rate-limit by `user_id` + IP fingerprint analysis.
- Master key compromise. Recovery: generate new master, rebuild WASM,
  ship extension update, revoke old master entirely.

## Operational runbook

### First-time setup

1. (Once) Generate master keypair on laptop:
   ```bash
   openssl genpkey -algorithm Ed25519 -out license_master.pem
   chmod 400 license_master.pem
   # Store BACKUP in 1Password or equivalent — losing this = catastrophic
   ```
2. (Once) Generate first batch:
   ```bash
   node serveur/scripts/generate_employee_batch.mjs \
     --master license_master.pem --year 2026 --out employees_2026.json
   # Note the printed MASTER_PUBLIC_KEY_HEX
   ```
3. (Once) Bake the master pubkey into the WASM:
   ```bash
   cd maia2-wasm/patricia-build/wasm
   MASTER_PUBLIC_KEY_HEX=<hex> ./build.sh
   ```
4. Upload the batch + WASM:
   ```bash
   scp employees_2026.json root@VPS:/opt/chessr/license/
   cp patricia.{js,wasm} chessr-v3/extension/public/engine/
   # On VPS: set LICENSE_EMPLOYEES_PATH and restart serveur
   ```

### Yearly renewal (~30s of work)

When `batchHealth().exhausted_in_ms` falls below ~1 month, generate next year:

```bash
node serveur/scripts/generate_employee_batch.mjs \
  --master license_master.pem --year 2027 --out employees_2027.json
scp employees_2027.json root@VPS:/opt/chessr/license/
ssh root@VPS 'sed -i s/employees_2026/employees_2027/ /opt/chessr/.env && systemctl restart chessr-server'
```

### Compromised employee

If you suspect an employee key leaked (anomalous grant patterns):

```bash
# Find the offending employee_id from license_grants logs
# Edit employees_2026.json: set valid_to_ms of the bad row to "now"
# Restart serveur — it'll skip to the next employee in the batch
```

The WASM will reject the bad employee's grants from now on (cert window
fails).

### Compromised master (catastrophe mode)

```bash
# 1. Generate new master
openssl genpkey -algorithm Ed25519 -out license_master_v2.pem
# 2. Generate new batch with new master
node generate_employee_batch.mjs --master license_master_v2.pem --year 2026 --out employees_2026_v2.json
# 3. Rebuild WASM with new MASTER_PUBLIC_KEY_HEX
# 4. Ship new extension version — old extensions stop working when their
#    cached cert expires (~1h)
```

## File layout

```
maia2-wasm/patricia-build/
├── wasm/
│   ├── monocypher/             # Vendored Ed25519 verifier (public domain)
│   ├── license.cpp / license.h # WASM-side verifier (no comments — anti-RE)
│   ├── patricia_wasm.cpp       # Engine entrypoints, gates `go` via license_verify
│   └── build.sh                # Reads MASTER_PUBLIC_KEY_HEX, sed-injects, em++
└── LICENSE_DESIGN.md           # This file

chessr-v3/serveur/
├── src/lib/grantSigner.ts      # Loads employee batch, picks current, signs grant
├── src/routes/license.ts       # POST /api/license/verify endpoint
├── src/routes/LICENSE_SETUP.md # Operator-facing setup notes
├── scripts/generate_employee_batch.mjs   # Offline tool, run on user's laptop
└── migrations/20260422_license_grants.sql

chessr-v3/extension/entrypoints/content/lib/
└── patriciaSuggestionEngine.ts # Pushes Supabase JWT into WASM, subscribes to refresh
```
