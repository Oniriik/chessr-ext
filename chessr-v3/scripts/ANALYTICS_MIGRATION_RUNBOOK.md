# Analytics DB migration runbook

Off-load `user_activity` + `game_reviews` from Supabase to local Postgres on the beta VPS to free the 500 MB free-tier quota.

## State after this work (already done)

- `docker-compose.beta.yml` ships a `postgres-analytics` service (postgres:16-alpine, persistent volume, healthcheck, internal network only)
- `serveur/migrations/analytics/00001_init.sql` defines the schema (enum + tables + indexes; 5 indexes on `user_activity` pruned to 2)
- `serveur/src/lib/analyticsDb.ts` — pg pool, lazy-init
- `serveur/src/lib/analyticsRepo.ts` — feature-flagged repo (`USE_LOCAL_ANALYTICS=false` → Supabase, `true` → local). Sites refactored: `routes/explanation.ts`, `handlers/chesscomReview.ts`
- `scripts/migrate-analytics-test.sh` — pg_dump + restore + sanity check

## Phase 1 — Confirm enum values (manual, blocking)

The migration SQL has placeholder enum values. Replace with the real list:

```sql
-- in Supabase SQL Editor:
SELECT enum_range(NULL::activity_event_type);
```

Edit `serveur/migrations/analytics/00001_init.sql` — replace the `CREATE TYPE activity_event_type AS ENUM (...)` block with the actual values.

## Phase 2 — Test migration (no production impact)

On the beta VPS:

```bash
# 1. Add ANALYTICS_DB_PASSWORD to /opt/chessr/chessr-v3/.env
echo "ANALYTICS_DB_PASSWORD=$(openssl rand -base64 32 | tr -d /=+)" >> .env

# 2. Boot the Postgres container (will run 00001_init.sql automatically
#    via /docker-entrypoint-initdb.d on first boot)
docker compose -f docker-compose.beta.yml up -d postgres-analytics

# 3. Verify schema
docker compose -f docker-compose.beta.yml exec postgres-analytics \
  psql -U chessr -d chessr_analytics -c '\dt'
docker compose -f docker-compose.beta.yml exec postgres-analytics \
  psql -U chessr -d chessr_analytics -c '\d user_activity'

# 4. Run test migration (USE_LOCAL_ANALYTICS still false — this is just data copy)
SUPABASE_DB_URL="postgresql://postgres.ratngdlkcvyfdmidtenx:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
ANALYTICS_DATABASE_URL="postgresql://chessr:${ANALYTICS_DB_PASSWORD}@localhost:5432/chessr_analytics" \
./scripts/migrate-analytics-test.sh

# Expect counts to match between Supabase and local. Sample rows should match.
```

Get the Supabase direct connection string at: Supabase Dashboard → Project Settings → Database → Connection string (URI). Use port **5432** (direct), NOT 6543 (pooler) — pg_dump emits `SET` commands that the pooler rejects.

## Phase 3 — Flip the feature flag (test write path)

```bash
# In /opt/chessr/chessr-v3/.env
echo "USE_LOCAL_ANALYTICS=true" >> .env
# Restart serveur — Redis stays up, no traffic loss other than the brief
# serveur restart.
docker compose -f docker-compose.beta.yml up -d --force-recreate serveur
```

Validation queries (run on local DB):
```sql
-- After a few real actions on the beta extension:
SELECT count(*), max(created_at) FROM user_activity;
-- max(created_at) should be very recent (last minute) — proves writes
-- are landing on the local DB, not Supabase.
```

If anything looks off → flip back: `USE_LOCAL_ANALYTICS=false` + restart serveur. Zero data loss because the test migration is a copy, not a move; Supabase still has every row up to the snapshot moment.

## Phase 4 — Go-live cutover (when ready)

Picks up from Phase 3 if you stayed in dual-config; otherwise re-run Phase 2 to refresh the local copy from a fresh snapshot.

```bash
# 1. Final pg_dump (run scripts/migrate-analytics-test.sh once more
#    to grab any rows written to Supabase since the test migration)
./scripts/migrate-analytics-test.sh

# 2. USE_LOCAL_ANALYTICS=true in .env (already if Phase 3 was done)
# 3. Restart serveur
docker compose -f docker-compose.beta.yml up -d --force-recreate serveur

# 4. Watch logs for a few hours, validate writes go to local DB
docker compose -f docker-compose.beta.yml logs -f serveur | grep -i "analytics\|user_activity\|game_reviews"

# 5. Once confident (24-48h):
#    - Drop the tables on Supabase to reclaim quota
psql "$SUPABASE_DB_URL" <<'SQL'
DROP TABLE IF EXISTS public.game_reviews;
DROP TABLE IF EXISTS public.user_activity;
DROP TYPE  IF EXISTS public.activity_event_type;
VACUUM FULL;
SQL
```

After the DROP + VACUUM FULL, Supabase usage drops to ~20 MB → safe to downgrade to free plan.

## Phase 5 — Backups (do before going live)

`pg_dump` from the local container, ship to offsite. Quick first version (cron container to add later):

```bash
# Manual: weekly / on demand
docker compose -f docker-compose.beta.yml exec postgres-analytics \
  pg_dump -U chessr -d chessr_analytics --format=custom \
  > /opt/chessr/backups/analytics-$(date +%Y%m%d).dump
```

## Rollback

If anything breaks at any phase:

```bash
# In /opt/chessr/chessr-v3/.env
sed -i 's/^USE_LOCAL_ANALYTICS=.*/USE_LOCAL_ANALYTICS=false/' .env
docker compose -f docker-compose.beta.yml up -d --force-recreate serveur
```

This routes ALL writes/reads back to Supabase. Any rows written to local while the flag was true are stranded there until the next sync — copy them back to Supabase via a one-shot SQL if needed.

## Notes

- The chessr-next admin-dashboard keeps querying Supabase. **Do not change it.** It will start returning empty results for `user_activity` / `game_reviews` only after Phase 4's DROP TABLE on Supabase. By then chessr-next is supposed to be retired anyway.
- The chessr-v3 dashboard does NOT directly query these tables (it goes through the serveur), so it auto-benefits from the migration with no code change.
- `profile_analyses` (15 MB on Supabase) is **not** in scope — it's only used by chessr-next. Stays on Supabase, gets dropped when chessr-next is retired.
