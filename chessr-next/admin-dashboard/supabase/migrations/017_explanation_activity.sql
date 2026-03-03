-- Migration: Track move explanation usage for rate limiting and analytics
-- Adds 'explanation' to the activity_event_type enum and indexes for efficient daily count

-- Add new enum value
ALTER TYPE activity_event_type ADD VALUE IF NOT EXISTS 'explanation';

-- Composite index for efficient daily count per user per event type
CREATE INDEX IF NOT EXISTS idx_user_activity_user_type_date
  ON user_activity(user_id, event_type, created_at DESC);

-- Initialize the counter for total explanations
INSERT INTO global_stats (key, value) VALUES ('total_explanations', 0)
ON CONFLICT (key) DO NOTHING;
