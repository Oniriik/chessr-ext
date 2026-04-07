-- Giveaway periods: each giveaway has a start/end date
CREATE TABLE IF NOT EXISTS giveaway_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invite events: track each invite with timestamp
CREATE TABLE IF NOT EXISTS invite_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_discord_id TEXT NOT NULL,
  inviter_username TEXT,
  invited_discord_id TEXT NOT NULL,
  invited_username TEXT,
  invite_code TEXT,
  still_in_guild BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_events_inviter ON invite_events (inviter_discord_id);
CREATE INDEX IF NOT EXISTS idx_invite_events_created ON invite_events (created_at);
