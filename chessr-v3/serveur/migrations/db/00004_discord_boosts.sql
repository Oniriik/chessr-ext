-- ─────────────────────────────────────────────────────────────────────────
-- Discord-boost reward audit + idempotency.
--
-- The bot grants 15 free days of premium to anyone who boosts the
-- server. This table records each grant so the bot never rewards the
-- same boost twice — Discord can fire guildMemberUpdate multiple
-- times for the same change, and the user could click the "Claim
-- reward" button repeatedly.
--
-- Primary key (discord_id, premium_since): a re-boost after a stop
-- gets a fresh premium_since timestamp from Discord and earns another
-- reward; a duplicate event for the same boost is a no-op.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discord_boosts (
  discord_id    text         NOT NULL,
  premium_since timestamptz  NOT NULL,
  -- Chessr user_id at grant time. May be null when we ever decide to
  -- record "boost detected, account not yet linked" rows; today the
  -- bot only inserts after linking.
  user_id       uuid,
  granted_at    timestamptz  NOT NULL DEFAULT now(),
  reward_days   integer      NOT NULL DEFAULT 15,
  -- 'dashboard'  → direct user_settings.plan_expiry update
  -- 'paddle'     → paddle.subscriptions.update via the serveur
  -- 'no_extend'  → lifetime / beta — slot taken so we don't re-DM
  reward_path   text         NOT NULL,
  PRIMARY KEY (discord_id, premium_since)
);

CREATE INDEX IF NOT EXISTS idx_discord_boosts_user_id
  ON discord_boosts(user_id);

CREATE INDEX IF NOT EXISTS idx_discord_boosts_granted_at
  ON discord_boosts(granted_at DESC);
