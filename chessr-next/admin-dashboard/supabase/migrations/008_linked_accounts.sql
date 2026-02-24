-- Migration: Linked accounts for free trial security
-- Purpose: Link Chess.com/Lichess accounts to Chessr accounts to prevent abuse

-- =============================================================================
-- Table: linked_accounts - Track platform account linkages
-- =============================================================================

CREATE TABLE IF NOT EXISTS linked_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('chesscom', 'lichess')),
    platform_username TEXT NOT NULL,
    platform_user_id TEXT,  -- Unique ID from platform if available
    avatar_url TEXT,
    rating_bullet INT,
    rating_blitz INT,
    rating_rapid INT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_at TIMESTAMPTZ,  -- NULL if active, timestamp if unlinked (soft delete)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: One username per platform can only be linked to ONE active Chessr user
CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_accounts_unique_active
ON linked_accounts(platform, platform_username)
WHERE unlinked_at IS NULL;

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_linked_accounts_user ON linked_accounts(user_id);

-- Index for cooldown checks (recent unlinks)
CREATE INDEX IF NOT EXISTS idx_linked_accounts_unlinked ON linked_accounts(platform, platform_username, unlinked_at)
WHERE unlinked_at IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can access (server-side only)
DO $$ BEGIN
    CREATE POLICY "Service role full access on linked_accounts" ON linked_accounts
        FOR ALL USING (auth.role() = 'service_role');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- Table: signup_ips - Track IPs at signup for abuse detection
-- =============================================================================

CREATE TABLE IF NOT EXISTS signup_ips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ip_address INET NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for IP lookups
CREATE INDEX IF NOT EXISTS idx_signup_ips_ip ON signup_ips(ip_address);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_signup_ips_user ON signup_ips(user_id);

-- Enable Row Level Security
ALTER TABLE signup_ips ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can access
DO $$ BEGIN
    CREATE POLICY "Service role full access on signup_ips" ON signup_ips
        FOR ALL USING (auth.role() = 'service_role');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- Function: check_link_cooldown - Check if cooldown period has passed
-- =============================================================================

CREATE OR REPLACE FUNCTION check_link_cooldown(
    p_platform TEXT,
    p_username TEXT,
    cooldown_hours INT DEFAULT 48
)
RETURNS TABLE (
    has_cooldown BOOLEAN,
    hours_remaining INT,
    unlinked_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        CASE
            WHEN la.unlinked_at IS NULL THEN FALSE
            WHEN EXTRACT(EPOCH FROM (now() - la.unlinked_at)) / 3600 < cooldown_hours THEN TRUE
            ELSE FALSE
        END AS has_cooldown,
        CASE
            WHEN la.unlinked_at IS NULL THEN 0
            ELSE GREATEST(0, cooldown_hours - FLOOR(EXTRACT(EPOCH FROM (now() - la.unlinked_at)) / 3600)::INT)
        END AS hours_remaining,
        la.unlinked_at
    FROM linked_accounts la
    WHERE la.platform = p_platform
      AND la.platform_username = p_username
      AND la.unlinked_at IS NOT NULL
    ORDER BY la.unlinked_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: count_active_links - Count active linked accounts for a user
-- =============================================================================

CREATE OR REPLACE FUNCTION count_active_links(p_user_id UUID)
RETURNS INT AS $$
    SELECT COUNT(*)::INT
    FROM linked_accounts
    WHERE user_id = p_user_id
      AND unlinked_at IS NULL;
$$ LANGUAGE SQL;

-- =============================================================================
-- Function: is_username_linked - Check if a username is already linked to another user
-- =============================================================================

CREATE OR REPLACE FUNCTION is_username_linked(
    p_platform TEXT,
    p_username TEXT,
    p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    is_linked BOOLEAN,
    linked_to_user_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        TRUE AS is_linked,
        la.user_id AS linked_to_user_id
    FROM linked_accounts la
    WHERE la.platform = p_platform
      AND la.platform_username = p_username
      AND la.unlinked_at IS NULL
      AND (p_exclude_user_id IS NULL OR la.user_id != p_exclude_user_id)
    LIMIT 1;

    -- If no rows returned, return false
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::UUID;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON TABLE linked_accounts IS 'Links Chess.com/Lichess accounts to Chessr users for free trial security';
COMMENT ON TABLE signup_ips IS 'Tracks IP addresses at signup for abuse detection';
COMMENT ON FUNCTION check_link_cooldown IS 'Checks if a platform username is in cooldown period after unlinking';
COMMENT ON FUNCTION count_active_links IS 'Counts active linked accounts for a user';
COMMENT ON FUNCTION is_username_linked IS 'Checks if a platform username is already linked to another active user';
