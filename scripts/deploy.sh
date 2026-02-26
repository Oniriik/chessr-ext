#!/bin/bash
# Chessr Deployment Script
# Usage: ./scripts/deploy.sh [command]
#   build   - Build all Docker images
#   up      - Start all services
#   down    - Stop all services
#   restart - Restart all services
#   logs    - View logs
#   status  - Check service status

set -e

# Remote server configuration
REMOTE_HOST="root@91.99.78.172"
REMOTE_PATH="/opt/chessr/app"

# Detect if running locally (macOS) or on server
is_local() {
  [[ "$(uname)" == "Darwin" ]]
}

# Run command on remote server via SSH
remote_exec() {
  ssh -t "$REMOTE_HOST" "cd $REMOTE_PATH && $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if .env exists
check_env() {
  if [ ! -f ".env" ]; then
    log_error ".env file not found!"
    log_info "Copy .env.example to .env and fill in your values:"
    echo "  cp .env.example .env"
    exit 1
  fi
}

# Build all images
build() {
  if is_local; then
    log_info "Building Docker images on remote server..."
    remote_exec "docker-compose build --parallel"
  else
    log_info "Building Docker images..."
    docker-compose build --parallel
  fi
  log_success "Build complete!"
}

# Start services
up() {
  if is_local; then
    log_info "Starting Chessr services on remote server..."
    remote_exec "docker-compose up -d"
  else
    check_env
    log_info "Starting Chessr services..."
    docker-compose up -d
  fi
  log_success "Services started!"
  echo ""
  status
}

# Stop services
down() {
  if is_local; then
    log_info "Stopping Chessr services on remote server..."
    remote_exec "docker-compose down"
  else
    log_info "Stopping Chessr services..."
    docker-compose down
  fi
  log_success "Services stopped!"
}

# Restart services
restart() {
  local service=${1:-}
  if is_local; then
    log_info "Restarting Chessr services on remote server..."
    remote_exec "docker-compose restart $service"
  else
    log_info "Restarting Chessr services..."
    docker-compose restart $service
  fi
  log_success "Services restarted!"
}

# View logs
logs() {
  local service=${1:-}
  if is_local; then
    if [ -n "$service" ]; then
      remote_exec "docker-compose logs --tail=100 $service"
    else
      remote_exec "docker-compose logs --tail=100"
    fi
  else
    if [ -n "$service" ]; then
      docker-compose logs -f "$service"
    else
      docker-compose logs -f
    fi
  fi
}

# Check status
status() {
  echo ""
  log_info "Service Status:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if is_local; then
    remote_exec "docker-compose ps"
  else
    docker-compose ps
  fi
  echo ""
  log_info "Endpoints:"
  echo "  🎮 Server:    https://engine.chessr.io (WebSocket)"
  echo "  🌐 Landing:   https://chessr.io"
  echo "  📊 Admin:     https://admin.chessr.io"
}

# Pull latest code and rebuild
update() {
  local service=${1:-}

  if is_local; then
    log_info "Updating on remote server..."
    if [ -n "$service" ]; then
      remote_exec "git pull && docker-compose build --no-cache $service && docker-compose up -d $service"
    else
      remote_exec "git pull && docker-compose build --no-cache && docker-compose up -d"
    fi
  else
    log_info "Pulling latest changes..."
    git pull

    if [ -n "$service" ]; then
      log_info "Rebuilding $service (no cache)..."
      docker-compose build --no-cache "$service"

      log_info "Restarting $service..."
      docker-compose up -d "$service"
    else
      log_info "Rebuilding all images (no cache)..."
      docker-compose build --no-cache

      log_info "Restarting services..."
      docker-compose up -d
    fi
  fi

  log_success "Update complete!"
  status
}

# Build extension
extension() {
  log_info "Building Chrome extension..."
  cd chessr-next/extension
  ./scripts/build-prod.sh
  cd "$PROJECT_DIR"
  log_success "Extension built!"
}

# Clean up
clean() {
  log_warning "This will remove all containers, images, and volumes!"
  read -p "Are you sure? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker-compose down -v --rmi all
    log_success "Cleanup complete!"
  fi
}

# Show help
help() {
  echo "Chessr Deployment Script"
  echo ""
  echo "Usage: ./scripts/deploy.sh [command] [service]"
  echo ""
  if is_local; then
    echo "Running from local machine - commands execute on remote server via SSH"
    echo "Remote: $REMOTE_HOST:$REMOTE_PATH"
    echo ""
  fi
  echo "Commands:"
  echo "  build      Build all Docker images"
  echo "  up         Start all services"
  echo "  down       Stop all services"
  echo "  restart    Restart services (optionally: restart [service])"
  echo "  logs       View logs (optionally: logs [service])"
  echo "  status     Check service status"
  echo "  update     Pull latest code, rebuild (no-cache), and restart"
  echo "             Optionally: update [service] to update single service"
  echo "  extension  Build Chrome extension"
  echo "  clean      Remove all containers and images"
  echo "  help       Show this help message"
  echo ""
  echo "Services: server, landing, admin, cron, discord-bot"
}

# Main
case "${1:-help}" in
  build)    build ;;
  up)       up ;;
  down)     down ;;
  restart)  restart "$2" ;;
  logs)     logs "$2" ;;
  status)   status ;;
  update)   update "$2" ;;
  extension) extension ;;
  clean)    clean ;;
  help)     help ;;
  *)        log_error "Unknown command: $1"; help; exit 1 ;;
esac
