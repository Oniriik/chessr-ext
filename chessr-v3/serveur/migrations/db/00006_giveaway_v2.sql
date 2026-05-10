-- ─────────────────────────────────────────────────────────────────────────
-- Giveaway v2 — adds:
--   • starts_at / announce_* (no auto-post on create — bot announces at
--     starts_at in a configured channel and saves the message id).
--   • giveaway_registrations — users opt in via a button; registration
--     itself grants 1 ticket. Invite tickets only count once registered
--     (and only those earned in [starts_at, ends_at]).
--
-- We drop and recreate the v1 tables — the user confirmed only test
-- data is in there. CASCADE handles FKs.
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS giveaway_tickets CASCADE;
DROP TABLE IF EXISTS giveaway_prizes CASCADE;
DROP TABLE IF EXISTS giveaway_registrations CASCADE;
DROP TABLE IF EXISTS giveaways CASCADE;

CREATE TABLE giveaways (
  id                    bigserial    PRIMARY KEY,
  name                  text         NOT NULL,
  starts_at             timestamptz  NOT NULL,
  ends_at               timestamptz  NOT NULL,
  status                text         NOT NULL CHECK (status IN ('scheduled','cancelled','completed')) DEFAULT 'scheduled',
  -- Channel where the bot posts the announcement at starts_at. NULL =
  -- fall back to DISCORD_GIVEAWAY_CHANNEL_ID env var.
  announce_channel_id   text,
  announce_message_id   text,
  announced_at          timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  created_by_user_id    uuid,
  drawn_at              timestamptz,
  CONSTRAINT giveaways_starts_before_ends CHECK (starts_at < ends_at)
);

CREATE INDEX idx_giveaways_status_ends ON giveaways(status, ends_at DESC);
-- Used by the bot's announcement ticker — find scheduled giveaways
-- whose start has elapsed but haven't been posted yet.
CREATE INDEX idx_giveaways_pending_announce
  ON giveaways(status, starts_at)
  WHERE announce_message_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE giveaway_prizes (
  id                bigserial    PRIMARY KEY,
  giveaway_id       bigint       NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  position          integer      NOT NULL,

  prize_kind        text         NOT NULL CHECK (prize_kind IN ('plan','token')),
  plan_kind         text         CHECK (plan_kind IN ('lifetime','premium')),
  plan_days         integer,
  token_count       integer,

  winner_discord_id text,
  winner_user_id    uuid,

  CHECK (
    (prize_kind = 'plan'  AND plan_kind IS NOT NULL AND token_count IS NULL
      AND ((plan_kind = 'lifetime' AND plan_days IS NULL)
        OR (plan_kind = 'premium'  AND plan_days > 0)))
    OR
    (prize_kind = 'token' AND plan_kind IS NULL AND plan_days IS NULL
      AND token_count > 0)
  ),

  UNIQUE (giveaway_id, position)
);

CREATE INDEX idx_giveaway_prizes_order ON giveaway_prizes(giveaway_id, position);

-- ─────────────────────────────────────────────────────────────────────────
-- One row per user who clicked the Register button. UNIQUE so the
-- button is idempotent — a second click is a no-op.

CREATE TABLE giveaway_registrations (
  id              bigserial    PRIMARY KEY,
  giveaway_id     bigint       NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  discord_id      text         NOT NULL,
  registered_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (giveaway_id, discord_id)
);

CREATE INDEX idx_giveaway_registrations_giveaway
  ON giveaway_registrations(giveaway_id);

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE giveaway_tickets (
  id                  bigserial    PRIMARY KEY,
  giveaway_id         bigint       NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  owner_discord_id    text         NOT NULL,

  -- 'registration'  = +1 ticket for clicking Register
  -- 'invite'        = +1 ticket per invited user joining inside the period
  -- 'admin_grant'   = manual grant via dashboard
  source              text         NOT NULL CHECK (source IN ('registration','invite','admin_grant')),

  count               integer      NOT NULL CHECK (count > 0),
  earned_at           timestamptz  NOT NULL DEFAULT now(),

  granted_by_user_id  uuid,
  reason              text,

  -- For 'invite' = invitee's discord_id; for 'admin_grant' = null.
  external_ref        text
);

CREATE INDEX idx_giveaway_tickets_leaderboard
  ON giveaway_tickets(giveaway_id, owner_discord_id);

CREATE INDEX idx_giveaway_tickets_user
  ON giveaway_tickets(owner_discord_id, giveaway_id);

CREATE INDEX idx_giveaway_tickets_earned_at
  ON giveaway_tickets(earned_at DESC);
