#!/usr/bin/env bash
# Upload the latest [BETA] zip to beta.chessr.io as /download/chessr-beta.zip.
# Requires the `chessr-beta` SSH alias.

set -euo pipefail

cd "$(dirname "$0")/.."

ZIP=$(ls -t .output/'[BETA] Chessr.io '*.zip 2>/dev/null | head -n1 || true)
if [[ -z "${ZIP}" ]]; then
  echo "No beta zip found in .output/. Run 'npm run build:beta' first." >&2
  exit 1
fi

echo "Uploading: ${ZIP}"
scp "${ZIP}" chessr-beta:/tmp/chessr-beta.zip
ssh chessr-beta "sudo mv /tmp/chessr-beta.zip /opt/chessr/chessr-v3/downloads/chessr-beta.zip && sudo chmod 644 /opt/chessr/chessr-v3/downloads/chessr-beta.zip && ls -la /opt/chessr/chessr-v3/downloads/chessr-beta.zip"

echo ""
echo "Live at: https://beta.chessr.io/download/chessr-beta.zip"
