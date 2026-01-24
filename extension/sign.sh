#!/bin/bash

# Chessr Extension Signing Script
# This script builds and signs the extension for distribution

set -e

# Check if key.pem exists
if [ ! -f "key.pem" ]; then
    echo "Error: key.pem not found!"
    echo "Generate a key first with: openssl genrsa -out key.pem 2048"
    exit 1
fi

# Build the extension
echo "Building extension..."
npm run build

# Sign the extension
echo "Signing extension..."
npx crx3 dist -o chessr.crx -p key.pem

echo ""
echo "Done! Created chessr.crx"
echo ""
echo "To get the extension ID, load the .crx in Chrome and check chrome://extensions"
