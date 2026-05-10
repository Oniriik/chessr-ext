-- ─────────────────────────────────────────────────────────────────────────
-- Invite tracking — append-only log of "who joined the server via whose
-- invite". Always populated, regardless of whether the inviter is
-- registered for any giveaway. Two consumers:
--
--   1) Real-time grant — when a member joins, if the inviter IS already
--      registered for an active giveaway, the bot reads the freshly
--      inserted row and grants the inviter +1 ticket immediately.
--
--   2) Backfill on register — when a user clicks Register on a giveaway
--      embed, count rows where they were the inviter inside
--      [starts_at, NOW()] and grant N tickets in a single grouped row.
--
-- The dedup key is (guild_id, invitee_discord_id) — Discord re-joins
-- after a leave fire guildMemberAdd again; we only count the first
-- successful invite use per invitee per guild. Subsequent re-joins are
-- ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invite_uses (
  id                  bigserial    PRIMARY KEY,
  guild_id            text         NOT NULL,
  invitee_discord_id  text         NOT NULL,
  inviter_discord_id  text,                    -- null when invite is vanity / unknown
  invite_code         text,
  joined_at           timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (guild_id, invitee_discord_id)
);

-- Lookup pattern: "all invites by inviter X in [start, end]" — used by
-- the giveaway register backfill and the bot's per-DM throttling.
CREATE INDEX IF NOT EXISTS idx_invite_uses_inviter
  ON invite_uses(inviter_discord_id, joined_at);
