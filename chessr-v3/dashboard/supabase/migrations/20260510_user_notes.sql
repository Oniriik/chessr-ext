-- ─────────────────────────────────────────────────────────────────────────
-- Admin notes on users — free-form text notes attached to a user, written
-- by an admin/super_admin via the dashboard. Used for tracking context an
-- admin would otherwise have to remember (refund history, abuse signals,
-- support follow-ups, etc.).
--
-- Author resolution: created_by → auth.users.id. We render the author as
-- discord_username when linked, else email — done in admin_get_user_detail
-- so the client never has to fan out per-note.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note        text NOT NULL CHECK (length(note) > 0 AND length(note) <= 5000),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index supports the only read pattern: list notes for a user, newest first.
CREATE INDEX IF NOT EXISTS idx_user_notes_user_created
  ON public.user_notes (user_id, created_at DESC);

-- RLS: notes are admin-only, accessed via service-role from the API; we
-- block anon/authenticated entirely so no client can read/write directly.
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
-- (No policies → only service_role bypasses RLS, which is what we want.)


-- ─── admin_get_user_detail v2 — adds notes to the payload ─────────────────
-- jsonb output, so no signature change needed; CREATE OR REPLACE is enough.
CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'user_id',         u.id,
      'email',           u.email,
      'joined_at',       u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'email_verified',  (u.email_confirmed_at IS NOT NULL),
      'plan',            COALESCE(s.plan, 'free'),
      'plan_expiry',     s.plan_expiry,
      'freetrial_used',  COALESCE(s.freetrial_used, false),
      'role',            COALESCE(s.role, 'user'),
      'banned',          COALESCE(s.banned, false),
      'ban_reason',      s.ban_reason,
      'discord_id',      s.discord_id,
      'discord_username',s.discord_username
    ),
    'linked_accounts', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'platform',          la.platform,
          'platform_username', la.platform_username,
          'platform_user_id',  la.platform_user_id,
          'avatar_url',        la.avatar_url,
          'rating_bullet',     la.rating_bullet,
          'rating_blitz',      la.rating_blitz,
          'rating_rapid',      la.rating_rapid,
          'linked_at',         la.linked_at
        ) ORDER BY la.linked_at DESC)
       FROM public.linked_accounts la
       WHERE la.user_id = u.id AND la.unlinked_at IS NULL),
      '[]'::jsonb
    ),
    'fingerprints', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'fingerprint', f.fingerprint,
          'created_at',  f.created_at
        ) ORDER BY f.created_at DESC)
       FROM public.user_fingerprints f
       WHERE f.user_id = u.id),
      '[]'::jsonb
    ),
    'ips', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'ip_address',   i.ip_address::text,
          'country',      i.country,
          'country_code', i.country_code,
          'created_at',   i.created_at
        ) ORDER BY i.created_at DESC)
       FROM public.signup_ips i
       WHERE i.user_id = u.id),
      '[]'::jsonb
    ),
    -- Notes carry pre-resolved author info: discord_username when the
    -- author has a Discord linked, else the email. Frontend just renders
    -- whichever is non-null.
    'notes', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'id',              n.id,
          'note',            n.note,
          'created_at',      n.created_at,
          'author_id',       n.created_by,
          'author_email',    au.email,
          'author_discord',  aus.discord_username
        ) ORDER BY n.created_at DESC)
       FROM public.user_notes n
       LEFT JOIN auth.users au ON au.id = n.created_by
       LEFT JOIN public.user_settings aus ON aus.user_id = n.created_by
       WHERE n.user_id = u.id),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM auth.users u
  LEFT JOIN public.user_settings s ON s.user_id = u.id
  WHERE u.id = p_user_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(uuid) TO service_role;
