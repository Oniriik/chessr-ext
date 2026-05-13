-- ─── 1) plan_type enum: register 'unlocker' ────────────────────────────
-- user_settings.plan is a custom enum (plan_type) — without this the
-- Paddle webhook silently fails when trying to set plan='unlocker' on a
-- successful payment, leaving the user on 'free' despite being billed.
-- `ADD VALUE` must run outside a transaction; jouer cette ligne seule
-- dans le SQL editor si la migration globale est wrappée en BEGIN/COMMIT.
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'unlocker';

-- ─── 2) Acquisition tracking ───────────────────────────────────────────
-- Record the surface a user signed up from so we can measure conversion
-- funnels per acquisition channel (main chessr extension vs Review
-- Unlocker extension vs web app vs Discord bot, etc.).
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
