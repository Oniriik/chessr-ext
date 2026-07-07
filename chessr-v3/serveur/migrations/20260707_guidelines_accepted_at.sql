-- user_settings lives in SUPABASE — run this in the Supabase SQL editor
-- (not the local analytics postgres).
--
-- Stamp set (one-shot) by POST /guidelines/accept when the user accepts the
-- onboarding "how to stay undetected" guidelines modal in the extension.
-- NULL for everyone who hasn't accepted yet — the modal shows once per
-- account (survives reinstall AND fresh Chrome profiles) until this is set.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS guidelines_accepted_at TIMESTAMPTZ;
