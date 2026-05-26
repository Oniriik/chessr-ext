CREATE TABLE IF NOT EXISTS discord_dm_threads (
  discord_id             TEXT        PRIMARY KEY,
  channel_id             TEXT,
  last_inbound_at        TIMESTAMPTZ,
  last_inbound_preview   TEXT,
  last_outbound_at       TIMESTAMPTZ,
  last_outbound_preview  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discord_dm_threads_updated_at_idx
  ON discord_dm_threads (updated_at DESC);
