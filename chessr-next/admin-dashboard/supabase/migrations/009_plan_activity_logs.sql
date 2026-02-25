-- Plan Activity Logs
-- Tracks all plan changes (cron downgrades and admin modifications)

CREATE TABLE IF NOT EXISTS plan_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email TEXT,
    action_type TEXT NOT NULL CHECK (action_type IN ('cron_downgrade', 'admin_change')),
    admin_user_id UUID,
    admin_email TEXT,
    old_plan TEXT,
    new_plan TEXT NOT NULL,
    old_expiry TIMESTAMPTZ,
    new_expiry TIMESTAMPTZ,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_plan_activity_logs_created_at ON plan_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_activity_logs_user_id ON plan_activity_logs(user_id);

-- RLS: Only service role can access
ALTER TABLE plan_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on plan_activity_logs" ON plan_activity_logs
    FOR ALL USING (auth.role() = 'service_role');
