-- Migration: Track Maia-2 suggestion usage separately from Komodo
-- Adds 'maia_suggestion' to the activity_event_type enum

-- Add new enum value
ALTER TYPE activity_event_type ADD VALUE IF NOT EXISTS 'maia_suggestion';

-- Initialize the counter for total Maia suggestions
INSERT INTO global_stats (key, value) VALUES ('total_maia_suggestions', 0)
ON CONFLICT (key) DO NOTHING;
