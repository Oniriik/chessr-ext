#!/usr/bin/env bash
# Build Patricia WASM with the license-check baked in.
#
# Required env:
#   MASTER_PUBLIC_KEY_HEX  — 32 bytes as 64 lower-case hex chars (no 0x, no
#                            spaces). Generate with:
#                              openssl pkey -in license_private.pem -pubout \
#                                -outform DER | tail -c 32 | xxd -p -c 64
#
# Optional env:
#   LICENSE_URL            — overrides https://engine.chessr.io/api/license/verify
#   BUILD_TYPE             — "release" (default, -O3) or "debug" (-O0)
#
# Outputs: patricia.js + patricia.wasm in $(pwd).

set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${MASTER_PUBLIC_KEY_HEX:-}" ]]; then
  echo "ERROR: MASTER_PUBLIC_KEY_HEX not set." >&2
  echo "  Generate with: openssl pkey -in license_private.pem -pubout -outform DER | tail -c 32 | xxd -p -c 64" >&2
  exit 1
fi

if [[ ! "$MASTER_PUBLIC_KEY_HEX" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: MASTER_PUBLIC_KEY_HEX must be exactly 64 hex chars." >&2
  exit 1
fi

# Build hex array body: "0x.., 0x.., ..., 0x.." (32 bytes)
PUBKEY_BODY=$(echo "$MASTER_PUBLIC_KEY_HEX" | fold -w2 | awk '{printf "0x%s, ", $0}' | sed 's/, $//')

# Patch license.cpp in-place — replace the placeholder block with the real key.
# We write a sibling file (.build.cpp suffix) so emscripten recognises it as
# C++; cleaned up on exit.
TMP_LICENSE="$(pwd)/license.build.cpp"
trap 'rm -f "$TMP_LICENSE"' EXIT

awk -v pubkey="$PUBKEY_BODY" '
  /\/\*MASTER_PUBLIC_KEY_PLACEHOLDER\*\// {
    print "  " pubkey;
    skip = 1; next;
  }
  skip && /^[[:space:]]*0x00,/ { next; }
  skip && /^};/ { skip = 0; print; next; }
  skip { next; }
  { print; }
' license.cpp > "$TMP_LICENSE"

LICENSE_URL="${LICENSE_URL:-https://engine.chessr.io/api/license/verify}"
BUILD_TYPE="${BUILD_TYPE:-release}"

EXTRA_DEFINES=""
if [[ "$BUILD_TYPE" == "debug" ]]; then
  OPT_FLAGS="-O0 -g"
elif [[ "$BUILD_TYPE" == "verbose" ]]; then
  # Same speed as release but: leaves OBFS strings in plaintext + emits
  # license_verify() trace logs to stderr (visible in browser console).
  OPT_FLAGS="-O2 -msimd128"
  EXTRA_DEFINES="-DDISABLE_OBFS=1 -DLICENSE_DEBUG=1"
else
  OPT_FLAGS="-O3 -ffast-math -msimd128"
fi

OUT_BASENAME="${OUT_BASENAME:-patricia}"

echo "Building $OUT_BASENAME.{js,wasm}"
echo "  build_type     = $BUILD_TYPE"
echo "  license_url    = $LICENSE_URL"
echo "  pubkey (hex)   = ${MASTER_PUBLIC_KEY_HEX:0:8}…${MASTER_PUBLIC_KEY_HEX: -8}"

em++ \
  patricia_wasm.cpp \
  "$TMP_LICENSE" \
  monocypher/monocypher.c \
  nnue_data.cpp \
  $OPT_FLAGS \
  $EXTRA_DEFINES \
  -std=c++20 -DNDEBUG \
  -DLICENSE_URL_OVERRIDE="\"$LICENSE_URL\"" \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=0 \
  -s ENVIRONMENT=worker \
  -s FETCH=1 \
  -s INITIAL_MEMORY=64MB -s ALLOW_MEMORY_GROWTH=1 \
  -s STACK_SIZE=8MB \
  -s NO_EXIT_RUNTIME=1 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]' \
  -s EXPORTED_FUNCTIONS='["_wasm_init","_wasm_command","_wasm_set_auth_token","_malloc","_free"]' \
  -o "${OUT_BASENAME}.js"

echo "Built:"
ls -lh "${OUT_BASENAME}.js" "${OUT_BASENAME}.wasm"
