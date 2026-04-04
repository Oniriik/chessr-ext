-- Migrate abuse_cases: type (single) -> types (array) + add notes column
-- Clear old data first (incompatible format)
DELETE FROM abuse_cases;

-- Drop old type column and add types array
ALTER TABLE abuse_cases DROP COLUMN IF EXISTS type;
ALTER TABLE abuse_cases ADD COLUMN IF NOT EXISTS types TEXT[] NOT NULL DEFAULT '{}';

-- Add notes column
ALTER TABLE abuse_cases ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]';
