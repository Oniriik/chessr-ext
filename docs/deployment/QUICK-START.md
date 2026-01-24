# Quick Start Guide

Get Chessr running on a fresh VPS in under 10 minutes.

## Prerequisites

- Ubuntu 22.04+ VPS with SSH access
- Domain pointing to your server IP
- Git repository access

## 1. Connect to Server

```bash
# From your local machine
ssh ubuntu@135.125.201.246
```

Or use the connection script:
```bash
./ssh-connect.sh
```

## 2. Install Docker

```bash
# On the server
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt install -y docker-compose-plugin

# Log out and back in for group changes
exit
ssh ubuntu@135.125.201.246
```

## 3. Clone Repository

```bash
cd ~
git clone https://github.com/Oniriik/chessr-ext.git chess-server
cd chess-server
```

## 4. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://ratngdlkcvyfdmidtenx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
ADMIN_EMAILS=your-email@example.com
EOF
```

## 5. Deploy

```bash
# Deploy all services with nginx
docker compose --profile with-nginx up -d --build
```

## 6. Setup SSL (if using custom domain)

```bash
# Stop containers temporarily
docker compose --profile with-nginx down

# Get SSL certificates
sudo apt install -y certbot
sudo certbot certonly --standalone \
  -d ws.chessr.io \
  -d admin.chessr.io \
  --email your-email@example.com \
  --agree-tos

# Start containers
docker compose --profile with-nginx up -d
```

## 7. Verify

```bash
# Check containers are running
docker ps

# Test WebSocket (requires wscat)
npm install -g wscat
wscat -c wss://ws.chessr.io
```

## Quick Reference

| Action | Command |
|--------|---------|
| Start all | `docker compose --profile with-nginx up -d` |
| Stop all | `docker compose --profile with-nginx down` |
| View logs | `docker logs chess-stockfish-server` |
| Rebuild | `docker compose --profile with-nginx up -d --build` |

## Next Steps

- [Configure SSL](SSL.md) for production
- [Server Management](../operations/SERVER-MANAGEMENT.md) for operations
- [Architecture](../architecture/ARCHITECTURE.md) for system overview
