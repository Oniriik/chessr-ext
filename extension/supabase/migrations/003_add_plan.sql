-- Create plan enum type
DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM ('free', 'freetrial', 'premium', 'beta', 'lifetime');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop index if exists (needed before altering column type)
DROP INDEX IF EXISTS idx_user_settings_plan;

-- Add plan column or convert from TEXT to enum
DO $$
BEGIN
  -- Check if column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_settings' AND column_name = 'plan'
  ) THEN
    -- Column exists, convert from TEXT to enum
    UPDATE user_settings SET plan = 'free' WHERE plan IS NULL OR plan NOT IN ('free', 'freetrial', 'premium', 'beta', 'lifetime');
    ALTER TABLE user_settings ALTER COLUMN plan DROP DEFAULT;
    ALTER TABLE user_settings ALTER COLUMN plan TYPE plan_type USING plan::plan_type;
    ALTER TABLE user_settings ALTER COLUMN plan SET DEFAULT 'free';
  ELSE
    -- Column doesn't exist, create it directly as enum
    ALTER TABLE user_settings ADD COLUMN plan plan_type DEFAULT 'free';
  END IF;
END $$;

-- Migrate is_beta to plan (for users still on 'free' with is_beta = true)
UPDATE user_settings SET plan = 'beta' WHERE is_beta = TRUE AND plan = 'free';

-- Create index for plan lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_plan ON user_settings(plan);
