-- Add timestamp tracking for rating syncs and Discord role syncs

-- Track when ratings were last updated by the cron job
ALTER TABLE linked_accounts
ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMPTZ;

-- Track when Discord roles were last synced
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS discord_roles_synced_at TIMESTAMPTZ;
