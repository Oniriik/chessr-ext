-- Migration 00002 — break suggestions/analyses down by engine and execution
-- source (server vs wasm), and add a generic metadata bag for the rest
-- (model name for explanations, coach_id / platform for game_review, etc.).
--
-- Single flag drives the new format: when USE_LOCAL_DB=true, writes
-- land here and include engine/source/metadata. When false, writes still go
-- to Supabase via the legacy two-column path (engine/source/metadata are
-- silently dropped — Supabase's user_activity doesn't have these columns).
-- See serveur/src/lib/analyticsRepo.ts for the routing.
--
-- Apply manually after first init:
--   docker compose -f docker-compose.beta.yml exec -T postgres-analytics \
--     psql -U chessr -d chessr_analytics -f /docker-entrypoint-initdb.d/00002_event_dims.sql
--
-- (initdb scripts only auto-run on first boot, so subsequent migrations
-- need explicit psql.)

ALTER TABLE user_activity
  ADD COLUMN engine    text,        -- 'komodo' | 'maia2' | 'maia3' | 'stockfish' (text, not enum: forward-flexible)
  ADD COLUMN source    text,        -- 'server' | 'wasm'
  ADD COLUMN metadata  jsonb;       -- catch-all: model, coach_id, platform, depth, multipv, ...

-- Backfill legacy chessr-next rows. chessr-next executes engines natively
-- in its serveur process (Komodo / Stockfish / Maia binaries), so every
-- pre-v3 row was server-side execution.
UPDATE user_activity SET engine = 'maia2',     source = 'server' WHERE event_type = 'maia_suggestion';
UPDATE user_activity SET engine = 'komodo',    source = 'server' WHERE event_type = 'suggestion' AND engine IS NULL;
UPDATE user_activity SET engine = 'stockfish', source = 'server' WHERE event_type = 'analysis'   AND engine IS NULL;

-- Collapse maia_suggestion into suggestion — the engine column now carries
-- the maia distinction. Avoids two events meaning the same thing.
UPDATE user_activity SET event_type = 'suggestion' WHERE event_type = 'maia_suggestion';

-- Hot-path index for the dashboard's filter pattern:
--   "events of type X, on engine Y, source Z, since time T".
-- Replaces no existing index; the previous (created_at DESC, event_type)
-- still covers wide time-range scans without engine/source filters.
CREATE INDEX user_activity_event_engine_source_time_idx
  ON user_activity (event_type, engine, source, created_at DESC);
