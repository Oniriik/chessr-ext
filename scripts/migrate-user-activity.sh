#!/usr/bin/env bash
# Stream user_activity from Supabase → chessr-postgres on chessr-beta.
# Run from your laptop. Reads SUPA_PG_URL from env so the password never
# touches a file.
#
#   export SUPA_PG_URL='postgresql://postgres.xxx:yyy@.../postgres'
#   ./scripts/migrate-user-activity.sh
#
# What it does:
#   1) pg_dump the user_activity table from Supabase (data only, no schema)
#   2) Pipe through ssh into chessr-postgres on chessr-beta
#   3) Apply the v3 backfill (engine/source/event_type collapse)
#   4) Print before/after row counts

set -euo pipefail

if [[ -z "${SUPA_PG_URL:-}" ]]; then
  echo "ERROR: SUPA_PG_URL not set in env" >&2
  echo "Get the URI from Supabase Dashboard → Project Settings → Database → Connection string" >&2
  exit 1
fi

SSH_HOST="${SSH_HOST:-chessr-beta}"
PG_CONTAINER="${PG_CONTAINER:-chessr-postgres}"
DB_USER="${DB_USER:-chessr}"
DB_NAME="${DB_NAME:-chessr_analytics}"

echo "─── before ───"
ssh "$SSH_HOST" "docker exec $PG_CONTAINER psql -U $DB_USER -d $DB_NAME -c \"SELECT COUNT(*) AS rows_before FROM user_activity\""

echo
echo "─── dumping from Supabase + streaming into local-pg ───"
echo "(this can take a while for 10M+ rows; pg_dump streams INSERT rows, so it's resumable per-row but a clean run is best)"

# We dump with --inserts (one INSERT per row) so a partial failure is
# easy to spot, and we wrap inside a transaction so the import is atomic
# (either all rows land, or none).
pg_dump "$SUPA_PG_URL" \
  --data-only \
  --inserts \
  --table=public.user_activity \
  --no-owner \
  --no-acl \
  --on-conflict-do-nothing \
| ssh "$SSH_HOST" "docker exec -i $PG_CONTAINER psql -U $DB_USER -d $DB_NAME --single-transaction --quiet"

echo
echo "─── backfill (engine / source / event_type collapse) ───"
ssh "$SSH_HOST" "docker exec -i $PG_CONTAINER psql -U $DB_USER -d $DB_NAME" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
UPDATE user_activity SET engine='maia2',     source='server' WHERE event_type='maia_suggestion' AND engine IS NULL;
UPDATE user_activity SET engine='komodo',    source='server' WHERE event_type='suggestion'      AND engine IS NULL;
UPDATE user_activity SET engine='stockfish', source='server' WHERE event_type='analysis'        AND engine IS NULL;
UPDATE user_activity SET event_type='suggestion' WHERE event_type='maia_suggestion';
COMMIT;
SQL

echo
echo "─── after ───"
ssh "$SSH_HOST" "docker exec $PG_CONTAINER psql -U $DB_USER -d $DB_NAME -c \"SELECT COUNT(*) AS rows_after, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM user_activity\""
echo "done."
