-- Migration: Add role column to user_settings
-- This migration adds a role-based access control system

-- Create the user_role enum type
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add role column with default value 'user'
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'user';

-- Create index for role-based queries
CREATE INDEX IF NOT EXISTS idx_user_settings_role ON user_settings(role);

-- Comment for documentation
COMMENT ON COLUMN user_settings.role IS 'User role for access control: super_admin, admin, or user';
