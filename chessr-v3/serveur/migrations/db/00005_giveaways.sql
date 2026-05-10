-- ─────────────────────────────────────────────────────────────────────────
-- Giveaway system.
--
-- Three tables:
--
--   giveaways          — header: name, ends_at, status, audit
--   giveaway_prizes    — 1 row per prize, ordered via `position`
--   giveaway_tickets   — 1 row per earning event. `count` lets a single
--                        admin grant of 10 tickets stay a single row
--                        (and a single bot DM downstream).
--
-- A user's ticket count for a giveaway is just SUM(count) over their
-- rows. The leaderboard runs the same aggregate over the whole table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS giveaways (
  id                  bigserial    PRIMARY KEY,
  name                text         NOT NULL,
  ends_at             timestamptz  NOT NULL,
  status              text         NOT NULL CHECK (status IN ('scheduled','cancelled','completed')) DEFAULT 'scheduled',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  -- chessr admin user_id (auth.users.id on Supabase). No FK because
  -- chessr-postgres and Supabase are separate DBs — soft reference.
  created_by_user_id  uuid,
  drawn_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_giveaways_status_ends
  ON giveaways(status, ends_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giveaway_prizes (
  id                bigserial    PRIMARY KEY,
  giveaway_id       bigint       NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  -- 1 = grand prize, 2 = second, etc. UNIQUE per giveaway so the order
  -- is unambiguous.
  position          integer      NOT NULL,

  prize_kind        text         NOT NULL CHECK (prize_kind IN ('plan','token')),
  -- For prize_kind = 'plan'
  plan_kind         text         CHECK (plan_kind IN ('lifetime','premium')),
  plan_days         integer,                -- only set when plan_kind = 'premium'
  -- For prize_kind = 'token'
  token_count       integer,

  -- Filled at draw time; left null while scheduled.
  winner_discord_id text,
  winner_user_id    uuid,

  -- Sanity: kind / sub-fields stay consistent.
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

CREATE INDEX IF NOT EXISTS idx_giveaway_prizes_order
  ON giveaway_prizes(giveaway_id, position);

-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS giveaway_tickets (
  id                  bigserial    PRIMARY KEY,
  giveaway_id         bigint       NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  owner_discord_id    text         NOT NULL,

  -- Where the tickets came from. Adding a new source = adding a value
  -- here.
  source              text         NOT NULL CHECK (source IN ('invite','admin_grant')),

  -- A grant of 10 tickets stays a single row (count = 10). The DM /
  -- event downstream is also single. Leaderboard uses SUM(count).
  count               integer      NOT NULL CHECK (count > 0),

  earned_at           timestamptz  NOT NULL DEFAULT now(),

  -- Audit when source = 'admin_grant'
  granted_by_user_id  uuid,
  reason              text,

  -- Source-specific reference. For 'invite' = inviter's discord_id;
  -- for 'admin_grant' = null. Future sources can reuse it.
  external_ref        text
);

CREATE INDEX IF NOT EXISTS idx_giveaway_tickets_leaderboard
  ON giveaway_tickets(giveaway_id, owner_discord_id);

CREATE INDEX IF NOT EXISTS idx_giveaway_tickets_user
  ON giveaway_tickets(owner_discord_id, giveaway_id);

CREATE INDEX IF NOT EXISTS idx_giveaway_tickets_earned_at
  ON giveaway_tickets(earned_at DESC);
