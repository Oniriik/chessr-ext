# Chessr Server Architecture

## Overview

The Chessr infrastructure consists of three main services running on a single server, orchestrated with Docker Compose and exposed via Nginx reverse proxy with SSL termination.

```
                                    ┌─────────────────────────────────────────────────────────┐
                                    │                    Server (135.125.201.246)             │
                                    │                                                         │
    Internet                        │   ┌─────────────────────────────────────────────────┐   │
        │                           │   │              Nginx (chess-nginx)                │   │
        │                           │   │                  Port 80, 443                   │   │
        ▼                           │   │                                                 │   │
┌───────────────┐                   │   │  ┌─────────────┐      ┌──────────────────┐     │   │
│ ws.chessr.io  │──────────────────────▶│  │ SSL (LE)    │      │ Rate Limiting    │     │   │
│ (WebSocket)   │                   │   │  └─────────────┘      └──────────────────┘     │   │
└───────────────┘                   │   └───────────────────────────────────────────────┬─┘   │
                                    │                           │                       │     │
┌───────────────┐                   │                           ▼                       ▼     │
│admin.chessr.io│──────────────────────▶   ┌────────────────────────────┐  ┌──────────────┐   │
│  (Dashboard)  │                   │      │    Chess Server            │  │  Dashboard   │   │
└───────────────┘                   │      │ (chess-stockfish-server)   │  │(chess-dash)  │   │
                                    │      │    Port 3000 (WS)          │  │  Port 3002   │   │
                                    │      │    Port 3001 (Metrics)     │  │              │   │
                                    │      │                            │  │              │   │
                                    │      │  ┌──────────────────────┐  │  │              │   │
                                    │      │  │   Stockfish Pool     │  │  │              │   │
                                    │      │  │   (sf_16.1)          │  │  │              │   │
                                    │      │  └──────────────────────┘  │  │              │   │
                                    │      └────────────────────────────┘  └──────────────┘   │
                                    │                                                         │
                                    └─────────────────────────────────────────────────────────┘
```

## Services

### 1. Chess Server (`chess-stockfish-server`)

**Purpose:** WebSocket server providing Stockfish chess analysis

| Property | Value |
|----------|-------|
| Container | `chess-stockfish-server` |
| Image | Built from `./server/Dockerfile` |
| Internal Ports | 3000 (WebSocket), 3001 (Metrics HTTP) |
| External Access | `wss://ws.chessr.io` |
| Resources | 2 CPU / 2GB RAM (limit) |

**Features:**
- Stockfish 16.1 compiled from source
- WebSocket connections with JWT authentication (Supabase)
- Metrics endpoint for monitoring
- Health check at `/health`

### 2. Admin Dashboard (`chess-dashboard`)

**Purpose:** Next.js admin panel for monitoring and server management

| Property | Value |
|----------|-------|
| Container | `chess-dashboard` |
| Image | Built from `./dashboard/Dockerfile` |
| Internal Port | 3000 |
| External Port | 3002 (direct), 443 via nginx |
| External Access | `https://admin.chessr.io` |
| Resources | 0.5 CPU / 512MB RAM (limit) |

**Features:**
- Real-time metrics display (auto-refresh every 5s)
- Docker container control (start/stop/restart)
- Docker logs viewer
- SSH terminal (whitelisted commands only)
- Analysis test panel
- Supabase authentication (admin-only access)
- shadcn/ui components with dark theme

### 3. Nginx Reverse Proxy (`chess-nginx`)

**Purpose:** SSL termination, routing, and rate limiting

| Property | Value |
|----------|-------|
| Container | `chess-nginx` |
| Image | `nginx:alpine` |
| Ports | 80 (HTTP), 443 (HTTPS) |

**Routing:**

| Domain | Destination | Features |
|--------|-------------|----------|
| `ws.chessr.io` | chess-server:3000 | WebSocket upgrade, 24h timeout |
| `admin.chessr.io` | dashboard:3000 | Standard HTTP proxy |
| Direct IP | Info page | Static HTML response |

## Network

All services communicate on the `chess-network` Docker bridge network.

```
chess-network (bridge)
├── chess-stockfish-server
├── chess-dashboard
└── chess-nginx
```

**Internal DNS:**
- `chess-server` → chess-stockfish-server container
- `dashboard` → chess-dashboard container

## SSL Certificates

Managed by Let's Encrypt via Certbot.

| Domain | Certificate Path | Expiry |
|--------|------------------|--------|
| ws.chessr.io | `/etc/letsencrypt/live/ws.chessr.io/` | 90 days |
| admin.chessr.io | `/etc/letsencrypt/live/admin.chessr.io/` | 90 days |

**Auto-renewal cron:**
```bash
0 0,12 * * * certbot renew --quiet --post-hook 'docker restart chess-nginx'
```

## Environment Variables

### Root `.env` file

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://ratngdlkcvyfdmidtenx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<key>
SUPABASE_JWT_SECRET=<secret>

# Admin
ADMIN_EMAILS=oniriik.dev@gmail.com
```

### Dashboard-specific (passed at build time)

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `METRICS_URL` - Internal metrics endpoint (`http://chess-server:3001/metrics`)
- `DOCKER_CONTAINER_NAME` - Target container name (`chess-stockfish-server`)

## Deployment

### Prerequisites

- Docker & Docker Compose installed
- Domain DNS pointing to server IP (135.125.201.246)
- SSL certificates generated

### Commands

```bash
# Full deployment with nginx
docker compose --profile with-nginx up -d --build

# Rebuild specific service
docker compose --profile with-nginx up -d --build dashboard

# View logs
docker logs chess-nginx
docker logs chess-dashboard
docker logs chess-stockfish-server

# Restart nginx (after config changes)
docker compose --profile with-nginx restart nginx

# Stop everything
docker compose --profile with-nginx down
```

### Initial SSL Setup

```bash
# Stop containers
docker compose --profile with-nginx down

# Get certificates
sudo certbot certonly --standalone \
  -d ws.chessr.io \
  -d admin.chessr.io \
  --email oniriik.dev@gmail.com \
  --agree-tos

# Start containers
docker compose --profile with-nginx up -d
```

## File Structure

```
chess/
├── docker-compose.yml          # Service orchestration
├── .env                        # Environment variables (server)
├── server/
│   ├── Dockerfile              # Chess server image
│   ├── src/                    # TypeScript source
│   └── package.json
├── dashboard/
│   ├── Dockerfile              # Dashboard image (Next.js standalone)
│   ├── app/                    # Next.js app router
│   │   ├── api/                # API routes
│   │   │   ├── auth/           # Admin check
│   │   │   ├── docker/         # Container control & logs
│   │   │   ├── metrics/        # Metrics proxy
│   │   │   └── ssh/            # Terminal commands
│   │   ├── login/              # Login page
│   │   └── page.tsx            # Dashboard page
│   ├── components/             # React components
│   │   ├── ui/                 # shadcn/ui components
│   │   └── *.tsx               # Feature components
│   ├── lib/                    # Utilities
│   │   ├── exec.ts             # Command execution
│   │   ├── supabase.ts         # Supabase client
│   │   └── utils.ts            # shadcn utils
│   └── .env.local              # Local dev environment
├── nginx/
│   ├── nginx.conf              # Nginx configuration
│   ├── logs/                   # Access & error logs
│   └── certbot/                # ACME challenge directory
└── docs/
    └── ARCHITECTURE.md         # This file
```

## Security

### Dashboard Access
- Protected by Supabase authentication
- Admin email whitelist (`ADMIN_EMAILS`)
- Rate limited (10 req/s)

### Terminal Commands
Whitelisted commands only:
- `ls`, `pwd`, `cat`, `head`, `tail`, `grep`
- `docker ps`, `docker logs`, `docker stats`, `docker inspect`
- `df`, `free`, `uptime`, `whoami`, `date`, `uname`

### Docker Socket
Dashboard has read-only access to Docker socket for container management.

### Rate Limiting
- Chess API: 20 req/s (burst 50)
- Dashboard: 10 req/s (burst 20)

## Monitoring

### Health Checks
- Chess server: `curl http://localhost:3000/health`
- Dashboard: `curl http://localhost:3002`
- Nginx: `docker logs chess-nginx`

### Metrics
Access via dashboard or directly:
```bash
curl http://localhost:3001/metrics
```

Returns:
```json
{
  "connectedClients": 0,
  "authenticatedUsers": 0,
  "stockfishPool": {
    "total": 4,
    "available": 4,
    "queued": 0
  },
  "users": []
}
```

## Troubleshooting

### Nginx won't start
```bash
# Check config syntax
docker exec chess-nginx nginx -t

# View error logs
docker logs chess-nginx
```

### Dashboard build fails
```bash
# Ensure env vars are set in .env
cat .env | grep SUPABASE

# Rebuild with no cache
docker compose --profile with-nginx build --no-cache dashboard
```

### SSL certificate renewal
```bash
# Manual renewal
sudo certbot renew

# Restart nginx to pick up new certs
docker restart chess-nginx
```

### Container connectivity
```bash
# Test internal DNS
docker exec chess-nginx ping chess-server
docker exec chess-dashboard ping chess-server
```
