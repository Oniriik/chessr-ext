-- License grant audit table.
--
-- Every call to POST /api/license/verify (Patricia + Maia 2 premium gate)
-- writes one row here — granted or denied. Used for:
--   • observability (who uses what engine, when)
--   • anomaly detection (free user bursts, IP spam)
--   • post-mortem if a key leaks (revoke + force rotate)

CREATE TABLE IF NOT EXISTS license_grants (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine         text NOT NULL CHECK (engine IN ('patricia', 'maia2')),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  denied         boolean NOT NULL DEFAULT false,
  denied_reason  text     -- 'free_plan' | 'bad_timestamp' | 'bad_jwt' | 'server_error'
);

CREATE INDEX IF NOT EXISTS license_grants_user_time
  ON license_grants (user_id, granted_at DESC);

CREATE INDEX IF NOT EXISTS license_grants_denied_time
  ON license_grants (granted_at DESC)
  WHERE denied = true;

-- Row-level security: only service role reads this (admin dashboard only).
ALTER TABLE license_grants ENABLE ROW LEVEL SECURITY;
