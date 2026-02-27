# Infrastructure Documentation

Technical documentation for the Chessr production infrastructure — VPS, Docker, Nginx, SSL, and deployment.

## VPS Specifications

| Spec | Value |
|------|-------|
| **Provider** | Hetzner |
| **OS** | Ubuntu 24.04.3 LTS (Noble Numbat) |
| **CPU** | AMD EPYC-Genoa, 8 cores, x86_64 |
| **CPU Features** | AVX2, AVX-512, AES-NI |
| **RAM** | 16 GB |
| **Disk** | 301 GB SSD |
| **IP** | 91.99.78.172 |
| **Virtualization** | KVM |

## Network Architecture

```
                         Internet
                            │
                   ┌────────▼────────┐
                   │    UFW Firewall  │
                   │  22, 80, 443    │
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │   Nginx 1.24.0  │
                   │  (Reverse Proxy) │
                   └───┬────┬────┬───┘
                       │    │    │
         ┌─────────────┘    │    └─────────────┐
         ▼                  ▼                  ▼
  engine.chessr.io  dashboard.chessr.io  download.chessr.io
    WSS → :8080      HTTPS → :3001      Static files
    (chessr-server)  (chessr-admin)      (/opt/chessr/extension)
         │
         ├──── chessr-network (bridge) ────┐
         │                                 │
  ┌──────▼───────┐                ┌────────▼───────┐
  │ chessr-discord│                │  chessr-cron   │
  │ (Discord Bot) │                │ (Background    │
  │ No public port│                │  jobs)         │
  └──────┬────────┘                └────────┬───────┘
         │                                  │
         └──────────► Supabase ◄────────────┘
                    Discord API
```

## Domains

| Domain | Type | Target | SSL |
|--------|------|--------|-----|
| `engine.chessr.io` | Nginx proxy | localhost:8080 (WSS) | Let's Encrypt |
| `dashboard.chessr.io` | Nginx proxy | localhost:3001 (HTTPS) | Let's Encrypt |
| `download.chessr.io` | Nginx static | /opt/chessr/extension | Let's Encrypt |
| `chessr.io` | Vercel | Landing page | Vercel managed |

## SSL Certificates

- **Provider:** Let's Encrypt via Certbot
- **Auto-renewal:** Yes (Certbot timer)
- **Certificate 1:** `dashboard.chessr.io` + `engine.chessr.io` (shared cert)
- **Certificate 2:** `download.chessr.io`

## Nginx Configuration

### engine.chessr.io
WebSocket proxy with long-lived connections:
- `proxy_pass http://localhost:8080`
- WebSocket upgrade headers (`Upgrade`, `Connection`)
- 7-day timeouts for persistent WebSocket connections
- Forwards real IP headers

### dashboard.chessr.io
Standard HTTPS reverse proxy:
- `proxy_pass http://localhost:3001`
- WebSocket upgrade support (Next.js HMR)
- Forwards real IP headers

### download.chessr.io
Static file server:
- Root: `/opt/chessr/extension`
- CORS headers on `version.json` (extension update check)
- Gzip compression enabled
- 1-hour cache for static assets (zip, images)

## Firewall (UFW)

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (redirects to HTTPS) |
| 443 | TCP | HTTPS + WSS |

## Docker

### Version
- **Docker:** 29.2.0
- **Compose:** v5.0.2

### Containers

| Container | Image | CPU Limit | RAM Limit | RAM Reserved | Port |
|-----------|-------|-----------|-----------|-------------|------|
| chessr-server | node:20-slim | 4 CPU | 4 GB | 1 GB | 8080 |
| chessr-admin | node:20-alpine | 0.5 CPU | 512 MB | — | 3001→3000 |
| chessr-discord | node:20-alpine | 0.5 CPU | 256 MB | — | — |
| chessr-cron | node:20-alpine | 0.1 CPU | 128 MB | — | — |

### Network
- **Name:** chessr-network
- **Driver:** bridge
- Internal service discovery via container names (e.g., `chessr-server:8080`)

### Volumes
- `chessr-admin` mounts `/var/run/docker.sock` (container management)
- `chessr-admin` mounts `/opt/chessr/app:ro` (git operations)

### Restart Policy
All containers: `unless-stopped`

### Logging
All containers use JSON file driver with size limits:
- Server: 50MB max, 5 files
- Others: 10MB max, 3 files

## Directory Structure (VPS)

```
/opt/chessr/
├── app/                      # Git repository
│   ├── chessr-next/
│   │   ├── serveur/          # Server source + Dockerfile
│   │   ├── admin-dashboard/  # Dashboard source + Dockerfile
│   │   ├── discord-bot/      # Bot source + Dockerfile
│   │   ├── cron/             # Cron source + Dockerfile
│   │   └── doc/              # Documentation
│   ├── landing/              # Landing source + Dockerfile
│   ├── docker-compose.yml    # Service orchestration
│   └── .env                  # Environment variables
├── extension/                # Published extension files
│   ├── chessr-extension-v*.zip
│   └── version.json
└── logs/                     # Nginx logs
    ├── engine-access.log
    ├── engine-error.log
    ├── dashboard-access.log
    ├── dashboard-error.log
    ├── download-access.log
    └── download-error.log
```

## Deployment

### SSH Access
```bash
ssh -i ~/.ssh/id_ed25519 root@91.99.78.172
```

### Deploy a Service
```bash
cd /opt/chessr/app
git pull
docker compose build --no-cache <service>
docker compose up -d <service>
```

Services: `server`, `admin`, `discord-bot`, `cron`

### Deploy All Services
```bash
cd /opt/chessr/app
git pull
docker compose build --no-cache
docker compose up -d
```

### Publish Extension
```bash
cd /opt/chessr/app/chessr-next/extension
./scripts/publish.sh           # Bump version + build + upload
./scripts/publish.sh --force   # Republish without version bump
```

Extension download URL: `https://download.chessr.io/chessr-{version}.zip`

### Landing Page
Deploys automatically on Vercel when pushing to main branch. No VPS involvement.

## Monitoring

### Container Status
```bash
docker ps                           # Running containers
docker stats                        # Live CPU/RAM usage
docker logs chessr-server --tail 100 # Recent logs
```

### Server Stats
```bash
curl http://localhost:8080/stats     # Engine pool, queues, connected users
```

### Nginx Logs
```bash
tail -f /opt/chessr/logs/engine-access.log
tail -f /opt/chessr/logs/engine-error.log
```

### Disk Usage
```bash
df -h /                             # Disk space
docker system df                    # Docker disk usage
```
