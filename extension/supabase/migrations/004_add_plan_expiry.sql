-- Add plan_expiry column for time-limited plans (premium, freetrial)
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS plan_expiry TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index for expiry lookups (useful for batch expiration checks)
CREATE INDEX IF NOT EXISTS idx_user_settings_plan_expiry ON user_settings(plan_expiry)
WHERE plan_expiry IS NOT NULL;
