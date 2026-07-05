-- LOCAL analytics postgres (chessr_analytics) — apply with:
--   docker exec -i chessr-postgres psql -U chessr -d chessr_analytics < this_file
--
-- Persisted snapshots of the on-demand abuse scan (dashboard /abuse page).
-- One row per manual "Run check"; the dashboard loads the latest row on
-- open and diffs group keys against the previous scan to badge NEW groups.

CREATE TABLE IF NOT EXISTS abuse_scans (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stats       JSONB NOT NULL,
  result      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS abuse_scans_created_at_idx
  ON abuse_scans (created_at DESC);
