#!/bin/bash
# Update server minVersion to match extension version
# Gets version from extension manifest.json and updates server/src/version-config.ts
# Usage: ./update-min-version.sh

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get version from manifest.json
VERSION=$(grep '"version"' "$PROJECT_DIR/extension/public/manifest.json" | sed 's/.*: *"\([^"]*\)".*/\1/')

echo -e "${YELLOW}Updating server minVersion to ${VERSION}...${NC}"

# Update minVersion in server config
sed -i '' "s/minVersion: '.*'/minVersion: '${VERSION}'/" "$PROJECT_DIR/server/src/version-config.ts"

echo -e "${GREEN}Done!${NC}"
echo "server/src/version-config.ts updated to minVersion: '${VERSION}'"
echo ""
echo "Next steps:"
echo "  1. git add server/src/version-config.ts"
echo "  2. git commit -m \"Bump minVersion to ${VERSION}\""
echo "  3. git push"
echo "  4. ./update-server.sh"
