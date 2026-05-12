#!/usr/bin/env bash
# Build Rodent IV chess engine to WASM via Emscripten.
# Outputs rodent.{wasm,js,data} to repo root, then copy-engines.js
# (in extension/scripts/) propagates them to extension/public/engine/rodent/.
#
# Requires: emcc (Emscripten) in $PATH.
#
# Usage: scripts/build-rodent-wasm.sh

set -euo pipefail

# Resolve repo root from this script's location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO/rodent-sources"
PERS="$REPO/rodent-personalities"
BOOKS="$REPO/rodent-books"
OUT_DIR="$REPO"

if ! command -v emcc >/dev/null 2>&1; then
  echo "✗ emcc not found in PATH — install Emscripten first"
  echo "  https://emscripten.org/docs/getting_started/downloads.html"
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "✗ Rodent sources missing at $SRC"
  exit 1
fi
if [[ ! -d "$PERS" ]]; then
  echo "✗ Rodent personalities missing at $PERS"
  exit 1
fi
if [[ ! -d "$BOOKS" ]]; then
  echo "✗ Rodent books missing at $BOOKS"
  exit 1
fi

echo "→ Building Rodent IV WASM from $SRC"
echo "  Personalities: $PERS ($(ls $PERS | wc -l | tr -d ' ') files)"
echo "  Books:         $BOOKS ($(du -sh $BOOKS | awk '{print $1}'))"

cd "$SRC"

# Flags rationale:
#   -DNDEBUG          : strip asserts (perf)
#   -DANDROID         : stubs ChDirEnv() out (avoids POSIX wordexp not in WASM)
#   -fno-rtti -fno-exceptions : smaller binary, faster
#   -msimd128         : enables WASM SIMD128 for the engine's SSSE3 popcount
#   -sINITIAL_MEMORY=64MB : Rodent's hash table + heap; 16MB default OOMs
#   -sALLOW_MEMORY_GROWTH=1 : let WASM grow if user bumps Hash option
#   -sMAXIMUM_MEMORY=512MB  : cap (matches Komodo Hash max)
#   --preload-file <src>@<virt-path> : embed personalities into MEMFS
emcc -O3 -std=c++14 \
  -DNDEBUG -DANDROID \
  -fno-rtti -fno-exceptions \
  -msimd128 \
  -sINITIAL_MEMORY=64MB \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMAXIMUM_MEMORY=512MB \
  -sASYNCIFY=1 \
  -sASYNCIFY_STACK_SIZE=65536 \
  -sEXPORTED_RUNTIME_METHODS='["FS","callMain","ccall","cwrap"]' \
  --preload-file "$PERS@/personalities" \
  --preload-file "$BOOKS@/books" \
  -o "$OUT_DIR/rodent.html" \
  *.cpp

# Emscripten emits rodent.html (loader page we don't need) + rodent.js + rodent.wasm + rodent.data
# Drop the .html — extension uses the .js loader directly via the Worker pattern.
rm -f "$OUT_DIR/rodent.html"

echo "✓ Built artifacts:"
ls -lh "$OUT_DIR/rodent.wasm" "$OUT_DIR/rodent.js" "$OUT_DIR/rodent.data" 2>/dev/null
