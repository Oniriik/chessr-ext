-- ─────────────────────────────────────────────────────────────────────────
-- Country distribution for the /users/globe page.
--
-- We rely on signup_ips as the source of truth for "where the user is".
-- The schema allows multiple rows per user_id (e.g. if recorded again at
-- login), so we take the most-recent entry per user and aggregate by
-- country_code. If only one row per user exists, this still works — it's
-- just the signup country.
-- ─────────────────────────────────────────────────────────────────────────

-- Composite index that makes DISTINCT ON (user_id) ORDER BY user_id, created_at DESC
-- a quick index scan instead of a sort over the whole table.
CREATE INDEX IF NOT EXISTS idx_signup_ips_user_created
  ON public.signup_ips (user_id, created_at DESC);


CREATE OR REPLACE FUNCTION public.admin_country_distribution()
RETURNS TABLE (
  country_code text,
  country      text,
  user_count   int
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
  )
  SELECT
    country_code::text,
    -- A country_code can theoretically have inconsistent country labels
    -- across rows (rare). Pick one deterministically.
    MAX(country)::text AS country,
    COUNT(*)::int      AS user_count
  FROM latest_ip
  GROUP BY country_code
  ORDER BY user_count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_country_distribution() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_country_distribution() TO service_role;
