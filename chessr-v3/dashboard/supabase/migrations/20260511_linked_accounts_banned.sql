-- Mark linked_accounts where the upstream platform returned 404 on the
-- public stats endpoint. chess.com returns 404 for closed accounts
-- (TOS bans, voluntary deletes, username changes) — the row is alive
-- in our DB but unreachable. Once flagged, the elo-refresh cron skips
-- the row and the bot emits a one-time #users channel notification.
--
-- banned_detected_at is set to NOW() the first time the 404 is seen so
-- we can later auto-purge or re-check rows on a longer schedule.

ALTER TABLE public.linked_accounts
  ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_detected_at timestamptz;

-- Partial index so the cron's `where banned = false` filter stays fast
-- even when the banned set grows.
CREATE INDEX IF NOT EXISTS linked_accounts_active_idx
  ON public.linked_accounts (ratings_updated_at NULLS FIRST)
  WHERE unlinked_at IS NULL AND banned = false;
