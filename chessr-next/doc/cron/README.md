# Cron Jobs Documentation

Technical documentation for the Chessr scheduled background tasks.

## Tech Stack

- **TypeScript** - Language
- **tsx** - TypeScript execution
- **@supabase/supabase-js** - Database access
- **Alpine crond** - System cron daemon

## Architecture

The cron service runs three independent TypeScript jobs on fixed schedules using Alpine Linux's crond. All jobs run immediately on container startup, then follow their scheduled interval.

```
┌──────────────────────────────────────────┐
│              Alpine crond                 │
│                                          │
│  */10 * * * *  ──► check-expirations.ts  │
│  */2  * * * *  ──► notify-signups.ts     │
│  */30 * * * *  ──► update-ratings.ts     │
│                                          │
│  On startup: run all three immediately   │
└──────────────────┬───────────────────────┘
                   │
                   ▼
              Supabase DB
```

## Jobs

### 1. Check Expirations

**File:** `check-expirations.ts`
**Schedule:** Every 10 minutes
**Purpose:** Downgrade users whose plan has expired.

**Process:**
1. Query `user_settings` where `plan IN ('premium', 'freetrial') AND plan_expiry < now()`
2. For each expired user:
   - Set `plan = 'free'`, `plan_expiry = null`
   - Log to `plan_activity_logs` with action `cron_downgrade`
3. Fetch user emails from Supabase Auth for logging

**Database tables:**
- Reads/writes: `user_settings`
- Writes: `plan_activity_logs`

### 2. Notify Signups

**File:** `notify-signups.ts`
**Schedule:** Every 2 minutes
**Purpose:** Send Discord notifications for new user signups.

**Process:**
1. Get last check time from `global_stats.last_signup_check`
2. Fetch all users created since last check (paginated, 1000 per batch)
3. For each new signup, look up country from `signup_ips` table (GeoIP)
4. If no GeoIP data, fall back to email TLD-based country detection
5. Send Discord webhook embed with: email, country, IP, timestamp
6. 500ms delay between notifications (rate limiting)
7. Update `global_stats.last_signup_check` to current time

**Database tables:**
- Reads: `signup_ips`, `global_stats`
- Writes: `global_stats`

**External:** Discord webhook URL

### 3. Update Ratings

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
├── check-expirations.ts   # Plan expiration checker
├── notify-signups.ts      # Signup notification sender
├── update-ratings.ts      # Rating batch updater
├── crontab                # Cron schedule definitions
├── startup.sh             # Runs all jobs on start + starts crond
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `DISCORD_SIGNUP_WEBHOOK_URL` | Yes | Discord webhook for signup notifications |

## Docker

```dockerfile
# Image: node:20-alpine
# Resources: 0.1 CPU, 128MB RAM
# Startup: runs startup.sh (immediate execution + crond foreground)
# Logs: redirected to /proc/1/fd/1 (Docker stdout)
```
