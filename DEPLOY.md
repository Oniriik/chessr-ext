# Chessr Deployment Guide

## Quick Start

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env with your Supabase credentials
nano .env

# 3. Build and start all services
./scripts/deploy.sh build
./scripts/deploy.sh up

# 4. Check status
./scripts/deploy.sh status
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| **server** | 8080 | WebSocket server with chess engines |
| **landing** | 3000 | Landing page (Next.js) |
| **admin** | 3001 | Admin dashboard (Next.js) |

## Commands

```bash
./scripts/deploy.sh build      # Build Docker images
./scripts/deploy.sh up         # Start services
./scripts/deploy.sh down       # Stop services
./scripts/deploy.sh restart    # Restart services
./scripts/deploy.sh logs       # View all logs
./scripts/deploy.sh logs server # View server logs
./scripts/deploy.sh status     # Check status
./scripts/deploy.sh update     # Pull, rebuild, restart
./scripts/deploy.sh extension  # Build Chrome extension
./scripts/deploy.sh clean      # Remove everything
```

## Chrome Extension

The extension is not dockerized (it's a browser extension). To build:

```bash
./scripts/deploy.sh extension
# or
cd chessr-next/extension
./scripts/build-prod.sh
```

Output: `chessr-next/extension/build/chessr-extension-vX.X.X.zip`

Upload to Chrome Web Store Developer Dashboard.

## Production Setup

### 1. Server Requirements

- Docker & Docker Compose
- 4+ CPU cores (for chess engines)
- 4+ GB RAM
- Linux with AVX2 support (for Stockfish/Dragon)

### 2. Environment Variables

```bash
# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx

# Public (for frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# Engine config (optional)
MAX_KOMODO_INSTANCES=2   # Dragon instances
MAX_STOCKFISH_INSTANCES=1
```

### 3. Reverse Proxy (Nginx)

For production, put Nginx in front with SSL:

```nginx
# /etc/nginx/sites-available/chessr
server {
    listen 443 ssl;
    server_name chessr.io;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Landing page
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 443 ssl;
    server_name engine.chessr.io;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket server
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}

server {
    listen 443 ssl;
    server_name admin.chessr.io;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Admin dashboard
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Engine won't start
- Check CPU supports AVX2: `grep avx2 /proc/cpuinfo`
- Check engine permissions: `docker-compose exec server ls -la /app/engines/linux/`

### WebSocket connection fails
- Check firewall allows port 8080
- Check Nginx WebSocket config (upgrade headers)

### Out of memory
- Reduce engine instances in `.env`
- Increase Docker memory limits

## Monitoring

```bash
# View logs
./scripts/deploy.sh logs server

# Check resource usage
docker stats

# Health checks
curl http://localhost:3000  # Landing
curl http://localhost:3001  # Admin
# Server returns 426 on HTTP (needs WebSocket)
```
