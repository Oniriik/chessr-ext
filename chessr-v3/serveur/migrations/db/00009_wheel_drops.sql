-- Wheel token drops — admin posts an @everyone embed in #wheel-spin
-- (boostChannelId on the bot) with a "Catch the token" button. First
-- click wins. Race-safe via atomic UPDATE WHERE status='open' RETURNING.
--
-- variant: 0..4 — picks one of 5 cosmetic message templates baked into
-- the bot. Stored so an admin can rebroadcast / audit which line was
-- shown for which drop.

CREATE TABLE IF NOT EXISTS wheel_drops (
  id            SERIAL PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  message_id    TEXT,
  variant       SMALLINT NOT NULL DEFAULT 0,
  dropped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at     TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'caught')),
  claimed_by_discord_id  TEXT,
  claimed_at    TIMESTAMPTZ,
  token_id      INTEGER REFERENCES wheel_tokens (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS wheel_drops_open_idx
  ON wheel_drops (dropped_at DESC) WHERE status = 'open';
