#!/bin/bash
# Publish Chessr extension to download server
# Usage: ./scripts/publish.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$EXTENSION_DIR/dist"
BUILD_DIR="$EXTENSION_DIR/build"

# Server config
SERVER="root@91.99.78.172"
REMOTE_DIR="/opt/chessr/extension"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Get version from manifest
get_version() {
  grep '"version"' "$EXTENSION_DIR/public/manifest.json" | head -1 | sed 's/.*: "\(.*\)".*/\1/'
}

# Get remote version
get_remote_version() {
  ssh "$SERVER" "cat $REMOTE_DIR/version.json 2>/dev/null | grep '\"version\"' | sed 's/.*: \"\(.*\)\".*/\1/'" || echo "0.0.0"
}

# Compare versions (returns 0 if $1 > $2)
version_gt() {
  test "$(printf '%s\n' "$@" | sort -V | head -n 1)" != "$1"
}

# Main
main() {
  local force=false
  [[ "$1" == "--force" ]] && force=true

  cd "$EXTENSION_DIR"

  # Get versions
  local version=$(get_version)
  local remote_version=$(get_remote_version)

  log_info "Local version:  $version"
  log_info "Remote version: $remote_version"

  # Check if version is newer
  if ! $force && ! version_gt "$version" "$remote_version"; then
    log_error "Local version ($version) is not newer than remote ($remote_version)"
    log_info "Use --force to publish anyway, or update version in manifest.json"
    exit 1
  fi

  # Build
  log_info "Building extension..."
  ./scripts/build-prod.sh

  # Find the zip file
  local zip_file="$BUILD_DIR/chessr-extension-v${version}.zip"
  if [ ! -f "$zip_file" ]; then
    log_error "Build file not found: $zip_file"
    exit 1
  fi

  local remote_filename="chessr-${version}.zip"

  # Upload
  log_info "Uploading to server..."
  scp "$zip_file" "$SERVER:$REMOTE_DIR/$remote_filename"

  # Update version.json
  log_info "Updating version.json..."
  ssh "$SERVER" "cat > $REMOTE_DIR/version.json << EOF
{
  \"version\": \"$version\",
  \"minVersion\": \"$version\",
  \"downloadUrl\": \"https://download.chessr.io/$remote_filename\",
  \"file\": \"$remote_filename\"
}
EOF"

  # Verify
  log_info "Verifying..."
  local new_remote_version=$(get_remote_version)

  if [ "$new_remote_version" == "$version" ]; then
    log_success "Extension v$version published successfully!"
    echo ""
    echo "  📦 Download: https://download.chessr.io/$remote_filename"
    echo "  📋 Version:  https://download.chessr.io/version.json"
    echo ""
  else
    log_error "Verification failed. Remote version: $new_remote_version"
    exit 1
  fi
}

main "$@"
