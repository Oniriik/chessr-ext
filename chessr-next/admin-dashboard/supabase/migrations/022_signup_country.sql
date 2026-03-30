-- Add signup country to user_settings (resolved from IP at signup time)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS signup_country TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS signup_country_code TEXT;

-- Backfill existing users with the country from their earliest known IP
UPDATE user_settings us
SET signup_country = earliest.country,
    signup_country_code = earliest.country_code
FROM (
  SELECT DISTINCT ON (user_id)
    user_id, country, country_code
  FROM signup_ips
  WHERE country IS NOT NULL
  ORDER BY user_id, created_at ASC
) earliest
WHERE us.user_id = earliest.user_id
  AND us.signup_country IS NULL;
