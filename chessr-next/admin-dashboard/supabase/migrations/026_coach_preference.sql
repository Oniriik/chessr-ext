-- Add coach preference to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS preferred_coach TEXT DEFAULT 'Generic_coach';

-- Add coach_id to game_reviews for per-coach caching
ALTER TABLE game_reviews ADD COLUMN IF NOT EXISTS coach_id TEXT DEFAULT 'Generic_coach';

-- Drop old unique constraint and create new one including coach_id
ALTER TABLE game_reviews DROP CONSTRAINT IF EXISTS game_reviews_game_id_platform_key;
ALTER TABLE game_reviews ADD CONSTRAINT game_reviews_game_id_platform_coach_key UNIQUE(game_id, platform, coach_id);
