-- Create plan enum type
DO $$ BEGIN
  CREATE TYPE plan_type AS ENUM ('free', 'freetrial', 'premium', 'beta', 'lifetime');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop index if exists (needed before altering column type)
DROP INDEX IF EXISTS idx_user_settings_plan;

-- Convert plan column from TEXT to enum (if it exists as TEXT)
-- First ensure all values are valid enum values
UPDATE user_settings SET plan = 'free' WHERE plan IS NULL OR plan NOT IN ('free', 'freetrial', 'premium', 'beta', 'lifetime');

-- Drop default before changing type
ALTER TABLE user_settings
ALTER COLUMN plan DROP DEFAULT;

-- Alter column type from TEXT to enum
ALTER TABLE user_settings
ALTER COLUMN plan TYPE plan_type USING plan::plan_type;

-- Set default value
ALTER TABLE user_settings
ALTER COLUMN plan SET DEFAULT 'free';

-- Migrate is_beta to plan (for users still on 'free' with is_beta = true)
UPDATE user_settings SET plan = 'beta' WHERE is_beta = TRUE AND plan = 'free';

-- Create index for plan lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_plan ON user_settings(plan);
