# Server Documentation

Technical documentation for the Chessr WebSocket server — a hybrid HTTP + WebSocket server that provides real-time chess engine analysis.

## Tech Stack

- **Node.js** - Runtime
- **TypeScript** - Language
- **ws** - WebSocket library
- **@supabase/supabase-js** - Database & auth
- **tsx** - TypeScript execution

## Architecture

The server runs on a single port (8080) handling both HTTP requests and WebSocket connections. It manages two separate chess engine pools for different analysis tasks.

```
Client (Extension)
      │
      ▼
  ┌─────────┐     ┌──────────────┐
  │  HTTP    │────►│ /version     │
  │  Server  │     │ /stats       │
  │          │     │ /discord/cb  │
  └────┬─────┘     └──────────────┘
       │
  ┌────▼─────┐
  │ WebSocket │
  │  Server   │
  └────┬──────┘
       │
  ┌────▼──────────────────────────────┐
  │          Message Router            │
  │                                    │
  │  suggestion ──► SuggestionQueue    │
  │                  └► Komodo Dragon  │
  │                                    │
  │  analyze ──► AnalysisQueue         │
  │               └► Stockfish         │
  │                                    │
  │  get_opening ──► OpeningHandler    │
  │                   └► Lichess API   │
  │                                    │
  │  link/unlink ──► AccountHandler    │
  │  discord ──► DiscordHandler        │
  └────────────────────────────────────┘
```

## Entry Point

**File:** `src/index.ts`

Startup sequence:
1. Create HTTP server with CORS
2. Attach WebSocket server
3. Initialize Komodo Dragon engine pool (default 2 instances)
4. Initialize Stockfish engine pool (default 1 instance)
5. Start heartbeat mechanism (ping every 30s, disconnect if no pong in 10s)
6. Initialize caches (ban status, maintenance schedule, IP storage)

## HTTP Endpoints

### `GET /version`
Returns minimum extension version and download URL for update checks.

### `POST /report-blocked-signup`
Logs blocked signup attempts (disposable emails). Resolves IP to country via ip-api.com and sends a Discord webhook notification.

### `GET /discord/callback`
Discord OAuth2 callback handler. Exchanges auth code for token, links Discord account, activates free trial if eligible, assigns Discord roles.

### `GET /stats`
Returns real-time server stats: connected users, queue sizes, engine pool status, opening cache stats.

### `OPTIONS *`
CORS preflight handler.

## WebSocket Protocol

### Authentication

1. Client connects and sends `auth` with Supabase JWT
2. Server validates token with Supabase service role key
3. Success → `auth_success` with user data, maintenance schedule, Discord info
4. Failure → `auth_error` + connection close (code 4003)
5. 10-second timeout for authentication

### Heartbeat

- Server pings every 30s
- Client must respond with pong within 10s
- Dead connections are terminated automatically

### Message Types

| Type | Handler | Direction | Purpose |
|------|---------|-----------|---------|
| `auth` | index.ts | C→S | Authenticate with JWT |
| `suggestion` | suggestionHandler | C→S | Request move suggestions |
| `analyze` | analysisHandler | C→S | Analyze a single move |
| `get_linked_accounts` | accountHandler | C→S | Fetch linked accounts |
| `link_account` | accountHandler | C→S | Link chess.com/lichess account |
| `unlink_account` | accountHandler | C→S | Unlink an account |
| `check_cooldown` | accountHandler | C→S | Check re-linking cooldown |
| `get_opening` | openingHandler | C→S | Get opening book data |
| `init_discord_link` | discordHandler | C→S | Start Discord OAuth flow |
| `unlink_discord` | discordHandler | C→S | Unlink Discord account |

## Handlers

### Suggestion Handler

**File:** `src/handlers/suggestionHandler.ts`

Provides move suggestions using the Komodo Dragon engine.

**Request:**
```json
{
  "type": "suggestion",
  "requestId": "uuid",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  "moves": ["e2e4"],
  "targetElo": 1500,
  "personality": "Default",
  "multiPv": 3,
  "contempt": 50,
  "puzzleMode": false,
  "limitStrength": true,
  "armageddon": "off"
}
```

**Response:**
```json
{
  "type": "suggestion_result",
  "requestId": "uuid",
  "fen": "...",
  "personality": "Default",
  "positionEval": 0.35,
  "mateIn": null,
  "winRate": 0.62,
  "suggestions": [
    {
      "multipv": 1,
      "move": "e7e5",
      "evaluation": 35,
      "depth": 18,
      "winRate": 0.62,
      "drawRate": 0.25,
      "lossRate": 0.13,
      "mateScore": null,
      "pv": ["e7e5", "g1f3", "b8c6"],
      "confidence": 0.92,
      "confidenceLabel": "very_reliable"
    }
  ]
}
```

**ELO-based node scaling:**

| Target ELO | Nodes |
|------------|-------|
| 400 | 50,000 |
| 1000 | 200,000 |
| 1500 | 500,000 |
| 2500 | 800,000 |
| 3500 | 1,000,000 |
| Puzzle mode | 1,000,000 (full strength) |

**Personalities:** Default, Aggressive, Defensive, Active, Positional, Endgame, Beginner, Human

**Confidence labels:** `very_reliable`, `reliable`, `playable`, `risky`, `speculative`

### Analysis Handler

**File:** `src/handlers/analysisHandler.ts`

Analyzes individual moves using Stockfish (separate pool from suggestions).

**Request:**
```json
{
  "type": "analyze",
  "requestId": "uuid",
  "fenBefore": "...",
  "fenAfter": "...",
  "move": "e2e4",
  "playerColor": "white"
}
```

**Response:**
```json
{
  "type": "analysis_result",
  "requestId": "uuid",
  "move": "e2e4",
  "classification": "good",
  "cpl": 45,
  "accuracyImpact": 12.5,
  "weightedImpact": 12.5,
  "phase": "middlegame",
  "evalBefore": 0.35,
  "evalAfter": -0.10,
  "bestMove": "d2d4"
}
```

**Move classification (CPL thresholds, depth 10):**

| Classification | CPL Range |
|---------------|-----------|
| Best | ≤ 10 |
| Excellent | ≤ 25 |
| Good | ≤ 60 |
| Inaccuracy | ≤ 120 |
| Mistake | ≤ 250 |
| Blunder | > 250 |

**Accuracy impact:** `40 * (1 - exp(-cpl / 150))` (capped at 40)

**Game phase weight:**
- Opening (>85% material): 0.7x
- Middlegame (35-85%): 1.0x
- Endgame (<35%): 1.3x

### Account Handler

**File:** `src/handlers/accountHandler.ts`

Manages linking/unlinking of chess.com and Lichess accounts.

**Plan limits:**

| Plan | Max Accounts | Cooldown |
|------|-------------|----------|
| free / freetrial | 1 | 48h after unlink |
| premium / lifetime / beta | Unlimited | None |

**Error codes:** `ALREADY_LINKED`, `COOLDOWN`, `LIMIT_REACHED`

### Opening Handler

**File:** `src/handlers/openingHandler.ts`

Proxies requests to the Lichess Explorer API with caching and rate limiting.

- **Cache TTL:** 30 minutes
- **Max cache size:** 1,000 entries (LRU)
- **Min request interval:** 500ms
- **Rate limit:** Exponential backoff, max 3 retries
- **Deduplication:** Multiple clients waiting for same FEN share one API call

### Discord Handler

**File:** `src/handlers/discordHandler.ts`

Handles Discord OAuth2 linking with automatic free trial activation.

**OAuth flow:**
1. Client sends `init_discord_link` with returnUrl
2. Server generates nonce (64-char hex), stores with 5-min TTL
3. Returns Discord OAuth URL
4. User authorizes on Discord
5. Discord redirects to `/discord/callback`
6. Server exchanges code for token, fetches user info
7. Links Discord ID to user, activates free trial if eligible
8. Assigns plan + ELO roles in Discord guild

**Anti-abuse:** Checks `discord_freetrial_history` table to prevent re-link trial exploitation.

## Engine Management

### Dual Pool Architecture

| Pool | Engine | Purpose | Default Instances |
|------|--------|---------|-------------------|
| EnginePool | Komodo Dragon | Move suggestions | 2 |
| StockfishPool | Stockfish | Move analysis | 1 |

**Platform binaries:**
- macOS ARM64: `engines/macos/dragon-m1`, `engines/macos/stockfish-m1`
- Linux AVX2: `engines/linux/dragon-avx2`, `engines/linux/stockfish-avx2`

**UCI protocol:** `uci` → `setoption` → `ucinewgame` → `position` → `go nodes N` → parse `info` lines → `bestmove`

### Request Queuing

Both suggestion and analysis queues use the same design:

- **User-based superseding:** New request from same user cancels pending request
- **Fair scheduling:** Round-robin dequeue by user (prevents monopolization)
- **Request validity:** Checks if request was superseded before sending response
- **Disconnect cleanup:** All pending requests cancelled when user disconnects
- **Dequeue interval:** 100ms

## Security

### Ban System
- Ban status cached for 60 seconds per user
- Checked before processing `suggestion` and `analyze` requests
- Banned users disconnected with code 4010

### IP Tracking
- Stores unique user + IP pairs in `signup_ips` table
- Resolves IP to country via ip-api.com
- Skips private IPs (127.0.0.1, ::1, 10.*, 172.*, 192.168.*)

### Maintenance Mode
- Schedule stored in `global_stats` table
- Cached for 60 seconds
- Broadcast to clients on auth

## Database Schema

### `user_settings`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid (FK) | Reference to auth.users |
| plan | text | free, freetrial, premium, lifetime, beta |
| plan_expiry | timestamp | Nullable, when plan expires |
| banned | boolean | Whether user is banned |
| ban_reason | text | Reason for ban |
| freetrial_used | boolean | Whether free trial was consumed |
| discord_id | text (unique) | Discord user ID |
| discord_username | text | Discord display name |
| discord_avatar | text | Discord avatar hash |
| discord_linked_at | timestamp | When Discord was linked |
| discord_in_guild | boolean | Whether user is in Discord server |

### `linked_accounts`
| Column | Type | Description |
|--------|------|-------------|
| id | serial (PK) | Auto-increment ID |
| user_id | uuid (FK) | Reference to auth.users |
| platform | text | chesscom or lichess |
| platform_username | text | Username on platform |
| avatar_url | text | Platform avatar |
| rating_bullet | integer | Bullet rating |
| rating_blitz | integer | Blitz rating |
| rating_rapid | integer | Rapid rating |
| linked_at | timestamp | When linked |
| unlinked_at | timestamp | Nullable, soft delete marker |

### `signup_ips`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid (FK) | Reference to auth.users |
| ip_address | text | User's IP address |
| country | text | Country name |
| country_code | text | ISO country code |

### `global_stats`
Key-value store. Known keys: `maintenance_schedule`, `maintenance_schedule_end`, `last_signup_check`, `ratings_cursor`, `total_moves_analyzed`.

### `discord_freetrial_history`
| Column | Type | Description |
|--------|------|-------------|
| discord_id | text (PK) | Discord user ID |
| user_id | uuid (FK) | User who used the trial |

### `plan_activity_logs`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid (FK) | Affected user |
| user_email | text | User email at time of action |
| action_type | text | discord_link, cron_downgrade, admin_change, etc. |
| old_plan | text | Previous plan |
| new_plan | text | New plan |
| old_expiry | timestamp | Previous expiry |
| new_expiry | timestamp | New expiry |
| reason | text | Human-readable reason |

## Project Structure

```
serveur/
├── src/
│   ├── index.ts                 # Entry point (HTTP + WS server)
│   ├── handlers/
│   │   ├── suggestionHandler.ts # Move suggestions (Komodo)
│   │   ├── analysisHandler.ts   # Move analysis (Stockfish)
│   │   ├── accountHandler.ts    # Account linking
│   │   ├── openingHandler.ts    # Opening book proxy
│   │   └── discordHandler.ts    # Discord OAuth
│   ├── engine/
│   │   ├── EngineManager.ts     # UCI engine wrapper
│   │   ├── EnginePool.ts        # Komodo pool
│   │   ├── StockfishPool.ts     # Stockfish pool
│   │   ├── KomodoConfig.ts      # Komodo configuration
│   │   ├── StockfishConfig.ts   # Stockfish configuration
│   │   └── MoveLabeler.ts       # Confidence scoring
│   ├── queue/
│   │   ├── SuggestionQueue.ts   # Suggestion request queue
│   │   └── AnalysisQueue.ts     # Analysis request queue
│   └── utils/
│       ├── logger.ts            # Request logging
│       └── activityLogger.ts    # Activity tracking
├── engines/
│   ├── macos/                   # macOS ARM64 binaries
│   ├── linux/                   # Linux AVX2 binaries
│   └── syzygy/                  # Endgame tablebases
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 8080 | Server port |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Supabase service role key |
| `MAX_KOMODO_INSTANCES` | No | 2 | Komodo Dragon engine instances |
| `MAX_STOCKFISH_INSTANCES` | No | 1 | Stockfish engine instances |
| `SYZYGY_PATH` | No | — | Path to Syzygy tablebases |
| `DISCORD_CLIENT_ID` | Yes | — | Discord OAuth app client ID |
| `DISCORD_CLIENT_SECRET` | Yes | — | Discord OAuth app client secret |
| `DISCORD_REDIRECT_URI` | Yes | — | Discord OAuth redirect URI |
| `DISCORD_GUILD_ID` | No | — | Discord server ID |
| `DISCORD_BOT_TOKEN` | No | — | Discord bot token (for role assignment) |
| `DISCORD_LINK_CHANNEL_ID` | No | — | Discord channel for link notifications |
| `DISCORD_SIGNUP_WEBHOOK_URL` | No | — | Webhook for signup reports |

## Docker

```dockerfile
# Multi-stage build: Node 20-slim
# Copies Linux engine binaries + Syzygy tablebases
# Resource limits: 4 CPU, 4GB RAM (reserved: 2 CPU, 1GB)
# Health check: HTTP GET on port 8080
```
