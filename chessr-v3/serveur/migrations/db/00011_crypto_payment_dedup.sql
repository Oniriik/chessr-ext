-- Idempotence marker for the NOWPayments IPN handler.
-- ─────────────────────────────────────────────────────────────────────────
-- The crypto IPN handler (serveur/src/handlers/cryptoHandler.ts) claims a
-- `crypto_payment` events row via INSERT ... ON CONFLICT DO NOTHING BEFORE
-- doing any plan grant, so two concurrent/retried deliveries of the same
-- (paymentId, status) transition can never both win the claim and both
-- grant. This partial unique index is what makes that INSERT atomic.
--
-- Scoped to type = 'crypto_payment' only (partial index) — other event
-- kinds don't have a paymentId/status shape and shouldn't pay for this
-- index. Keyed on (paymentId, status) rather than paymentId alone so a
-- later status transition for the SAME payment (e.g. partially_paid ->
-- paid on a topped-up invoice) can still claim and grant.
-- ─────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS events_crypto_payment_dedup
  ON events (type, (payload->>'paymentId'), (payload->>'status'))
  WHERE type = 'crypto_payment';
