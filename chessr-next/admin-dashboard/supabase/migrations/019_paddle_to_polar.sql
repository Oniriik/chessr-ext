-- Rename Paddle columns to Polar in subscriptions table
ALTER TABLE subscriptions RENAME COLUMN paddle_customer_id TO polar_customer_id;
ALTER TABLE subscriptions RENAME COLUMN paddle_subscription_id TO polar_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN paddle_product_id TO polar_product_id;

-- Rename paddle_event_id to event_id in payment_events table
ALTER TABLE payment_events RENAME COLUMN paddle_event_id TO event_id;
