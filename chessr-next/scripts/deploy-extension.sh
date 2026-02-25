#!/bin/bash
# Chessr Extension Deploy Script
# Builds locally and deploys to VPS

set -e

VPS_HOST="91.99.78.172"
VPS_USER="root"
VPS_PATH="/opt/chessr/app/chessr-next/extension/build"
EXTENSION_PATH="$(dirname "$0")/../extension"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

cd "$EXTENSION_PATH"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
ZIP_NAME="chessr-extension-v${VERSION}.zip"

log "Building extension v${VERSION}..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  pnpm install
fi

# Build
pnpm build

if [ ! -d "dist" ]; then
  error "Build failed - dist folder not found"
fi

log "Build complete"

# Create zip
log "Creating ${ZIP_NAME}..."
mkdir -p build
cd dist
zip -r "../build/${ZIP_NAME}" .
cd ..

log "Zip created: build/${ZIP_NAME}"

# Upload to VPS
log "Uploading to VPS..."
scp "build/${ZIP_NAME}" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

log "Deployed extension v${VERSION} to VPS"

# Show files on server
ssh "${VPS_USER}@${VPS_HOST}" "ls -lh ${VPS_PATH}/"
