-- ─────────────────────────────────────────────────────────────────────────
-- Admin /users tab — fast paginated list + per-user detail.
--
-- Why RPC functions (vs JS-side joins):
--  • The JS Supabase client cannot query auth.users directly. The previous
--    chessr-next admin route worked around this by paging through the
--    *entire* auth.users table into memory on every list request — fine
--    at low scale, terrible past ~10k users.
--  • A SECURITY DEFINER function joins auth.users + user_settings server-
--    side, applies search + LIMIT/OFFSET in SQL, and returns one page.
--
-- Why pg_trgm:
--  • Search-by-email uses ILIKE '%foo%', which a normal btree index can't
--    accelerate. pg_trgm + a GIN index makes substring search O(log n)
--    on the matched fraction — the difference becomes visible past ~20k.
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A trigram GIN index on auth.users.email would make ILIKE substring
-- search O(log n), but Supabase migrations run as `postgres` which is
-- not the owner of auth.users (ERROR 42501). To enable it later:
--   1) Open the SQL editor in Supabase dashboard (runs as superuser), or
--   2) Ask Supabase support to apply:
--        CREATE INDEX idx_auth_users_email_trgm
--          ON auth.users USING gin (email gin_trgm_ops);
-- Without it, the RPC still works — just linear-scans email at search time.
-- Negligible up to ~50k users; revisit past that.

-- Common filter combo on user_settings for the list page.
CREATE INDEX IF NOT EXISTS idx_user_settings_plan
  ON public.user_settings (plan);


-- ─── admin_list_users ─────────────────────────────────────────────────────
-- Paginated list with optional search by email substring or exact user_id,
-- plan filter, and dynamic sort. Returns total_count alongside every row
-- so the client gets pagination meta in a single round-trip.
--
-- Signature change → drop the old version before re-creating. CREATE OR
-- REPLACE FUNCTION refuses to change the parameter list of an existing
-- function, so we must drop it first.
-- DROP IF EXISTS matches by parameter signature, not return type — so a
-- single drop of the v2 arg list also covers prior CREATEs whose RETURNS
-- TABLE shape differs (e.g. before/after has_discord was added).
DROP FUNCTION IF EXISTS public.admin_list_users(text, int, int);
DROP FUNCTION IF EXISTS public.admin_list_users(text, text, text, text, int, int);

CREATE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_plan   text DEFAULT NULL,
  p_sort   text DEFAULT 'joined_at',
  p_order  text DEFAULT 'desc',
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS TABLE (
  user_id           uuid,
  email             text,
  joined_at         timestamptz,
  email_verified    boolean,
  plan              text,
  plan_expiry       timestamptz,
  freetrial_used    boolean,
  role              text,
  banned            boolean,
  has_discord       boolean,
  linked_count      int,
  total_count       bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
#variable_conflict use_column
DECLARE
  v_search_uuid uuid;
  v_asc         boolean := lower(coalesce(p_order, 'desc')) = 'asc';
BEGIN
  -- Try to interpret the search term as a UUID for exact id lookup.
  BEGIN
    v_search_uuid := NULLIF(p_search, '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_search_uuid := NULL;
  END;

  RETURN QUERY
  WITH base AS (
    -- Cast every column to its declared RETURNS TABLE type. auth.users.email
    -- is varchar(255), and user_settings.role/plan are often enum types in
    -- existing schemas — without explicit ::text the function aborts with
    -- "structure of query does not match function result type".
    SELECT
      u.id                                    AS user_id,
      u.email::text                           AS email,
      u.created_at                            AS joined_at,
      (u.email_confirmed_at IS NOT NULL)      AS email_verified,
      COALESCE(s.plan::text, 'free')          AS plan,
      s.plan_expiry,
      COALESCE(s.freetrial_used, false)       AS freetrial_used,
      COALESCE(s.role::text, 'user')          AS role,
      COALESCE(s.banned, false)               AS banned,
      (s.discord_id IS NOT NULL)              AS has_discord
    FROM auth.users u
    LEFT JOIN public.user_settings s ON s.user_id = u.id
    WHERE
      (
        p_search IS NULL
        OR p_search = ''
        OR (v_search_uuid IS NOT NULL AND u.id = v_search_uuid)
        OR u.email ILIKE '%' || p_search || '%'
      )
      AND (
        p_plan IS NULL OR p_plan = '' OR COALESCE(s.plan::text, 'free') = p_plan
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total_count FROM base
  ),
  -- Dynamic sort. Each branch returns a single typed column; NULL branches
  -- collapse and the next ORDER BY clause takes over. The trailing
  -- joined_at is a deterministic tiebreaker.
  page AS (
    SELECT * FROM base
    ORDER BY
      CASE WHEN p_sort = 'email'       AND v_asc       THEN email END ASC NULLS LAST,
      CASE WHEN p_sort = 'email'       AND NOT v_asc   THEN email END DESC NULLS LAST,
      CASE WHEN p_sort = 'plan'        AND v_asc       THEN plan  END ASC NULLS LAST,
      CASE WHEN p_sort = 'plan'        AND NOT v_asc   THEN plan  END DESC NULLS LAST,
      CASE WHEN p_sort = 'plan_expiry' AND v_asc       THEN plan_expiry END ASC NULLS LAST,
      CASE WHEN p_sort = 'plan_expiry' AND NOT v_asc   THEN plan_expiry END DESC NULLS LAST,
      CASE WHEN p_sort = 'joined_at'   AND v_asc       THEN joined_at   END ASC NULLS LAST,
      CASE WHEN p_sort = 'joined_at'   AND NOT v_asc   THEN joined_at   END DESC NULLS LAST,
      joined_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ),
  -- Linked-account count for the current page only — keeps the join cheap.
  linked AS (
    SELECT la.user_id, COUNT(*)::int AS linked_count
    FROM public.linked_accounts la
    WHERE la.unlinked_at IS NULL
      AND la.user_id IN (SELECT user_id FROM page)
    GROUP BY la.user_id
  )
  SELECT
    p.user_id,
    p.email,
    p.joined_at,
    p.email_verified,
    p.plan,
    p.plan_expiry,
    p.freetrial_used,
    p.role,
    p.banned,
    p.has_discord,
    COALESCE(l.linked_count, 0) AS linked_count,
    c.total_count
  FROM page p
  CROSS JOIN counted c
  LEFT JOIN linked l ON l.user_id = p.user_id
  -- Re-apply the same sort here: page's ordering is lost once we join.
  ORDER BY
    CASE WHEN p_sort = 'email'       AND v_asc       THEN p.email END ASC NULLS LAST,
    CASE WHEN p_sort = 'email'       AND NOT v_asc   THEN p.email END DESC NULLS LAST,
    CASE WHEN p_sort = 'plan'        AND v_asc       THEN p.plan  END ASC NULLS LAST,
    CASE WHEN p_sort = 'plan'        AND NOT v_asc   THEN p.plan  END DESC NULLS LAST,
    CASE WHEN p_sort = 'plan_expiry' AND v_asc       THEN p.plan_expiry END ASC NULLS LAST,
    CASE WHEN p_sort = 'plan_expiry' AND NOT v_asc   THEN p.plan_expiry END DESC NULLS LAST,
    CASE WHEN p_sort = 'joined_at'   AND v_asc       THEN p.joined_at   END ASC NULLS LAST,
    CASE WHEN p_sort = 'joined_at'   AND NOT v_asc   THEN p.joined_at   END DESC NULLS LAST,
    p.joined_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users(text, text, text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, text, int, int) TO service_role;


-- ─── admin_get_user_detail ────────────────────────────────────────────────
-- Returns one user's full admin view in a single JSON payload. Saves the
-- client from fanning out 4-5 round-trips (settings, linked, fingerprints,
-- ips, auth user) every time a row is opened.
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
