-- Migration: Polar → Paddle (reverse of 019)
-- Rename subscription columns from polar_* to paddle_*

ALTER TABLE subscriptions RENAME COLUMN polar_subscription_id TO paddle_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN polar_product_id TO paddle_price_id;
ALTER TABLE subscriptions RENAME COLUMN polar_customer_id TO paddle_customer_id;

-- Rename payment_events column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_events' AND column_name = 'polar_event_id'
  ) THEN
    ALTER TABLE payment_events RENAME COLUMN polar_event_id TO paddle_event_id;
  END IF;
END $$;
