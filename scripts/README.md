# Deployment Scripts

Scripts for initial server setup, deployment, and management.

## Quick Start

### For OVH VPS (Ubuntu)

```bash
# Interactive setup wizard
bash scripts/ovh-setup.sh

# Or directly install with Docker
bash scripts/install-docker-ovh.sh
```

### For Other VPS Providers

```bash
# Interactive connection and install
bash scripts/connect-vps.sh

# Or install Docker manually
bash scripts/install-docker.sh
```

## Script Categories

### Initial Setup

| Script | Purpose | User |
|--------|---------|------|
| `ovh-setup.sh` | OVH VPS setup wizard | Local |
| `connect-vps.sh` | Generic VPS connection wizard | Local |
| `setup-ssh.sh` | SSH key configuration | Local |
| `test-ssh.sh` | Test SSH connectivity | Local |

### Docker Installation (Recommended)

| Script | Purpose | User |
|--------|---------|------|
| `install-docker.sh` | Install Docker & deploy | root |
| `install-docker-ovh.sh` | Install Docker & deploy on OVH | ubuntu |

### Classic Installation (PM2)

| Script | Purpose | User |
|--------|---------|------|
| `install-vps.sh` | Install Node.js, Stockfish, PM2 | root |
| `full-install.sh` | Full classic deployment | Local |
| `deploy.sh` | Application deployment | Server |

### Domain & SSL

| Script | Purpose | User |
|--------|---------|------|
| `setup-nginx.sh` | Configure Nginx + SSL | root |
| `setup-domain.sh` | Configure ws.chessr.io | Local |
| `setup-domain-v2.sh` | Alternative domain setup | Local |

### Testing

| Script | Purpose | User |
|--------|---------|------|
| `test-server.sh` | Test WebSocket connectivity | Local |

## Usage Examples

### Fresh Server Setup (Docker)

```bash
# 1. Configure SSH and install Docker
bash scripts/ovh-setup.sh

# 2. Setup domain with SSL
bash scripts/setup-domain.sh
```

### Fresh Server Setup (Classic/PM2)

```bash
# 1. Run on VPS as root
bash scripts/install-vps.sh

# 2. Transfer files and deploy
bash scripts/full-install.sh
```

### Test WebSocket Connection

```bash
# Test local server
bash scripts/test-server.sh localhost 3000

# Test production server
bash scripts/test-server.sh ws.chessr.io 443
```

## Server Details

| Property | Value |
|----------|-------|
| IP | 135.125.201.246 |
| User | ubuntu |
| Project Dir | /home/ubuntu/chess-server |
| Hostname | vps-8058cb7f.vps.ovh.net |

## Root-Level Utility Scripts

These scripts in the project root handle day-to-day operations:

| Script | Purpose |
|--------|---------|
| `ssh-connect.sh` | Connect to server with password |
| `update-remote-server.sh` | Pull & rebuild from Git |
| `deploy-server.sh` | Build locally and deploy |
| `view-remote-logs.sh` | View server logs |
| `follow-remote-logs.sh` | Follow logs in real-time |
| `restart-remote-server.sh` | Restart server |
| `check-server-status.sh` | Check server health |
| `scp-upload.sh` | Upload file to server |
| `setup-git-remote.sh` | Configure Git on server |
| `test-connection.sh` | Test WebSocket connection |

## PM2 Commands (Classic Installation)

After classic installation, manage with PM2:

```bash
# View logs
pm2 logs chess-stockfish-server

# Restart
pm2 restart chess-stockfish-server

# Stop
pm2 stop chess-stockfish-server

# Monitoring
pm2 monit

# Status
pm2 status
```

## Docker Commands (Docker Installation)

After Docker installation:

```bash
# View logs
docker logs -f chess-stockfish-server

# Restart
docker compose restart chess-server

# Rebuild
docker compose up -d --build

# Status
docker ps
```

## Troubleshooting

### Permission denied

```bash
chmod +x scripts/*.sh
```

### SSH connection fails

```bash
# Test connection
bash scripts/test-ssh.sh

# Setup SSH key
bash scripts/setup-ssh.sh 135.125.201.246
```

### Docker not in PATH

```bash
# Reconnect SSH session after Docker install
exit
ssh ubuntu@135.125.201.246
```

## Security Notes

- Scripts use password authentication for convenience
- For production, configure SSH key authentication
- Password stored in scripts: `Chess2026SecurePass!` (change for security)

### Enable SSH Key Auth

```bash
# Generate key
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy to server
ssh-copy-id -i ~/.ssh/id_ed25519.pub ubuntu@135.125.201.246
```

## Documentation

- [Full Scripts Reference](../docs/scripts/SCRIPTS-REFERENCE.md)
- [Docker Deployment Guide](../docs/deployment/DOCKER.md)
- [Server Management](../docs/operations/SERVER-MANAGEMENT.md)
- [Architecture Overview](../docs/architecture/ARCHITECTURE.md)
