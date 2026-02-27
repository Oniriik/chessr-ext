# Cron Jobs Documentation

Technical documentation for the Chessr scheduled background tasks.

## Tech Stack

- **TypeScript** - Language
- **tsx** - TypeScript execution
- **@supabase/supabase-js** - Database access
- **Alpine crond** - System cron daemon

## Architecture

The cron service runs two independent TypeScript jobs on fixed schedules using Alpine Linux's crond. Both jobs run immediately on container startup, then follow their scheduled interval.

```
┌──────────────────────────────────────────┐
│              Alpine crond                 │
│                                          │
│  */10 * * * *  ──► check-expirations.ts  │
│  */30 * * * *  ──► update-ratings.ts     │
│                                          │
│  On startup: run both immediately        │
└──────────────────┬───────────────────────┘
                   │
                   ▼
              Supabase DB + Discord Webhook
```

> Note: Signup notifications are handled by the Discord bot (not cron).

## Jobs

### 1. Check Expirations

**File:** `check-expirations.ts`
**Schedule:** Every 10 minutes
**Purpose:** Downgrade users whose plan has expired and notify via Discord.

**Process:**

1. Fetch user emails from Supabase Auth (for logging)
2. Query `user_settings` where `plan IN ('premium', 'freetrial') AND plan_expiry < now()`
3. For each expired user:
   - Set `plan = 'free'`, `plan_expiry = null`
   - Log to `plan_activity_logs` with action `cron_downgrade`
   - Send Discord webhook notification (email, old plan, expiry date)

**Database tables:**

- Reads/writes: `user_settings`
- Writes: `plan_activity_logs`

**External:** Discord Bot API (`DISCORD_BOT_TOKEN` + `DISCORD_NOTIFICATION_CHANNEL_ID`)

### 2. Update Ratings

**File:** `update-ratings.ts`
**Schedule:** Every 30 minutes
**Purpose:** Batch update player ratings from Chess.com and Lichess APIs.

**Process:**

1. Get cursor from `global_stats.ratings_cursor`
2. Fetch next 25 accounts from `linked_accounts` (ordered by ID, `unlinked_at IS NULL`)
3. For each account, call the appropriate API:
   - **Chess.com:** `https://api.chess.com/pub/player/{username}/stats`
     - Extract: `chess_bullet.last.rating`, `chess_blitz.last.rating`, `chess_rapid.last.rating`
   - **Lichess:** `https://lichess.org/api/user/{username}`
     - Extract: `perfs.bullet.rating`, `perfs.blitz.rating`, `perfs.rapid.rating`
4. Update `linked_accounts` with new ratings
5. Save cursor to `global_stats.ratings_cursor` (last processed account ID)
6. When cursor reaches end of table, reset for next full cycle

**Batch strategy:**

- `BATCH_SIZE = 25` accounts per run
- 500ms delay between API requests
- With 30min interval: full cycle of 300 accounts takes ~6 hours
- Errors are logged but don't stop the batch

**Database tables:**

- Reads/writes: `linked_accounts`, `global_stats`

## Project Structure

```
cron/
├── check-expirations.ts   # Plan expiration checker + Discord notification
├── update-ratings.ts      # Rating batch updater
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token for API calls |
| `DISCORD_NOTIFICATION_CHANNEL_ID` | Yes | Channel ID for downgrade notifications |

## Docker

```dockerfile
# Image: node:20-alpine
# Resources: 0.1 CPU, 128MB RAM
# Startup: runs both jobs immediately then starts crond
# Logs: redirected to /proc/1/fd/1 (Docker stdout)
```
