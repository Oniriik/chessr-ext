# License verification endpoint — operator setup

`POST /api/license/verify` is the premium gate for client-side WASM engines
(Patricia, Maia 2). Full architecture and rationale live in
[../../../maia2-wasm/patricia-build/LICENSE_DESIGN.md](../../../maia2-wasm/patricia-build/LICENSE_DESIGN.md).
This file covers only what an operator needs to deploy.

## What lives where

| Secret | Where |
|---|---|
| Master private key | Your laptop / 1Password — **never on the server** |
| Master public key  | Baked into every WASM binary at build time |
| Employee batch (.json) | On the production server only, points-to via `LICENSE_EMPLOYEES_PATH` env var |

## Env vars on the serveur

```bash
# Path to the JSON batch generated offline (generate_employee_batch.mjs)
LICENSE_EMPLOYEES_PATH=/opt/chessr/license/employees_2026.json
```

That's it. No private key on the server — the batch JSON itself contains
the per-hour employee private keys, each pre-signed by the master.

## First-time setup

```bash
# 1. (On your laptop, ONCE) Generate master keypair
openssl genpkey -algorithm Ed25519 -out license_master.pem
chmod 400 license_master.pem
# Backup the .pem in 1Password.

# 2. (On your laptop, YEARLY) Generate the employee batch
node serveur/scripts/generate_employee_batch.mjs \
  --master license_master.pem \
  --year 2026 \
  --window 3600 \
  --out employees_2026.json

# Output prints MASTER_PUBLIC_KEY_HEX — copy it for step 4.

# 3. Upload the batch + restart serveur
scp employees_2026.json root@VPS:/opt/chessr/license/
ssh root@VPS '
  echo "LICENSE_EMPLOYEES_PATH=/opt/chessr/license/employees_2026.json" >> /opt/chessr/app/chessr-v3/.env
  cd /opt/chessr/app && docker compose restart server
'

# 4. (ONCE — only on initial setup or master rotation) Bake the master pubkey
#    into the WASM:
cd maia2-wasm/patricia-build/wasm
MASTER_PUBLIC_KEY_HEX=<hex from step 2> ./build.sh
cp patricia.{js,wasm} ../../../chessr-v3/extension/public/engine/

# 5. Apply the Supabase migration
#    Run migrations/20260422_license_grants.sql via the Supabase dashboard.
```

## Smoke test

```bash
# Get a Supabase JWT (from the extension's authStore / chrome.storage.local)
export JWT="eyJ..."
export SERVER="http://localhost:8080"

# Premium user → 200, response contains certificate + signed_response
curl -sS "$SERVER/api/license/verify" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"engine\":\"patricia\",\"nonce\":\"$(openssl rand -hex 16)\",\"timestamp\":$(date +%s)000}"

# Stale timestamp → 400
curl -sS "$SERVER/api/license/verify" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"engine":"patricia","nonce":"aaaabbbbccccddddaaaabbbbccccdddd","timestamp":0}'
```

## When to renew the batch

The batch covers a full year. Renew at least 1 month before the last
employee's `valid_to_ms`. Easy way to monitor: expose `batchHealth()` from
`grantSigner.ts` via the existing `/health` endpoint and watch
`exhausted_in_ms` from the admin dashboard.

## When something is wrong

See the runbook in
[LICENSE_DESIGN.md](../../../maia2-wasm/patricia-build/LICENSE_DESIGN.md#operational-runbook)
for compromised employee / compromised master scenarios.
