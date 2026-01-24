#!/bin/bash

# Chessr Extension Deploy Script
# Builds, signs, and deploys the extension via git push/pull

set -e

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="135.125.201.246"
SERVER_PROJECT="/home/ubuntu/chess-server"
EXTENSION_DIR="/opt/chess-server/extension"
EXTENSION_ID="pwhmheyvwvbalxjdcqdnpkwkmhgfzxal"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SCRIPT_DIR"

# Check if key.pem exists
if [ ! -f "key.pem" ]; then
    echo -e "${RED}Error: key.pem not found!${NC}"
    echo "Generate a key first with: openssl genrsa -out key.pem 2048"
    exit 1
fi

# Get current version from manifest
CURRENT_VERSION=$(grep '"version"' public/manifest.json | sed 's/.*: *"\([^"]*\)".*/\1/')
echo -e "${YELLOW}Current version: ${CURRENT_VERSION}${NC}"

# Parse version argument or prompt for new version
if [ -n "$1" ]; then
    NEW_VERSION="$1"
else
    # Suggest next patch version
    IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
    SUGGESTED_VERSION="${VERSION_PARTS[0]}.${VERSION_PARTS[1]}.$((VERSION_PARTS[2] + 1))"

    echo -n "Enter new version [$SUGGESTED_VERSION]: "
    read NEW_VERSION
    NEW_VERSION="${NEW_VERSION:-$SUGGESTED_VERSION}"
fi

echo -e "${GREEN}Deploying version: ${NEW_VERSION}${NC}"
echo ""

# Step 1: Update version in manifest.json
echo -e "${CYAN}[1/7] Updating manifest.json...${NC}"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" public/manifest.json

# Step 2: Build the extension
echo -e "${CYAN}[2/7] Building extension...${NC}"
npm run build

# Step 3: Sign the extension
echo -e "${CYAN}[3/7] Signing extension...${NC}"
npx crx3 dist -o chessr.crx -p key.pem

# Step 4: Update updates.xml
echo -e "${CYAN}[4/7] Updating updates.xml...${NC}"
cat > updates.xml << EOF
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${EXTENSION_ID}'>
    <updatecheck codebase='https://extension.chessr.io/chessr.crx' version='${NEW_VERSION}' />
  </app>
</gupdate>
EOF

# Step 5: Commit and push to git
echo -e "${CYAN}[5/7] Committing and pushing to git...${NC}"
cd "$ROOT_DIR"
git add extension/public/manifest.json extension/updates.xml
git commit -m "Release extension v${NEW_VERSION}" || echo "No changes to commit"
git push origin master

# Step 6: Pull on server and copy extension files
echo -e "${CYAN}[6/7] Deploying to server...${NC}"
ssh "${SERVER_USER}@${SERVER_HOST}" << REMOTE_SCRIPT
    set -e
    cd ${SERVER_PROJECT}
    git pull origin master

    # Ensure extension directory exists
    sudo mkdir -p ${EXTENSION_DIR}

    # Copy updates.xml from repo to extension directory
    sudo cp extension/updates.xml ${EXTENSION_DIR}/

    echo "Server updated successfully"
REMOTE_SCRIPT

# Step 7: Upload the signed .crx file (binary, not in git)
echo -e "${CYAN}[7/7] Uploading signed extension...${NC}"
scp chessr.crx "${SERVER_USER}@${SERVER_HOST}:/tmp/"
ssh "${SERVER_USER}@${SERVER_HOST}" "sudo mv /tmp/chessr.crx ${EXTENSION_DIR}/"

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}✓ Extension v${NEW_VERSION} deployed!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Files deployed to server:"
echo "  - ${EXTENSION_DIR}/chessr.crx"
echo "  - ${EXTENSION_DIR}/updates.xml"
echo ""
echo "Next steps:"
echo "  1. Update server/src/version-config.ts minVersion if forcing upgrade"
echo "  2. Chrome auto-updates within a few hours"
echo "  3. Force update: chrome://extensions > Update"
