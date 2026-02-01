-- Billing and Subscription Tables for Chessr
-- This migration adds support for Paddle billing integration

-- ============================================================================
-- Table: subscription_plans
-- Stores the available subscription plans (Monthly, Yearly, Lifetime)
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paddle_product_id TEXT NOT NULL UNIQUE,
  paddle_price_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('Monthly', 'Yearly', 'Lifetime')),
  billing_cycle TEXT CHECK (billing_cycle IN ('month', 'year', 'one_time')),
  price_amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: user_subscriptions
-- Main table for managing user subscriptions and beta tester status
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Beta tester flag (gets lifetime free access)
  is_beta_tester BOOLEAN DEFAULT false,

  -- Paddle integration fields
  paddle_customer_id TEXT,
  paddle_subscription_id TEXT,

  -- Subscription details
  plan_id UUID REFERENCES subscription_plans(id),
  status TEXT CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'expired')) DEFAULT 'expired',

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ, -- NULL for lifetime subscriptions
  canceled_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: payment_events
-- Audit log for all Paddle webhook events
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  paddle_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle_customer_id ON user_subscriptions(paddle_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_paddle_subscription_id ON user_subscriptions(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_payment_events_user_id ON payment_events(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_paddle_event_id ON payment_events(paddle_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_processed ON payment_events(processed) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_subscription_plans_paddle_product_id ON subscription_plans(paddle_product_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read active subscription plans
CREATE POLICY "Users can read active plans"
  ON subscription_plans FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Policy: Users can read their own subscription
CREATE POLICY "Users can read own subscription"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role only for payment_events (for security)
CREATE POLICY "Service role only for payment events"
  ON payment_events FOR ALL
  USING (false); -- Only service role can bypass RLS

-- ============================================================================
-- Function: has_active_subscription
-- Returns true if user has active access (beta tester OR active subscription)
-- ============================================================================
CREATE OR REPLACE FUNCTION has_active_subscription(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  sub_record RECORD;
BEGIN
  -- Try to get the subscription record
  SELECT * INTO sub_record
  FROM user_subscriptions
  WHERE user_id = user_uuid;

  -- If no record exists, no access
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Beta testers always have access
  IF sub_record.is_beta_tester THEN
    RETURN true;
  END IF;

  -- Check if subscription is active and not expired
  IF sub_record.status IN ('active', 'trialing') THEN
    -- Lifetime subscriptions have NULL end date, always active
    IF sub_record.current_period_end IS NULL THEN
      RETURN true;
    END IF;

    -- Check if current period hasn't ended yet
    IF sub_record.current_period_end > NOW() THEN
      RETURN true;
    END IF;
  END IF;

  -- No active access
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Auto-update updated_at trigger for user_subscriptions
-- ============================================================================
CREATE TRIGGER user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Seed Data: Initial subscription plans
-- NOTE: Replace these placeholder IDs with real Paddle Product/Price IDs
-- ============================================================================
INSERT INTO subscription_plans (paddle_product_id, paddle_price_id, name, billing_cycle, price_amount) VALUES
  ('prod_monthly_placeholder', 'pri_monthly_placeholder', 'Monthly', 'month', 2.99),
  ('prod_yearly_placeholder', 'pri_yearly_placeholder', 'Yearly', 'year', 29.99),
  ('prod_lifetime_placeholder', 'pri_lifetime_placeholder', 'Lifetime', 'one_time', 60.00)
ON CONFLICT (paddle_product_id) DO NOTHING;

-- ============================================================================
-- Migration complete
-- ============================================================================
-- Next steps:
-- 1. Update paddle_product_id and paddle_price_id with real Paddle IDs
-- 2. Run migration 003_mark_beta_testers.sql to mark existing users
