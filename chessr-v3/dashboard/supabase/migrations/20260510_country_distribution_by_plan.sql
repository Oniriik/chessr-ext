-- ─────────────────────────────────────────────────────────────────────────
-- Country distribution — broken down per plan.
--
-- Extends 20260511_country_distribution. Same source of truth (most recent
-- signup_ips row per user), now joined with user_settings to expose how
-- many free / freetrial / premium / beta / lifetime users live in each
-- country. The /users/globe page uses these to render a plan filter and
-- a per-country plan-mix bar.
-- ─────────────────────────────────────────────────────────────────────────

-- Postgres can't change a function's return-type via CREATE OR REPLACE,
-- so we drop the prior signature first. The function is admin-only and
-- read-only, so dropping is safe — no data depends on it.
DROP FUNCTION IF EXISTS public.admin_country_distribution();

CREATE OR REPLACE FUNCTION public.admin_country_distribution()
RETURNS TABLE (
  country_code     text,
  country          text,
  user_count       int,
  free_count       int,
  freetrial_count  int,
  premium_count    int,
  beta_count       int,
  lifetime_count   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_ip AS (
    SELECT DISTINCT ON (user_id)
      user_id,
      country_code,
      country,
      created_at
    FROM public.signup_ips
    WHERE country_code IS NOT NULL AND country_code <> ''
    ORDER BY user_id, created_at DESC
  ),
  joined AS (
    SELECT
      i.country_code,
      i.country,
      COALESCE(s.plan, 'free') AS plan
    FROM latest_ip i
    LEFT JOIN public.user_settings s ON s.user_id = i.user_id
  )
  SELECT
    country_code::text,
    MAX(country)::text                                      AS country,
    COUNT(*)::int                                            AS user_count,
    COUNT(*) FILTER (WHERE plan = 'free')::int               AS free_count,
    COUNT(*) FILTER (WHERE plan = 'freetrial')::int          AS freetrial_count,
    COUNT(*) FILTER (WHERE plan = 'premium')::int            AS premium_count,
    COUNT(*) FILTER (WHERE plan = 'beta')::int               AS beta_count,
    COUNT(*) FILTER (WHERE plan = 'lifetime')::int           AS lifetime_count
  FROM joined
  GROUP BY country_code
  ORDER BY user_count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_country_distribution() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_country_distribution() TO service_role;
