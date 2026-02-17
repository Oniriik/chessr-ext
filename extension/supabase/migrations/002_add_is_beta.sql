-- Add is_beta column to user_settings table
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS is_beta BOOLEAN DEFAULT FALSE;

-- Mark all existing users as beta testers
UPDATE user_settings
SET is_beta = TRUE;

-- Create index for faster lookups on beta users
CREATE INDEX IF NOT EXISTS idx_user_settings_is_beta ON user_settings(is_beta);
