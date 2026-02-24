-- Migration: User activity tracking and global stats
-- Purpose: Track user requests for admin dashboard metrics and Discord bot

-- =============================================================================
-- Table: user_activity - Track each request for period-based stats
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE activity_event_type AS ENUM ('suggestion', 'analysis');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type activity_event_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for time-range queries (most common: active users in last X hours)
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC);

-- Composite index for efficient COUNT(DISTINCT user_id) in time range
CREATE INDEX IF NOT EXISTS idx_user_activity_user_time ON user_activity(created_at DESC, user_id);

-- Enable Row Level Security
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can insert/read (server-side only)
DO $$ BEGIN
    CREATE POLICY "Service role full access on user_activity" ON user_activity
        FOR ALL USING (auth.role() = 'service_role');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- Table: global_stats - Persistent counters for Discord bot
-- =============================================================================

CREATE TABLE IF NOT EXISTS global_stats (
    key TEXT PRIMARY KEY,
    value BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Initialize the counter
INSERT INTO global_stats (key, value) VALUES
    ('total_suggestions', 0),
    ('max_waiting_24h', 0),
    ('max_waiting_updated_at', 0)  -- Unix timestamp of last update
ON CONFLICT (key) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE global_stats ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can modify
DO $$ BEGIN
    CREATE POLICY "Service role full access on global_stats" ON global_stats
        FOR ALL USING (auth.role() = 'service_role');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- Function: increment_stat - Atomically increment a counter
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_stat(stat_key TEXT)
RETURNS void AS $$
    UPDATE global_stats SET value = value + 1, updated_at = now() WHERE key = stat_key;
$$ LANGUAGE SQL;

-- =============================================================================
-- Function: update_max_waiting - Track peak waiting queue size over 24h
-- =============================================================================

CREATE OR REPLACE FUNCTION update_max_waiting(current_waiting BIGINT)
RETURNS void AS $$
DECLARE
    last_update BIGINT;
    current_max BIGINT;
    now_ts BIGINT := EXTRACT(EPOCH FROM now())::BIGINT;
BEGIN
    -- Get current values
    SELECT value INTO last_update FROM global_stats WHERE key = 'max_waiting_updated_at';
    SELECT value INTO current_max FROM global_stats WHERE key = 'max_waiting_24h';

    -- Reset if more than 24h since last update
    IF last_update IS NULL OR (now_ts - last_update) > 86400 THEN
        UPDATE global_stats SET value = current_waiting, updated_at = now() WHERE key = 'max_waiting_24h';
        UPDATE global_stats SET value = now_ts, updated_at = now() WHERE key = 'max_waiting_updated_at';
    -- Otherwise update only if current is higher
    ELSIF current_waiting > COALESCE(current_max, 0) THEN
        UPDATE global_stats SET value = current_waiting, updated_at = now() WHERE key = 'max_waiting_24h';
        UPDATE global_stats SET value = now_ts, updated_at = now() WHERE key = 'max_waiting_updated_at';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON TABLE user_activity IS 'Tracks user activity events (suggestions, analysis) for admin metrics';
COMMENT ON TABLE global_stats IS 'Global counters for persistent stats (e.g., total suggestions for Discord bot)';
COMMENT ON FUNCTION increment_stat IS 'Atomically increments a counter in global_stats';
