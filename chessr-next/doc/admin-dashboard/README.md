# Admin Dashboard Documentation

Technical documentation for the Chessr admin dashboard — a Next.js panel for managing users, monitoring the server, and controlling services.

## Tech Stack

- **Next.js 15** - App Router, server/client components
- **TypeScript** - Type safety
- **Tailwind CSS 3.4** - Styling
- **Radix UI** - Accessible UI primitives
- **Recharts 3.7** - Activity charts
- **@supabase/supabase-js** - Database & auth

## Architecture

The dashboard runs as a Next.js app on port 3001 (mapped from internal 3000). It connects to Supabase for data, the WebSocket server for live stats, and the Docker socket for container management.

```
Admin User (browser)
       │
       ▼
  dashboard.chessr.io
  (Next.js App Router)
       │
       ├──► Supabase (users, plans, activity)
       ├──► chessr-server:8080 (live stats)
       ├──► Docker socket (container control)
       └──► Discord API (notifications, roles)
```

## Authentication & Authorization

**Provider:** Supabase Auth

**Roles:**
| Role | Dashboard Access | Modify Plans | Modify Roles |
|------|-----------------|-------------|-------------|
| `user` | No | No | No |
| `admin` | Yes | Yes | No |
| `super_admin` | Yes | Yes | Yes |

**Login flow:**
1. Email/password sign-in via Supabase
2. API call to `/api/auth/check-role` to verify admin/super_admin role
3. Access granted or denied based on `user_settings.role`

## Dashboard Tabs

The main page (`app/page.tsx`) has 7 tabs:

### 1. Live Panel
Real-time server metrics from the `/stats` endpoint:
- Connected users count and list
- Engine pool status (Komodo + Stockfish)
- Queue sizes
- Machine metrics (CPU, RAM, disk)

### 2. Data Panel
Activity statistics with time-period charts (Recharts):
- Suggestions over time
- Analyses over time
- Customizable time ranges

### 3. Server Panel
Docker container management via docker.sock:
- View all containers with status
- Start / stop / restart individual services
- Update services (git pull + rebuild + restart)
- Build extension package

### 4. Logs Panel
Server container log viewer:
- Fetch Docker container logs
- Filterable and scrollable

### 5. Users Panel
Full user management interface:
- Search by email
- Filter by role, plan
- Sort by created_at, plan_expiry, last_activity
- Pagination with per-plan stats

**User actions:**
- Edit plan (free, freetrial, premium, beta, lifetime)
- Set plan expiry date
- Ban / unban (auto-reverts to free plan, unlinks all accounts)
- Delete account (requires admin password verification)
- View linked chess accounts and cooldown status

### 6. Plans Panel
Audit trail for all plan changes:
- Filter by action type
- Shows: user, old plan, new plan, reason, timestamp
- Data from `plan_activity_logs` table

### 7. Discord Panel
Discord integration controls:
- Send embeds to Discord channels
- Update status channel
- Sync plan roles for users
- View Discord channels list

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/check-role` | POST | Verify user role for dashboard access |
| `/api/users` | GET | List users with pagination, filters, sorting |
| `/api/users` | PATCH | Update plan, role, ban status, expiry |
| `/api/users` | DELETE | Delete user account (requires password) |
| `/api/linked-accounts` | GET | Fetch user's linked chess accounts |
| `/api/linked-accounts` | PATCH | Unlink an active account |
| `/api/linked-accounts` | DELETE | Remove account from cooldown |
| `/api/live` | GET | Real-time stats from WebSocket server |
| `/api/data` | GET | Activity timeline with period filter |
| `/api/plans` | GET | Plan activity audit logs |
| `/api/logs` | GET | Docker container logs |
| `/api/server` | GET | Status of all Docker services |
| `/api/server` | POST | Control services (start/stop/restart/update) |
| `/api/maintenance` | GET | Get current maintenance schedule |
| `/api/maintenance` | POST | Schedule a maintenance window |
| `/api/maintenance` | DELETE | Cancel maintenance schedule |
| `/api/discord` | GET | Fetch Discord channels list |
| `/api/discord` | POST | Send embed or update status |

## Key Flows

### Plan Change
1. Admin selects new plan via Users panel
2. `PATCH /api/users` with new plan + optional expiry
3. Permission check (`canModifyPlans`)
4. Update `user_settings` in Supabase
5. Log to `plan_activity_logs`
6. Sync Discord roles (remove old plan role, add new)
7. Send Discord notification to admin channel

### Ban User
1. Admin selects ban with optional reason
2. `PATCH /api/users` with `banned: true`
3. Set `plan = 'free'`, clear `plan_expiry`
4. Unlink all chess accounts (soft delete)
5. Log to `plan_activity_logs`
6. Sync Discord roles to free
7. Send Discord notification

### Delete User
1. Admin confirms deletion with their password
2. `DELETE /api/users` with password verification
3. Remove from `user_settings`, clear `linked_accounts`
4. Delete Supabase Auth user
5. Log audit entry
6. Send Discord notification

## Project Structure

```
admin-dashboard/
├── app/
│   ├── layout.tsx            # Root layout (dark mode)
│   ├── page.tsx              # Main dashboard (7 tabs)
│   ├── login/
│   │   └── page.tsx          # Admin login
│   └── api/
│       ├── auth/check-role/route.ts
│       ├── users/route.ts    # User CRUD + Discord sync
│       ├── linked-accounts/route.ts
│       ├── live/route.ts
│       ├── data/route.ts
│       ├── plans/route.ts
│       ├── logs/route.ts
│       ├── server/route.ts
│       ├── maintenance/route.ts
│       └── discord/route.ts
├── components/
│   ├── users-panel.tsx       # User management UI
│   ├── live-panel.tsx        # Real-time metrics
│   ├── data-panel.tsx        # Activity charts
│   ├── server-panel.tsx      # Docker controls
│   ├── plans-panel.tsx       # Plan audit logs
│   ├── logs-panel.tsx        # Container logs viewer
│   ├── discord-panel.tsx     # Discord controls
│   └── ui/                   # Radix UI components
├── lib/
│   └── types.ts              # TypeScript types + permissions
├── Dockerfile
├── package.json
└── next.config.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public Supabase URL (client-side) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public Supabase anon key |
| `WS_SERVER_URL` | No | WebSocket server URL (default: `http://chessr-server:8080`) |
| `SERVER_PATH` | No | Path to project on host (default: `/opt/chessr/app`) |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for admin notifications |
| `DISCORD_BOT_TOKEN` | No | Bot token for role sync and channel access |
| `DISCORD_GUILD_ID` | No | Discord server ID |
| `DISCORD_STATS_CHANNEL_ID` | No | Stats category channel ID |

## Docker

```dockerfile
# Image: node:20-alpine
# Includes Docker CLI + Compose plugin (for server management)
# Volume mounts: /var/run/docker.sock (container control), /opt/chessr/app:ro (git)
# Resources: 0.5 CPU, 512MB RAM
# Port: 3000 internal → 3001 external
# Health check: HTTP GET on port 3000
```
