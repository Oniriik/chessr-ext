-- Migration: Add ban system to user_settings + update activity log types

-- Add ban columns to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS banned_by TEXT;

-- Index for quick ban lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_banned ON user_settings(banned) WHERE banned = true;

-- Update plan_activity_logs CHECK constraint to include ban/unban
ALTER TABLE plan_activity_logs DROP CONSTRAINT IF EXISTS plan_activity_logs_action_type_check;
ALTER TABLE plan_activity_logs ADD CONSTRAINT plan_activity_logs_action_type_check
  CHECK (action_type IN ('cron_downgrade', 'admin_change', 'account_delete', 'user_ban', 'user_unban'));
