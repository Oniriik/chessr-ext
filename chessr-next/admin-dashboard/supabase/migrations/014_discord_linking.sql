-- Discord linking columns on user_settings
-- Allows users to link their Discord account to start free trial
-- and receive automatic roles in the Discord server

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS discord_username TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS discord_linked_at TIMESTAMPTZ;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS freetrial_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS discord_avatar TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS discord_in_guild BOOLEAN NOT NULL DEFAULT FALSE;

-- One Discord account can only be linked to one Chessr user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_discord_id
ON user_settings(discord_id) WHERE discord_id IS NOT NULL;

-- Change default signup plan from 'freetrial' to 'free'
-- Free trial now starts only when Discord is linked
CREATE OR REPLACE FUNCTION create_user_settings_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, plan, plan_expiry, settings)
  VALUES (NEW.id, 'free', NULL, '{}')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
