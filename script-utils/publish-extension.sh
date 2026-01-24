#!/bin/bash
# Publish Chessr extension to extension.chessr.io
# Usage: ./publish-extension.sh

set -e

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="135.125.201.246"
SERVER_PROJECT="/home/ubuntu/chess-server"
EXTENSION_DIR="/opt/chess-server/extension"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Publish Chessr Extension             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Execute on remote server
echo -e "${YELLOW}[1/5] Connecting to server...${NC}"

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_SCRIPT'
set -e

# Colors (redeclare for remote)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="/home/ubuntu/chess-server"
EXTENSION_DIR="/opt/chess-server/extension"

echo -e "${YELLOW}[2/5] Pulling latest code...${NC}"
cd "$PROJECT_DIR"
git pull origin master

echo -e "${YELLOW}[3/5] Building extension...${NC}"
cd "$PROJECT_DIR/extension"
npm ci --silent
npm run build:prod

echo -e "${YELLOW}[4/5] Packaging extension...${NC}"
# Get version from manifest.json
VERSION=$(grep '"version"' public/manifest.json | sed 's/.*: *"\([^"]*\)".*/\1/')
ZIP_NAME="chessr-${VERSION}.zip"

echo "Version: $VERSION"
echo "Package: $ZIP_NAME"

# Create zip (excluding source maps)
cd dist
zip -r "/tmp/${ZIP_NAME}" . -x "*.map" "*.DS_Store" > /dev/null

echo -e "${YELLOW}[5/5] Deploying to extension directory...${NC}"
# Ensure extension directory exists
sudo mkdir -p "$EXTENSION_DIR"

# Remove old zip files
sudo rm -f ${EXTENSION_DIR}/chessr-*.zip

# Copy new files
sudo cp "/tmp/${ZIP_NAME}" "$EXTENSION_DIR/"
sudo cp "$PROJECT_DIR/extension/download-page/index.html" "$EXTENSION_DIR/"

# Create version.json
echo "{\"version\": \"${VERSION}\", \"file\": \"${ZIP_NAME}\"}" | sudo tee "$EXTENSION_DIR/version.json" > /dev/null

# Set permissions
sudo chmod 644 ${EXTENSION_DIR}/*

# Cleanup
rm -f "/tmp/${ZIP_NAME}"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Extension Published Successfully!    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "Version: ${GREEN}${VERSION}${NC}"
echo -e "URL: ${GREEN}https://extension.chessr.io${NC}"
echo ""
REMOTE_SCRIPT

echo -e "${GREEN}Done!${NC}"
