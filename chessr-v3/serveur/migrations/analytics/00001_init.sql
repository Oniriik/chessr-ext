-- Analytics DB initial schema
-- ─────────────────────────────────────────────────────────────────────────
-- Two tables off-loaded from Supabase to free the 500 MB free-tier quota:
--   - user_activity   ~620 MB on Supabase, mostly index bloat
--   - game_reviews    ~280 MB on Supabase, mostly TOAST'd JSONB
--
-- Differences vs Supabase:
--   - FK user_activity.user_id → auth.users(id) is dropped (auth.users
--     doesn't exist locally; this DB is event-only, no referential need)
--   - Pruned redundant indexes on user_activity (5 → 2). The Supabase
--     setup had two strict duplicates and two near-duplicates; we keep
--     the two that actually serve real query patterns.
--   - Stays append-only; deletes happen only via a TTL job (see
--     scripts/pg-prune-activity.sql)
-- ─────────────────────────────────────────────────────────────────────────

-- Verified against Supabase via `SELECT enum_range(NULL::activity_event_type)`
-- on 2026-05-06: {suggestion, analysis, explanation, maia_suggestion,
-- game_review, profile_analysis}.
CREATE TYPE activity_event_type AS ENUM (
  'suggestion',
  'analysis',
  'explanation',
  'maia_suggestion',
  'game_review',
  'profile_analysis'
);

-- ─── user_activity ────────────────────────────────────────────────────────
CREATE TABLE user_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  event_type  activity_event_type NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index strategy (down from 5 → 2):
--   1. (user_id, event_type, created_at DESC) covers per-user daily-limit
--      counts (`WHERE user_id = ? AND event_type = ? AND created_at >= ?`)
--      which is the hottest query in explanation.ts + chesscomReview.ts.
--   2. (created_at DESC, event_type) covers dashboard-wide aggregations
--      over time windows.
-- Dropped from Supabase setup:
--   - idx_user_activity_user_event_time      (exact dup of user_type_date)
--   - idx_user_activity_created_at           (covered by #2)
--   - idx_user_activity_user_time            (queries filter user_id first)
CREATE INDEX user_activity_user_event_time_idx
  ON user_activity (user_id, event_type, created_at DESC);
CREATE INDEX user_activity_time_event_idx
  ON user_activity (created_at DESC, event_type);

-- ─── game_reviews ─────────────────────────────────────────────────────────
CREATE TABLE game_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         text NOT NULL,
  platform        text NOT NULL DEFAULT 'chesscom',
  coach_id        text DEFAULT 'Generic_coach',
  analysis        jsonb NOT NULL,
  caps_white      real,
  caps_black      real,
  white_username  text,
  black_username  text,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT game_reviews_game_id_platform_coach_key
    UNIQUE (game_id, platform, coach_id)
);

CREATE INDEX game_reviews_game_id_idx ON game_reviews (game_id);
CREATE INDEX game_reviews_white_idx   ON game_reviews (white_username);
CREATE INDEX game_reviews_black_idx   ON game_reviews (black_username);
