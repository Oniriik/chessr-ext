-- Game reviews cache: stores Chess.com analysis results
CREATE TABLE IF NOT EXISTS game_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'chesscom',
  analysis JSONB NOT NULL,
  caps_white REAL,
  caps_black REAL,
  white_username TEXT,
  black_username TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(game_id, platform)
);

-- Index for fast lookup by game_id
CREATE INDEX idx_game_reviews_game_id ON game_reviews(game_id);

-- Index for looking up games by username
CREATE INDEX idx_game_reviews_white ON game_reviews(white_username);
CREATE INDEX idx_game_reviews_black ON game_reviews(black_username);

-- RLS: service role only (server writes, API reads)
ALTER TABLE game_reviews ENABLE ROW LEVEL SECURITY;
