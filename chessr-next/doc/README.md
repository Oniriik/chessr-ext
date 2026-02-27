# Chessr Documentation

Technical documentation for the Chessr platform — a real-time chess analysis tool with browser extension, WebSocket engine server, Discord bot, admin dashboard, and automated background jobs.

## Table of Contents

1. [Extension](./extension/README.md) - Chrome extension (React/Vite)
2. [Server](./serveur/README.md) - WebSocket engine server (Node.js/TypeScript)
3. [Discord Bot](./discord-bot/README.md) - Discord bot for roles & stats
4. [Cron Jobs](./cron/README.md) - Background scheduled tasks
5. [Admin Dashboard](./admin-dashboard/README.md) - Admin panel (Next.js)
6. [Landing Page](./landing/README.md) - Marketing site (Next.js/Vercel)
7. [Infrastructure](./infrastructure/README.md) - VPS, Docker, Nginx, SSL

## Architecture Overview

```
                        chessr.io (Vercel)
                             │
                         Landing Page
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
 Extension ──WSS──► engine.chessr.io        dashboard.chessr.io
 (Chrome)           (WebSocket Server)       (Admin Dashboard)
    │                   │        │                    │
    │                   │        │                    │
    ▼                   ▼        ▼                    ▼
 chess.com          Komodo    Stockfish          Docker Control
 lichess.org        Dragon    (Analysis)         User Management
                  (Suggestions)                  Discord Sync
                        │
                        ▼
                 ┌──────────────┐
                 │   Supabase   │◄──── Cron Jobs
                 │ (PostgreSQL) │◄──── Discord Bot
                 └──────────────┘
```

## Services

| Service | Tech | Port | Domain |
|---------|------|------|--------|
| Extension | React 19, Vite, TypeScript | — | chess.com / lichess.org |
| Server | Node.js, ws, TypeScript | 8080 | engine.chessr.io |
| Admin Dashboard | Next.js 15, App Router | 3001 | dashboard.chessr.io |
| Discord Bot | discord.js 14, JavaScript | — | — |
| Cron | TypeScript, Alpine crond | — | — |
| Landing | Next.js 15, Framer Motion | 3000 | chessr.io (Vercel) |

## Database (Supabase PostgreSQL)

| Table | Purpose |
|-------|---------|
| `user_settings` | User profile, plan, ban status, Discord link, role |
| `linked_accounts` | Chess.com/Lichess linked accounts with ratings |
| `signup_ips` | IP tracking with GeoIP for signups |
| `global_stats` | Key-value store (maintenance, cursors, counters) |
| `discord_freetrial_history` | Prevents re-link free trial abuse |
| `plan_activity_logs` | Audit trail for all plan changes |
| `user_activity` | Activity logs (suggestions, analyses) |

## Domains

| Domain | Host | Purpose |
|--------|------|---------|
| `chessr.io` | Vercel | Landing page |
| `engine.chessr.io` | Hetzner VPS | WebSocket server (WSS) |
| `dashboard.chessr.io` | Hetzner VPS | Admin dashboard (HTTPS) |
| `download.chessr.io` | Hetzner VPS | Extension download (static files) |

## Quick Deploy Reference

```bash
# SSH into VPS
ssh -i ~/.ssh/id_ed25519 root@91.99.78.172

# Deploy a service
cd /opt/chessr/app && git pull
docker compose build --no-cache <service>
docker compose up -d <service>

# Services: server, admin, discord-bot, cron
# Landing deploys automatically via Vercel on push

# Publish extension
cd extension && ./scripts/publish.sh
```
