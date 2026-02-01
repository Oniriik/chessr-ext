-- Update Paddle Product and Price IDs (Sandbox)
-- Replace placeholder IDs with real Paddle Sandbox IDs

-- Delete old placeholder data
DELETE FROM subscription_plans;

-- Insert real Paddle Sandbox IDs
INSERT INTO subscription_plans (paddle_product_id, paddle_price_id, name, billing_cycle, price_amount, currency) VALUES
  ('pro_01kgdbm84rdr1r3vs6hbsqn4sh', 'pri_01kgdbw8mfp1stz1wfkg70e1cx', 'Monthly', 'month', 2.99, 'EUR'),
  ('pro_01kgdbmh2zxx7b9zcj8p4ygbqd', 'pri_01kgdbs0zs4bbfv44aa91aecam', 'Yearly', 'year', 29.99, 'EUR'),
  ('pro_01kgdbmpjp0wnft05jseezjn47', 'pri_01kgdbtdy3rmek61qd23rsqp9f', 'Lifetime', 'one_time', 60.00, 'EUR')
ON CONFLICT (paddle_product_id) DO UPDATE SET
  paddle_price_id = EXCLUDED.paddle_price_id,
  name = EXCLUDED.name,
  billing_cycle = EXCLUDED.billing_cycle,
  price_amount = EXCLUDED.price_amount,
  currency = EXCLUDED.currency,
  updated_at = NOW();

-- Verify
SELECT * FROM subscription_plans ORDER BY price_amount;
