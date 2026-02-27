# Discord Bot Documentation

Technical documentation for the Chessr Discord bot — handles role assignment, stats display, and notifications.

## Tech Stack

- **discord.js 14** - Discord API framework
- **JavaScript** - ES modules
- **@supabase/supabase-js** - Database access
- **dotenv** - Environment configuration

## Architecture

The bot runs as a single-file service (`src/index.js`) that connects to Discord, registers slash commands, and runs multiple background loops.

```
Discord Gateway
      │
      ▼
  ┌───────────┐
  │  Bot Core  │
  │            │
  │  Commands  │──► /rank, /leaderboard
  │  Events    │──► guildMemberAdd, guildMemberRemove
  │  Loops     │──► Role sync, Stats, Signup notifications
  └─────┬──────┘
        │
        ▼
    Supabase DB ◄──► user_settings, linked_accounts
```

## Slash Commands

### `/rank [member]`

Shows a user's chess ratings across all linked accounts.

- Displays highest rating per time control (bullet, blitz, rapid) across all linked accounts
- Color-coded embed based on rapid rating tier
- Shows "Ratings updated every 30 min" footer
- If no member specified, shows the caller's ratings

### `/leaderboard [mode]`

Shows top 10 players by rating in the Discord server.

- **mode** parameter: `rapid` (default), `blitz`, `bullet`
- Filters to players with linked Discord accounts only
- Medal emojis for top 3 positions
- Shows username and rating

## Role System

The bot manages two types of mutually exclusive roles per user.

### Plan Roles

| Role | Condition |
|------|-----------|
| Free | `plan = 'free'` |
| Free Trial | `plan = 'freetrial'` |
| Premium | `plan = 'premium'` |
| Lifetime | `plan = 'lifetime'` |
| Beta | `plan = 'beta'` |

### ELO Roles

Based on highest **rapid** rating across all linked accounts.

| Role | Rating Range |
|------|-------------|
| Beginner | 0 – 799 |
| Novice | 800 – 999 |
| Intermediate | 1000 – 1199 |
| Club Player | 1200 – 1399 |
| Advanced | 1400 – 1599 |
| Expert | 1600 – 1799 |
| Master | 1800 – 1999 |
| Grandmaster | 2000+ |

## Events

### `guildMemberAdd`

When a user joins the Discord server:
1. Check if they have a linked Chessr account (via `discord_id` in `user_settings`)
2. If linked: assign plan role + ELO role
3. Update `discord_in_guild: true` in database

### `guildMemberRemove`

When a user leaves the Discord server:
- Update `discord_in_guild: false` in database

## Background Tasks

### Role Sync (every 10 minutes)

Keeps Discord roles in sync with database state:
1. Fetch all users with linked Discord accounts from `user_settings`
2. For each user in the guild:
   - Get current plan → assign correct plan role, remove old ones
   - Get highest rapid rating from `linked_accounts` → assign correct ELO role
3. Rate-limited to avoid Discord API throttling

### Stats Channel Updates (every 60 seconds)

Updates voice channel names in a stats category to display live metrics:

| Channel | Content |
|---------|---------|
| Status | `🟢 Working` / `🟡 Maintenance` / `🔴 Stopped` |
| Total Users | User count from Supabase |
| Playing Now | Connected users from server `/stats` endpoint |
| Moves Analyzed | From `global_stats.total_moves_analyzed` |
| Premium | Count of beta + premium + lifetime users |

Creates missing channels automatically if they don't exist.

### Signup Notifications (every 2 minutes)

Monitors for new user registrations:
1. Get last check time from `global_stats.last_signup_check`
2. Fetch all users created since last check (paginated, 1000/batch)
3. For each new signup, send Discord embed with:
   - Email address
   - Country (GeoIP from `signup_ips`, TLD fallback)
   - IP address
   - Timestamp
4. 500ms delay between notifications to avoid rate limits
5. Update `last_signup_check` timestamp

### Ban/Delete Notifications

When triggered by admin dashboard actions:
- Shows roles removed/added
- Includes admin tag
- User avatar thumbnail
- Posted to `DISCORD_LINK_CHANNEL_ID`

## Project Structure

```
discord-bot/
├── src/
│   └── index.js          # Bot entry point (all logic)
├── Dockerfile
├── package.json
└── .env                  # Environment variables (not committed)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_GUILD_ID` | Yes | Discord server ID |
| `DISCORD_CHANNEL_ID` | Yes | Stats category channel ID |
| `DISCORD_LINK_CHANNEL_ID` | Yes | Notification channel ID |
| `CHESSR_SERVER_URL` | No | WebSocket server URL (default: `http://chessr-server:8080`) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `UPDATE_INTERVAL` | No | Stats update interval in seconds (default: 60) |
| `DISCORD_ROLE_FREE` | Yes | Role ID for Free plan |
| `DISCORD_ROLE_FREETRIAL` | Yes | Role ID for Free Trial plan |
| `DISCORD_ROLE_PREMIUM` | Yes | Role ID for Premium plan |
| `DISCORD_ROLE_LIFETIME` | Yes | Role ID for Lifetime plan |
| `DISCORD_ROLE_BETA` | Yes | Role ID for Beta plan |
| `DISCORD_ROLE_ELO_0` | Yes | Role ID for Beginner (0-799) |
| `DISCORD_ROLE_ELO_800` | Yes | Role ID for Novice (800-999) |
| `DISCORD_ROLE_ELO_1000` | Yes | Role ID for Intermediate (1000-1199) |
| `DISCORD_ROLE_ELO_1200` | Yes | Role ID for Club Player (1200-1399) |
| `DISCORD_ROLE_ELO_1400` | Yes | Role ID for Advanced (1400-1599) |
| `DISCORD_ROLE_ELO_1600` | Yes | Role ID for Expert (1600-1799) |
| `DISCORD_ROLE_ELO_1800` | Yes | Role ID for Master (1800-1999) |
| `DISCORD_ROLE_ELO_2000` | Yes | Role ID for Grandmaster (2000+) |

## Docker

```dockerfile
# Image: node:20-alpine
# Resources: 0.5 CPU, 256MB RAM
# Health check: pgrep node
# Depends on: server service
```
