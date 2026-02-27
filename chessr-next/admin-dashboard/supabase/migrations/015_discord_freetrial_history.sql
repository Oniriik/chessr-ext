-- Track which Discord accounts have been used to start a free trial
-- Prevents abuse: unlink Discord → re-link on new Chessr account → get another trial

CREATE TABLE IF NOT EXISTS discord_freetrial_history (
  discord_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
