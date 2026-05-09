#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# migrate-analytics-test.sh
#
# Test migration: copy user_activity + game_reviews from Supabase into the
# local postgres-analytics container. Idempotent — truncates the local
# tables before importing. Safe to run multiple times.
#
# Run on the VPS beta (or anywhere with psql + pg_dump and network reach
# to both DBs).
#
# Usage:
#   SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
#   LOCAL_DATABASE_URL="postgresql://chessr:<password>@localhost:5432/chessr_analytics" \
#   ./scripts/migrate-analytics-test.sh
#
# Get SUPABASE_DB_URL from: Supabase Dashboard → Project Settings →
# Database → Connection string (URI). Use the *direct* connection (port
# 5432), NOT the pooler — pg_dump needs SET commands the pooler rejects.
#
# Pre-req: postgres-analytics container is up and 00001_init.sql has run
# (enum + tables + indexes already exist locally).
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL not set}"
: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL not set}"

DUMP_FILE="/tmp/analytics-snapshot-$(date +%Y%m%d-%H%M%S).sql"

echo "==> Source counts (Supabase)"
psql "$SUPABASE_DB_URL" -c "SELECT 'user_activity' AS t, count(*) FROM user_activity UNION ALL SELECT 'game_reviews', count(*) FROM game_reviews;"

echo
echo "==> pg_dump → $DUMP_FILE"
pg_dump "$SUPABASE_DB_URL" \
  --data-only \
  --no-owner \
  --no-acl \
  --table=public.user_activity \
  --table=public.game_reviews \
  > "$DUMP_FILE"

dump_size=$(du -h "$DUMP_FILE" | cut -f1)
echo "    dump size: $dump_size"

echo
echo "==> Truncating local tables (idempotent reload)"
psql "$LOCAL_DATABASE_URL" <<'SQL'
TRUNCATE user_activity, game_reviews RESTART IDENTITY CASCADE;
SQL

echo
echo "==> Restoring into local Postgres"
psql "$LOCAL_DATABASE_URL" \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  -f "$DUMP_FILE" > /dev/null

echo
echo "==> Backfill v2 dims on imported rows (engine + source for legacy events)"
# Idempotent — `WHERE engine IS NULL` protects rows already filled in by
# chessr-v3 server writes (when USE_LOCAL_DB=true). The
# maia_suggestion→suggestion collapse is also a no-op on already-collapsed
# rows. Safe to run on every re-import.
psql "$LOCAL_DATABASE_URL" <<'SQL'
UPDATE user_activity SET engine = 'maia2',     source = 'server' WHERE event_type = 'maia_suggestion';
UPDATE user_activity SET engine = 'komodo',    source = 'server' WHERE event_type = 'suggestion' AND engine IS NULL;
UPDATE user_activity SET engine = 'stockfish', source = 'server' WHERE event_type = 'analysis'   AND engine IS NULL;
UPDATE user_activity SET event_type = 'suggestion' WHERE event_type = 'maia_suggestion';
SQL

echo
echo "==> Local counts (after import + backfill)"
psql "$LOCAL_DATABASE_URL" -c "SELECT 'user_activity' AS t, count(*) FROM user_activity UNION ALL SELECT 'game_reviews', count(*) FROM game_reviews;"
echo "==> v2 dims breakdown (sanity)"
psql "$LOCAL_DATABASE_URL" -c "SELECT event_type, engine, source, count(*) FROM user_activity GROUP BY event_type, engine, source ORDER BY count(*) DESC;"

echo
echo "==> Sample sanity check (last 3 user_activity rows on each side)"
echo "--- Supabase ---"
psql "$SUPABASE_DB_URL" -c "SELECT user_id, event_type, created_at FROM user_activity ORDER BY created_at DESC LIMIT 3;"
echo "--- Local ---"
psql "$LOCAL_DATABASE_URL" -c "SELECT user_id, event_type, created_at FROM user_activity ORDER BY created_at DESC LIMIT 3;"

echo
echo "==> Done. Next: flip USE_LOCAL_DB=true in serveur/.env"
echo "    and restart the serveur container to start writing locally."
echo
echo "    Dump kept at: $DUMP_FILE (delete when done)"
