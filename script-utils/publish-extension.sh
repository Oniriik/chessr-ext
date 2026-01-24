#!/bin/bash
# Publish Chessr extension to extension.chessr.io
# Builds locally and uploads to server
# Usage: ./publish-extension.sh

set -e

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="135.125.201.246"
EXTENSION_DIR="/opt/chess-server/extension"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
EXT_DIR="$PROJECT_DIR/extension"

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

# Step 1: Build extension locally
echo -e "${YELLOW}[1/4] Building extension locally...${NC}"
cd "$EXT_DIR"
npm run clean
npm run build:prod

# Get version from manifest.json
VERSION=$(grep '"version"' public/manifest.json | sed 's/.*: *"\([^"]*\)".*/\1/')
ZIP_NAME="chessr-${VERSION}.zip"
echo "Version: $VERSION"
echo "Package: $ZIP_NAME"

# Step 2: Create zip
echo -e "${YELLOW}[2/4] Creating zip package...${NC}"
cd dist
zip -r "/tmp/${ZIP_NAME}" . -x "*.map" "*.DS_Store" > /dev/null
cd "$EXT_DIR"
echo "Created /tmp/${ZIP_NAME}"

# Step 3: Upload to server
echo -e "${YELLOW}[3/4] Uploading to server...${NC}"
scp "/tmp/${ZIP_NAME}" "${SERVER_USER}@${SERVER_HOST}:/tmp/"
scp "$EXT_DIR/download-page/index.html" "${SERVER_USER}@${SERVER_HOST}:/tmp/"

# Step 4: Deploy on server
echo -e "${YELLOW}[4/4] Deploying on server...${NC}"
ssh "${SERVER_USER}@${SERVER_HOST}" << REMOTE_SCRIPT
set -e

EXTENSION_DIR="/opt/chess-server/extension"
VERSION="${VERSION}"
ZIP_NAME="${ZIP_NAME}"

# Ensure extension directory exists
sudo mkdir -p "\$EXTENSION_DIR"

# Remove old zip files
sudo rm -f \${EXTENSION_DIR}/chessr-*.zip

# Copy new files
sudo mv "/tmp/\${ZIP_NAME}" "\$EXTENSION_DIR/"
sudo mv "/tmp/index.html" "\$EXTENSION_DIR/"

# Create version.json
echo "{\"version\": \"\${VERSION}\", \"file\": \"\${ZIP_NAME}\"}" | sudo tee "\$EXTENSION_DIR/version.json" > /dev/null

# Set permissions
sudo chmod 644 \${EXTENSION_DIR}/*

echo "Deployed successfully!"
REMOTE_SCRIPT

# Cleanup local temp file
rm -f "/tmp/${ZIP_NAME}"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Extension Published Successfully!    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "Version: ${GREEN}${VERSION}${NC}"
echo -e "URL: ${GREEN}https://extension.chessr.io${NC}"
echo ""
