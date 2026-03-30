-- Store browser fingerprints for multi-account detection (multiple per user)
CREATE TABLE IF NOT EXISTS user_fingerprints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_fingerprints_fp ON user_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_fingerprints_user ON user_fingerprints(user_id);
-- Avoid storing the same fingerprint twice for the same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_fingerprints_unique ON user_fingerprints(user_id, fingerprint);

ALTER TABLE user_fingerprints ENABLE ROW LEVEL SECURITY;
