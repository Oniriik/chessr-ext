# Scripts Reference

Complete reference for all deployment and utility scripts.

## Quick Reference

### Most Used Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `ssh-connect.sh` | Connect to server | `./ssh-connect.sh` |
| `update-remote-server.sh` | Pull & rebuild from Git | `./update-remote-server.sh` |
| `view-remote-logs.sh` | View server logs | `./view-remote-logs.sh [lines]` |
| `restart-remote-server.sh` | Restart server | `./restart-remote-server.sh` |
| `check-server-status.sh` | Health check | `./check-server-status.sh` |

## Root Directory Scripts

### ssh-connect.sh

Connect to the server with password authentication.

```bash
./ssh-connect.sh
```

**Details**: Uses `expect` to handle password-based SSH login to `ubuntu@135.125.201.246`.

---

### update-remote-server.sh

Pull latest changes from Git and rebuild containers.

```bash
./update-remote-server.sh
```

**Steps**:
1. Checks Git is configured
2. Pulls latest from master
3. Rebuilds Docker containers
4. Shows deployment status

---

### deploy-server.sh

Build locally and deploy to server.

```bash
./deploy-server.sh
```

**Steps**:
1. Builds server locally
2. Creates deployment archive
3. Uploads to server
4. Extracts and rebuilds
5. Verifies deployment

---

### view-remote-logs.sh

View recent server logs.

```bash
./view-remote-logs.sh        # Last 30 lines
./view-remote-logs.sh 100    # Last 100 lines
```

---

### follow-remote-logs.sh

Follow server logs in real-time.

```bash
./follow-remote-logs.sh
# Press Ctrl+C to stop
```

---

### restart-remote-server.sh

Restart the chess server container.

```bash
./restart-remote-server.sh
```

---

### check-server-status.sh

Check server health and status.

```bash
./check-server-status.sh
```

**Output**:
- Container status
- Health check result
- Recent logs
- WebSocket connection test

---

### test-connection.sh

Test WebSocket connection to the server.

```bash
./test-connection.sh
```

**Requirements**: `wscat` (install with `npm install -g wscat`)

---

### scp-upload.sh

Upload a file to the server.

```bash
./scp-upload.sh local-file.txt /remote/path/
```

---

### setup-git-remote.sh

Setup Git access on the remote server.

```bash
./setup-git-remote.sh
```

**Steps**:
1. Installs Git
2. Generates SSH key
3. Displays key for GitHub
4. Clones/configures repository

## Scripts Directory (`scripts/`)

### Initial Setup Scripts

#### scripts/ovh-setup.sh

Interactive VPS setup for OVH servers.

```bash
bash scripts/ovh-setup.sh
```

**Features**:
- SSH key configuration
- Password-based or panel-based setup
- Optional password change
- Installation method selection

---

#### scripts/connect-vps.sh

Interactive VPS connection and installation menu.

```bash
bash scripts/connect-vps.sh
```

**Options**:
1. Docker installation (recommended)
2. Classic installation (Node.js + PM2)
3. Test connection only

### Docker Installation

#### scripts/install-docker.sh

Install Docker and deploy with Docker Compose.

```bash
bash scripts/install-docker.sh
```

**Steps**:
1. Installs Docker on VPS
2. Transfers project files
3. Builds and starts containers

---

#### scripts/install-docker-ovh.sh

Docker installation specifically for OVH Ubuntu VPS.

```bash
bash scripts/install-docker-ovh.sh
```

**Differences from install-docker.sh**:
- Uses `ubuntu` user instead of `root`
- Configures docker group permissions
- Adapted paths for OVH

### Classic Installation

#### scripts/install-vps.sh

Install Node.js, Stockfish, and PM2 on VPS.

```bash
sudo bash scripts/install-vps.sh
```

**Installs**:
- Node.js 20.x
- Stockfish
- PM2
- UFW firewall

---

#### scripts/full-install.sh

Complete classic installation with file transfer.

```bash
bash scripts/full-install.sh
```

**Steps**:
1. Installs prerequisites
2. Transfers files
3. Builds and starts with PM2

---

#### scripts/deploy.sh

Deploy application (run on server after file transfer).

```bash
bash scripts/deploy.sh
```

**Requirements**: Must be run from `/opt/chess-server` directory.

### SSL & Domain Setup

#### scripts/setup-nginx.sh

Configure Nginx with SSL for a domain.

```bash
sudo bash scripts/setup-nginx.sh your-domain.com
```

---

#### scripts/setup-domain.sh

Configure `ws.chessr.io` domain with SSL.

```bash
bash scripts/setup-domain.sh
```

**Steps**:
1. Copies Nginx config
2. Guides DNS setup
3. Obtains SSL certificate
4. Tests connection

---

#### scripts/setup-domain-v2.sh

Alternative domain setup with separate HTTP/HTTPS phases.

```bash
bash scripts/setup-domain-v2.sh
```

### Testing Scripts

#### scripts/test-server.sh

Test WebSocket server connectivity.

```bash
bash scripts/test-server.sh [host] [port]
bash scripts/test-server.sh localhost 3000
bash scripts/test-server.sh ws.chessr.io 443
```

**Tests**:
1. TCP connection
2. WebSocket handshake
3. Functional test (with wscat)
4. Stockfish verification (if local)

---

#### scripts/test-ssh.sh

Test SSH connectivity to server.

```bash
bash scripts/test-ssh.sh
```

---

#### scripts/setup-ssh.sh

Configure SSH key-based authentication.

```bash
bash scripts/setup-ssh.sh 135.125.201.246
```

**Steps**:
1. Generates SSH key if needed
2. Copies key to server
3. Tests connection
4. Disables password authentication

## Extension Script

### extension/package.sh

Package Chrome extension for distribution.

```bash
cd extension
bash package.sh [dev|prod]
```

**Options**:
- `dev`: Uses localhost server
- `prod`: Uses production server (wss://ws.chessr.io)

**Output**: `chessr-extension-{mode}-{timestamp}.zip`

## Script Categories Summary

| Category | Scripts | Purpose |
|----------|---------|---------|
| **Connection** | `ssh-connect.sh`, `test-ssh.sh` | Server access |
| **Deployment** | `deploy-server.sh`, `update-remote-server.sh` | Deploy changes |
| **Monitoring** | `view-remote-logs.sh`, `follow-remote-logs.sh`, `check-server-status.sh` | Monitor server |
| **Setup** | `install-docker.sh`, `install-vps.sh`, `full-install.sh` | Initial setup |
| **SSL/Domain** | `setup-domain.sh`, `setup-nginx.sh` | SSL configuration |
| **Testing** | `test-server.sh`, `test-connection.sh` | Connectivity tests |

## Notes

### Password Authentication

Most scripts use `expect` for password-based SSH. The password is stored in scripts for convenience but should be secured:

```bash
# Current password (change for production)
Chess2026SecurePass!
```

### SSH Key Setup

For better security, set up SSH key authentication:

```bash
# Generate key locally
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy to server
ssh-copy-id -i ~/.ssh/id_ed25519.pub ubuntu@135.125.201.246

# After setup, disable password auth on server
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```
