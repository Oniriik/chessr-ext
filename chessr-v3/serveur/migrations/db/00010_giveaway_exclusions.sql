-- Per-giveaway Discord user exclusions. Excluded users:
--   1) cannot earn tickets (registration / invite / admin_grant all reject)
--   2) are filtered out of the weighted draw pool
--   3) are filtered out of the leaderboard / participants list
--
-- Primary use case: keep the chessr team from winning their own giveaways.
-- Could also serve as a ban-list for known cheat accounts on future
-- giveaways. Per-giveaway scope rather than global so we can ramp / wind
-- down exclusions without rewriting old draws.
CREATE TABLE IF NOT EXISTS giveaway_excluded_users (
  id bigserial PRIMARY KEY,
  giveaway_id bigint NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  discord_id text NOT NULL,
  excluded_by_user_id uuid,
  reason text,
  excluded_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (giveaway_id, discord_id)
);

CREATE INDEX IF NOT EXISTS idx_giveaway_excluded_lookup
  ON giveaway_excluded_users (giveaway_id, discord_id);
