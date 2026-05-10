-- ─────────────────────────────────────────────────────────────────────────
-- Discord-boost reward audit + retroactive-grant tracking.
--
-- Two-stage lifecycle:
--   1. Boost detected → INSERT (discord_id, done_at, …) with granted_at NULL.
--   2. Reward applied → UPDATE granted_at = now(), user_id, reward_path.
--
-- A boost can land in stage-1 without a linked Chessr account; the
-- grant happens later when the user finally links their Discord (the
-- bot listens to discord_linked events and replays pending rows).
--
-- (discord_id, done_at) is the natural key — Discord's premium_since
-- is fresh per boost, so re-boosting after a stop produces a new row.
-- ─────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS discord_boosts;

CREATE TABLE discord_boosts (
  discord_id   text         NOT NULL,
  -- When the user actually boosted (Discord's GuildMember.premiumSince).
  done_at      timestamptz  NOT NULL,
  -- Chessr user_id at grant time. Null until the reward is applied.
  user_id      uuid,
  -- When the reward was applied. Null = pending, awaiting Discord link.
  granted_at   timestamptz,
  reward_days  integer      NOT NULL DEFAULT 15,
  -- 'dashboard' | 'paddle' | 'no_extend' (lifetime/beta). Null = pending.
  reward_path  text,
  PRIMARY KEY (discord_id, done_at)
);

-- Hot path: pending grants per discord_id (queried on every link).
CREATE INDEX idx_discord_boosts_pending
  ON discord_boosts(discord_id)
  WHERE granted_at IS NULL;

CREATE INDEX idx_discord_boosts_user_id
  ON discord_boosts(user_id);

-- Activity feeds / dashboards filter on granted_at — fresh-rewards-first.
CREATE INDEX idx_discord_boosts_granted_at
  ON discord_boosts(granted_at DESC)
  WHERE granted_at IS NOT NULL;
