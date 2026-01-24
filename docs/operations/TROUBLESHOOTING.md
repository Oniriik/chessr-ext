# Troubleshooting Guide

Common issues and their solutions.

## Quick Diagnostics

```bash
# Check all containers
docker ps -a

# Check logs
docker logs chess-stockfish-server --tail 50
docker logs chess-dashboard --tail 50
docker logs chess-nginx --tail 50

# Check health
curl http://localhost:3000/health
curl http://localhost:3001/metrics
```

## Container Issues

### Container Won't Start

**Symptoms**: Container status is "Exited" or "Restarting"

```bash
# Check exit reason
docker logs chess-stockfish-server

# Common fixes:
# 1. Rebuild image
docker compose --profile with-nginx build --no-cache chess-server
docker compose --profile with-nginx up -d

# 2. Check environment variables
cat .env

# 3. Check disk space
df -h
```

### Container Keeps Restarting

**Symptoms**: Container restarts every few seconds

```bash
# Check for crash reason
docker logs chess-stockfish-server --tail 100

# Check health status
docker inspect chess-stockfish-server --format='{{json .State.Health}}'

# Possible causes:
# - Port already in use
# - Missing environment variable
# - Failed health check
```

### Out of Memory

**Symptoms**: Container killed with OOM

```bash
# Check memory usage
docker stats

# Increase limits in docker-compose.yml or reduce load
# Current limits: chess-server: 2GB, dashboard: 512MB
```

## Network Issues

### Cannot Connect to WebSocket

**Symptoms**: Connection refused or timeout

```bash
# 1. Check if server is running
docker ps | grep chess-stockfish-server

# 2. Check if port is accessible
curl -v http://localhost:3000/health

# 3. Check nginx
docker logs chess-nginx
docker exec chess-nginx nginx -t

# 4. Check firewall
sudo ufw status
sudo ufw allow 443/tcp
```

### Internal Container Communication Fails

**Symptoms**: Dashboard can't reach metrics endpoint

```bash
# Test internal DNS
docker exec chess-dashboard ping chess-server
docker exec chess-nginx ping chess-server

# Check network
docker network inspect chess-network
```

### SSL Certificate Issues

**Symptoms**: Browser shows certificate error

```bash
# Check certificate
sudo certbot certificates

# Renew if expired
sudo certbot renew

# Restart nginx to pick up new certs
docker restart chess-nginx
```

## Nginx Issues

### Nginx Won't Start

```bash
# Test configuration
docker exec chess-nginx nginx -t

# Check logs
docker logs chess-nginx

# Common fixes:
# 1. Certificate files missing
ls -la /etc/letsencrypt/live/

# 2. Configuration syntax error - check nginx.conf
```

### 502 Bad Gateway

**Symptoms**: Nginx returns 502 error

```bash
# Check if backend is running
docker ps | grep chess-stockfish-server

# Check nginx can reach backend
docker exec chess-nginx ping chess-server

# Check backend health
docker exec chess-nginx curl http://chess-server:3000/health
```

### WebSocket Upgrade Fails

**Symptoms**: Connection works but WebSocket fails

```bash
# Check nginx logs for upgrade errors
tail -f /home/ubuntu/chess-server/nginx/logs/chess-error.log

# Ensure nginx config has WebSocket headers:
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection $connection_upgrade;
```

## Dashboard Issues

### Docker Commands Fail

**Symptoms**: "docker: not found" or "permission denied"

```bash
# Check Docker CLI in container
docker exec chess-dashboard docker --version

# Check docker group
docker exec chess-dashboard id

# Fix: Rebuild with docker-cli and correct group
# (Already configured in Dockerfile with GID 987)
docker compose --profile with-nginx up -d --build dashboard
```

### Authentication Fails

**Symptoms**: Can't log in to dashboard

```bash
# Check Supabase env vars are set
grep SUPABASE .env

# Check admin emails
grep ADMIN_EMAILS .env

# Verify dashboard can reach Supabase
docker logs chess-dashboard | grep -i supabase
```

## Stockfish Issues

### Analysis Times Out

**Symptoms**: No response or very slow analysis

```bash
# Check Stockfish pool status
curl http://localhost:3001/metrics | jq '.stockfishPool'

# Check if engines are available
# If all engines are busy, requests queue up

# Restart to reset pool
docker compose restart chess-server
```

### Stockfish Crashes

**Symptoms**: Engine errors in logs

```bash
# Check logs for Stockfish errors
docker logs chess-stockfish-server | grep -i stockfish

# Possible causes:
# - Invalid FEN position
# - Memory exhaustion
# - Corrupted engine state

# Fix: Restart server
docker compose restart chess-server
```

## Performance Issues

### High CPU Usage

```bash
# Check which container
docker stats

# For chess-server, check connected clients
curl http://localhost:3001/metrics | jq '.connectedClients'

# Solutions:
# - Increase pool size
# - Add rate limiting
# - Upgrade server
```

### High Memory Usage

```bash
# Check memory
docker stats
free -h

# Clean up Docker
docker system prune

# Restart affected container
docker compose restart chess-server
```

### Slow Response Times

```bash
# Check network latency
ping ws.chessr.io

# Check server load
ssh ubuntu@135.125.201.246 'top -bn1 | head -20'

# Check Stockfish queue
curl http://localhost:3001/metrics | jq '.stockfishPool.queued'
```

## Recovery Procedures

### Full Restart

```bash
docker compose --profile with-nginx down
docker compose --profile with-nginx up -d
```

### Rebuild Everything

```bash
docker compose --profile with-nginx down
docker compose --profile with-nginx build --no-cache
docker compose --profile with-nginx up -d
```

### Clean Slate

```bash
# WARNING: This removes all containers and volumes
docker compose --profile with-nginx down -v
docker system prune -a
git pull origin master
docker compose --profile with-nginx up -d --build
```

## Getting Help

1. Check logs first: `docker logs <container>`
2. Review this guide for common issues
3. Check [Architecture](../architecture/ARCHITECTURE.md) for system understanding
4. Search GitHub issues: https://github.com/Oniriik/chessr-ext/issues
