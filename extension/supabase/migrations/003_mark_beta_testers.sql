-- Mark all existing users as beta testers
-- This migration grants lifetime free access to all users who signed up before billing launch

-- ============================================================================
-- Mark all existing users as beta testers with lifetime access
-- ============================================================================
INSERT INTO user_subscriptions (user_id, is_beta_tester, status, current_period_start)
SELECT
  id as user_id,
  true as is_beta_tester,
  'active' as status,
  NOW() as current_period_start
FROM auth.users
ON CONFLICT (user_id)
DO UPDATE SET
  is_beta_tester = true,
  status = 'active',
  current_period_start = COALESCE(user_subscriptions.current_period_start, NOW()),
  updated_at = NOW();

-- ============================================================================
-- Migration complete
-- ============================================================================
-- All existing users now have is_beta_tester = true and lifetime free access
