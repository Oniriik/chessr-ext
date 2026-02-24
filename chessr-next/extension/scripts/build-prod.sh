#!/bin/bash
# Build Chessr extension for production
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$EXTENSION_DIR/dist"
BUILD_DIR="$EXTENSION_DIR/build"

echo "🏗️  Building Chessr Extension..."

# Navigate to extension directory
cd "$EXTENSION_DIR"

# Clean previous builds
rm -rf "$DIST_DIR" "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  pnpm install
fi

# Set production environment
export NODE_ENV=production

# Build the extension
echo "🔨 Running build..."
pnpm build

# Copy manifest and icons to dist
echo "📋 Copying manifest and icons..."
cp "$EXTENSION_DIR/public/manifest.json" "$DIST_DIR/"
cp -r "$EXTENSION_DIR/public/icons" "$DIST_DIR/"

# Get version from manifest (exclude manifest_version)
VERSION=$(grep '"version"' "$DIST_DIR/manifest.json" | grep -v manifest_version | head -1 | sed 's/.*: "\(.*\)".*/\1/')

# Create zip for Chrome Web Store
echo "📦 Creating zip package..."
cd "$DIST_DIR"
ZIP_NAME="chessr-extension-v${VERSION}.zip"
zip -r "$BUILD_DIR/$ZIP_NAME" . -x "*.map"

echo ""
echo "✅ Build complete!"
echo "   📁 Dist: $DIST_DIR"
echo "   📦 Package: $BUILD_DIR/$ZIP_NAME"
echo ""
echo "To upload to Chrome Web Store:"
echo "   1. Go to https://chrome.google.com/webstore/devconsole"
echo "   2. Upload $BUILD_DIR/$ZIP_NAME"
