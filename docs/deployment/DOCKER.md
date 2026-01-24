# Docker Deployment Guide

Complete guide to deploying Chessr with Docker Compose.

## Services Overview

The Docker Compose setup includes three services:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| chess-server | chess-stockfish-server | 3000, 3001 | WebSocket + Metrics |
| dashboard | chess-dashboard | 3002 | Admin panel |
| nginx | chess-nginx | 80, 443 | Reverse proxy |

## Deployment Profiles

### With Nginx (Production)

```bash
docker compose --profile with-nginx up -d --build
```

### Without Nginx (Development)

```bash
docker compose up -d --build
```

## Environment Variables

### Root `.env` file

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://ratngdlkcvyfdmidtenx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_JWT_SECRET=<your-jwt-secret>

# Admin Configuration
ADMIN_EMAILS=admin@example.com
```

### Build-time Variables (Dashboard)

These are passed as build args in docker-compose.yml:

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `NEXT_PUBLIC_CHESS_SERVER_URL` - WebSocket URL (default: wss://ws.chessr.io)

### Runtime Variables

- `METRICS_URL` - Internal metrics endpoint
- `DOCKER_CONTAINER_NAME` - Target container for management

## Resource Limits

| Service | CPU | Memory |
|---------|-----|--------|
| chess-server | 2 cores | 2GB |
| dashboard | 0.5 cores | 512MB |
| nginx | (default) | (default) |

## Common Operations

### Start Services

```bash
# All services
docker compose --profile with-nginx up -d

# Specific service
docker compose up -d chess-server
```

### Rebuild Services

```bash
# Rebuild all
docker compose --profile with-nginx up -d --build

# Rebuild specific service
docker compose --profile with-nginx up -d --build dashboard

# Rebuild without cache
docker compose --profile with-nginx build --no-cache dashboard
docker compose --profile with-nginx up -d
```

### Stop Services

```bash
# Stop all
docker compose --profile with-nginx down

# Stop specific service
docker compose stop dashboard
```

### View Logs

```bash
# All services
docker compose --profile with-nginx logs -f

# Specific service
docker logs -f chess-stockfish-server
docker logs -f chess-dashboard
docker logs -f chess-nginx
```

### Restart Services

```bash
# Restart all
docker compose --profile with-nginx restart

# Restart specific service
docker compose restart nginx
```

## Network Configuration

All services run on the `chess-network` bridge network:

```
chess-network
├── chess-stockfish-server (chess-server)
├── chess-dashboard (dashboard)
└── chess-nginx
```

Internal DNS names:
- `chess-server` → chess-stockfish-server
- `dashboard` → chess-dashboard

## Volume Mounts

| Service | Mount | Purpose |
|---------|-------|---------|
| dashboard | `/var/run/docker.sock` | Container control |
| nginx | `./nginx/nginx.conf` | Configuration |
| nginx | `/etc/letsencrypt` | SSL certificates |
| nginx | `./nginx/logs` | Access/error logs |

## Health Checks

All services include health checks:

```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' chess-stockfish-server
docker inspect --format='{{.State.Health.Status}}' chess-dashboard
```

## Updating

### From Git Repository

```bash
cd /home/ubuntu/chess-server
git pull origin master
docker compose --profile with-nginx up -d --build
```

### Using Update Script

```bash
./update-remote-server.sh
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs chess-stockfish-server

# Check status
docker ps -a

# Rebuild from scratch
docker compose --profile with-nginx down
docker compose --profile with-nginx build --no-cache
docker compose --profile with-nginx up -d
```

### Network issues

```bash
# Test internal connectivity
docker exec chess-nginx ping chess-server
docker exec chess-dashboard ping chess-server

# Check network
docker network inspect chess-network
```

### Out of disk space

```bash
# Clean up Docker
docker system prune -a
docker volume prune
```
