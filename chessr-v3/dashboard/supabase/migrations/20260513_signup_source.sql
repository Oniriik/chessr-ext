-- Acquisition tracking — record the surface a user signed up from so we
-- can measure conversion funnels per acquisition channel (main chessr
-- extension vs Review Unlocker extension vs web app vs Discord bot, etc.).
--
-- Free-form TEXT instead of an enum: we add new sources frequently and
-- don't want a schema change every time. Nullable so historical users
-- (pre-2026-05-13) stay as NULL rather than getting a misleading default.
--
-- Written by /report-signup on the chessr-v3 serveur (see
-- serveur/src/routes/abuse.ts) right after supabase.auth.signUp succeeds.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS signup_source TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_user_settings_signup_source
  ON public.user_settings (signup_source);
