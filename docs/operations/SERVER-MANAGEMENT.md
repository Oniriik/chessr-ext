# Server Management Guide

Day-to-day operations and management commands for Chessr.

## Quick Reference

### Server Access

```bash
# SSH to server
ssh ubuntu@135.125.201.246

# Or use the connection script
./ssh-connect.sh
```

### Common Commands

| Action | Command |
|--------|---------|
| View all containers | `docker ps` |
| View logs | `docker logs chess-stockfish-server` |
| Follow logs | `docker logs -f chess-stockfish-server` |
| Restart server | `docker compose restart chess-server` |
| Restart all | `docker compose --profile with-nginx restart` |
| Rebuild & restart | `docker compose --profile with-nginx up -d --build` |

## Container Management

### View Status

```bash
# All containers
docker ps -a

# Specific container
docker inspect chess-stockfish-server --format='Status: {{.State.Status}} | Health: {{.State.Health.Status}}'
```

### Start/Stop/Restart

```bash
# Start all
docker compose --profile with-nginx up -d

# Stop all
docker compose --profile with-nginx down

# Restart specific service
docker compose restart chess-server
docker compose restart dashboard
docker compose restart nginx
```

### View Logs

```bash
# Last 100 lines
docker logs --tail 100 chess-stockfish-server

# Follow in real-time
docker logs -f chess-stockfish-server

# All services
docker compose --profile with-nginx logs -f

# Filter by time
docker logs --since 1h chess-stockfish-server
```

## Monitoring

### Health Checks

```bash
# Check server health
curl http://localhost:3000/health

# Check metrics
curl http://localhost:3001/metrics
```

### Metrics Output

```json
{
  "connectedClients": 5,
  "authenticatedUsers": 3,
  "stockfishPool": {
    "total": 4,
    "available": 2,
    "queued": 0
  },
  "users": [...]
}
```

### Resource Usage

```bash
# Container stats
docker stats chess-stockfish-server chess-dashboard chess-nginx

# System resources
free -h
df -h
top
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
# From local machine
./update-remote-server.sh
```

### Rebuild Specific Service

```bash
docker compose --profile with-nginx up -d --build dashboard
docker compose --profile with-nginx up -d --build chess-server
```

## Logs Management

### Nginx Logs

```bash
# Access logs
tail -f /home/ubuntu/chess-server/nginx/logs/chess-access.log

# Error logs
tail -f /home/ubuntu/chess-server/nginx/logs/chess-error.log
```

### Clean Old Logs

```bash
# Docker logs are rotated automatically (configured in docker-compose.yml)
# Manual cleanup if needed:
docker system prune --volumes
```

## Backup & Restore

### Backup Configuration

```bash
# Backup .env and nginx config
tar -czf backup-$(date +%Y%m%d).tar.gz .env nginx/nginx.conf docker-compose.yml
```

### Database

Chessr uses Supabase cloud - no local database backup needed.

## Security

### Check Firewall

```bash
sudo ufw status
```

### Expected Ports

| Port | Service | Status |
|------|---------|--------|
| 22 | SSH | Allow |
| 80 | HTTP | Allow |
| 443 | HTTPS | Allow |
| 3000 | WebSocket (internal) | Docker network |
| 3001 | Metrics (internal) | Docker network |

### Update System

```bash
sudo apt update && sudo apt upgrade -y
```

## Useful Scripts

| Script | Purpose |
|--------|---------|
| `./ssh-connect.sh` | Connect to server with password |
| `./view-remote-logs.sh [n]` | View last n lines of logs |
| `./follow-remote-logs.sh` | Follow logs in real-time |
| `./restart-remote-server.sh` | Restart the server |
| `./check-server-status.sh` | Check server health |
| `./update-remote-server.sh` | Pull & rebuild from Git |
| `./deploy-server.sh` | Deploy local changes |

## Dashboard Access

The admin dashboard at `https://admin.chessr.io` provides:

- Real-time metrics display
- Docker container controls (start/stop/restart)
- Log viewer
- SSH terminal (whitelisted commands)
- Analysis test panel

Access requires Supabase authentication with an admin-whitelisted email.
