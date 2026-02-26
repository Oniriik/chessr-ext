#!/bin/bash
# Chessr Redeploy Script
# Usage: ./redeploy.sh [--dashboard] [--discord] [--server] [--cron]
# No args = redeploy all services

set -e

VPS_HOST="91.99.78.172"
VPS_USER="root"
VPS_PATH="/opt/chessr/app"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Parse arguments
DEPLOY_DASHBOARD=false
DEPLOY_DISCORD=false
DEPLOY_SERVER=false
DEPLOY_CRON=false
DEPLOY_ALL=true

while [[ $# -gt 0 ]]; do
  case $1 in
    --dashboard) DEPLOY_DASHBOARD=true; DEPLOY_ALL=false; shift ;;
    --discord)   DEPLOY_DISCORD=true; DEPLOY_ALL=false; shift ;;
    --server)    DEPLOY_SERVER=true; DEPLOY_ALL=false; shift ;;
    --cron)      DEPLOY_CRON=true; DEPLOY_ALL=false; shift ;;
    -h|--help)
      echo "Usage: $0 [--dashboard] [--discord] [--server] [--cron]"
      echo "  No args: redeploy all services"
      echo "  --dashboard  Redeploy admin dashboard"
      echo "  --discord    Redeploy discord bot"
      echo "  --server     Redeploy websocket server"
      echo "  --cron       Redeploy cron service"
      exit 0
      ;;
    *) error "Unknown option: $1" ;;
  esac
done

if $DEPLOY_ALL; then
  DEPLOY_DASHBOARD=true
  DEPLOY_DISCORD=true
  DEPLOY_SERVER=true
  DEPLOY_CRON=true
fi

# Build services list
SERVICES=()

if $DEPLOY_SERVER; then
  SERVICES+=("server")
fi

if $DEPLOY_DASHBOARD; then
  SERVICES+=("admin")
fi

if $DEPLOY_CRON; then
  SERVICES+=("cron")
fi

if $DEPLOY_DISCORD; then
  SERVICES+=("discord-bot")
fi

log "Services to deploy: ${SERVICES[*]}"

# Deploy on VPS
SERVICES_STR="${SERVICES[*]}"

ssh "$VPS_USER@$VPS_HOST" bash -s "$SERVICES_STR" << 'REMOTE_SCRIPT'
  set -e
  cd /opt/chessr/app
  SERVICES=($1)

  echo "[VPS] Current commit: $(git log --oneline -1)"

  # Reset dirty working directory to avoid pull conflicts
  if [ -n "$(git status --porcelain)" ]; then
    echo "[VPS] WARNING: Dirty working directory, resetting tracked files..."
    git checkout -- .
  fi

  echo "[VPS] Pulling latest code..."
  git pull

  echo "[VPS] Updated to: $(git log --oneline -1)"

  # Map service names to container names
  declare -A CONTAINER_NAMES
  CONTAINER_NAMES[server]="chessr-server"
  CONTAINER_NAMES[admin]="chessr-admin"
  CONTAINER_NAMES[cron]="chessr-cron"
  CONTAINER_NAMES[discord-bot]="chessr-discord"

  for svc in "${SERVICES[@]}"; do
    echo "[VPS] Stopping $svc..."
    container="${CONTAINER_NAMES[$svc]}"
    docker rm -f "$container" 2>/dev/null || true
  done

  for svc in "${SERVICES[@]}"; do
    echo "[VPS] Building $svc..."
    docker compose build --no-cache "$svc"
  done

  for svc in "${SERVICES[@]}"; do
    echo "[VPS] Starting $svc..."
    docker compose up -d "$svc"
  done

  echo ""
  echo "[VPS] Status:"
  docker compose ps
REMOTE_SCRIPT

log "Deploy complete!"
