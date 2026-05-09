-- Analytics: append-only events log
-- ─────────────────────────────────────────────────────────────────────────
-- Generic event store for admin-relevant actions: plan changes, bans,
-- discord links, role updates, etc. Producers are the serveur, the
-- discord bot, and the dashboard (the latter via POST /admin/events on
-- the serveur — it can't reach the analytics DB directly).
--
-- Why a single jsonb-payload table vs a typed column per event kind:
--   - The set of event kinds will grow; locking each one to its own
--     column would force a migration every time we add one.
--   - We never aggregate inside `payload` — only filter on (type,
--     user_id, created_at). All hot queries are indexed.
--   - Payload contents are documented per-kind in serveur/src/lib/events.ts
--     where the typed emit helpers live.
--
-- Companion channel: serveur/bot publish each new row to Redis channel
-- `chessr:events` so subscribers can react in real time. The Postgres
-- row is the durable source of truth; Redis is fanout.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Discriminator, e.g. 'plan_changed', 'user_banned', 'discord_linked'.
  -- Free-form text rather than enum so adding a new kind doesn't require
  -- a migration. The producer-side helper enforces the allowed list.
  type        text NOT NULL,
  -- Subject of the event — usually a chessr user_id (auth.users.id on
  -- Supabase). Nullable for system-wide events that aren't user-scoped.
  user_id     uuid,
  -- Admin / actor who triggered the event, if any. Same shape as user_id
  -- (Supabase auth.users.id). Nullable for self-service or system events.
  actor_id    uuid,
  -- Free-form per-kind payload. Schema documented in events.ts.
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Hot queries:
--   1. Dashboard activity feed by recency, optionally filtered by type.
--   2. Per-user history (user detail sheet "Activity" tab eventually).
-- Two narrow indexes serve both without index bloat.
CREATE INDEX IF NOT EXISTS events_time_type_idx
  ON events (created_at DESC, type);
CREATE INDEX IF NOT EXISTS events_user_time_idx
  ON events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
