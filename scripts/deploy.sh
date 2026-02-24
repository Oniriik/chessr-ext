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
  log_info "Building Docker images..."
  docker-compose build --parallel
  log_success "Build complete!"
}

# Start services
up() {
  check_env
  log_info "Starting Chessr services..."
  docker-compose up -d
  log_success "Services started!"
  echo ""
  status
}

# Stop services
down() {
  log_info "Stopping Chessr services..."
  docker-compose down
  log_success "Services stopped!"
}

# Restart services
restart() {
  log_info "Restarting Chessr services..."
  docker-compose restart
  log_success "Services restarted!"
}

# View logs
logs() {
  local service=${1:-}
  if [ -n "$service" ]; then
    docker-compose logs -f "$service"
  else
    docker-compose logs -f
  fi
}

# Check status
status() {
  echo ""
  log_info "Service Status:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  docker-compose ps
  echo ""
  log_info "Endpoints:"
  echo "  🎮 Server:    http://localhost:8080 (WebSocket)"
  echo "  🌐 Landing:   http://localhost:3000"
  echo "  📊 Admin:     http://localhost:3001"
}

# Pull latest code and rebuild
update() {
  log_info "Pulling latest changes..."
  git pull

  log_info "Rebuilding images..."
  build

  log_info "Restarting services..."
  docker-compose up -d

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
  echo "Usage: ./scripts/deploy.sh [command]"
  echo ""
  echo "Commands:"
  echo "  build      Build all Docker images"
  echo "  up         Start all services"
  echo "  down       Stop all services"
  echo "  restart    Restart all services"
  echo "  logs       View logs (optionally: logs [service])"
  echo "  status     Check service status"
  echo "  update     Pull latest code, rebuild, and restart"
  echo "  extension  Build Chrome extension"
  echo "  clean      Remove all containers and images"
  echo "  help       Show this help message"
  echo ""
  echo "Services: server, landing, admin"
}

# Main
case "${1:-help}" in
  build)    build ;;
  up)       up ;;
  down)     down ;;
  restart)  restart ;;
  logs)     logs "$2" ;;
  status)   status ;;
  update)   update ;;
  extension) extension ;;
  clean)    clean ;;
  help)     help ;;
  *)        log_error "Unknown command: $1"; help; exit 1 ;;
esac
