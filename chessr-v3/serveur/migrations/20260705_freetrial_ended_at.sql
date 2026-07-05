-- user_settings lives in SUPABASE — run this in the Supabase SQL editor
-- (not the local analytics postgres).
--
-- Stamp set by the plan-expiry sweeper when a freetrial is downgraded to
-- free; cleared (one-shot ack) by POST /freetrial/ended-ack when the
-- extension shows its "trial ended" modal. NULL for everyone else, so
-- historical expired-trial users never see the modal retroactively.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS freetrial_ended_at TIMESTAMPTZ;
