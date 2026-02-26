-- Migration: Update plan_activity_logs for account deletion logging
-- 1. Allow 'account_delete' action type
-- 2. Make user_id nullable + SET NULL on delete (keep logs after user deletion)

-- Drop old CHECK constraint and add new one with account_delete
ALTER TABLE plan_activity_logs DROP CONSTRAINT IF EXISTS plan_activity_logs_action_type_check;
ALTER TABLE plan_activity_logs ADD CONSTRAINT plan_activity_logs_action_type_check
  CHECK (action_type IN ('cron_downgrade', 'admin_change', 'account_delete'));

-- Make user_id nullable
ALTER TABLE plan_activity_logs ALTER COLUMN user_id DROP NOT NULL;

-- Change FK from CASCADE to SET NULL
ALTER TABLE plan_activity_logs DROP CONSTRAINT IF EXISTS plan_activity_logs_user_id_fkey;
ALTER TABLE plan_activity_logs ADD CONSTRAINT plan_activity_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
