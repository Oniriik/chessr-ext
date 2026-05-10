-- ─────────────────────────────────────────────────────────────────────────
-- Support tickets — one row per channel created by the /ticket panel.
--
-- The id doubles as the ticket number (zero-padded in the channel
-- name): #0001, #0002 … Postgres BIGSERIAL is atomic so two clicks
-- racing each other still get distinct numbers.
--
-- Soft-deleted tickets keep the row for audit (who/what/when), even
-- after the Discord channel is deleted by an admin.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id                       bigserial    PRIMARY KEY,
  opener_discord_id        text         NOT NULL,
  opener_username          text,                         -- snapshot for transcript / audit
  channel_id               text         NOT NULL UNIQUE,
  status                   text         NOT NULL CHECK (status IN ('open','closed','deleted')) DEFAULT 'open',

  opened_at                timestamptz  NOT NULL DEFAULT now(),
  closed_at                timestamptz,
  closed_by_discord_id     text,
  deleted_at               timestamptz,
  deleted_by_discord_id    text
);

CREATE INDEX IF NOT EXISTS idx_tickets_status_opener
  ON tickets(status, opener_discord_id);

CREATE INDEX IF NOT EXISTS idx_tickets_opened_at
  ON tickets(opened_at DESC);
