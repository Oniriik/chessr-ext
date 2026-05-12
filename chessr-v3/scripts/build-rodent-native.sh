#!/usr/bin/env bash
# Build the Rodent IV native binary for the local platform.
#
# Outputs:
#   - macOS arm64:  chessr-v3/serveur/engines/macos/rodent-m1
#   - Linux x86_64: chessr-v3/serveur/engines/linux/rodent
#
# Also stages adjacent `personalities/` and `books/` directories so the
# spawned engine finds them via its default cwd-relative lookup
# (EngineManager.ts sets cwd=path.dirname(enginePath) for engineType=rodent).
#
# Usage: scripts/build-rodent-native.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$REPO/rodent-sources"
PERS="$REPO/rodent-personalities"
BOOKS="$REPO/rodent-books"

if [[ ! -d "$SRC" ]]; then
  echo "✗ Rodent sources missing at $SRC"
  exit 1
fi

PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
  OUT_BIN="$REPO/serveur/engines/macos/rodent-m1"
  OUT_DIR="$REPO/serveur/engines/macos"
  echo "→ Building Rodent for macOS arm64 → $OUT_BIN"
elif [[ "$PLATFORM" == "Linux" ]]; then
  OUT_BIN="$REPO/serveur/engines/linux/rodent"
  OUT_DIR="$REPO/serveur/engines/linux"
  echo "→ Building Rodent for Linux $ARCH → $OUT_BIN"
else
  echo "✗ Unsupported platform: $PLATFORM $ARCH"
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$SRC"

# Same flags as Rodent's upstream Makefile minus the install bits.
g++ -O3 -std=c++14 \
  -w -Wfatal-errors -DNDEBUG \
  -finline-functions \
  src/*.cpp \
  -o "$OUT_BIN" \
  -lm

chmod +x "$OUT_BIN"

# Stage personalities/ and books/ alongside the binary so Rodent finds them
# via relative paths when EngineManager spawns it with cwd=OUT_DIR.
if [[ -d "$PERS" ]]; then
  rm -rf "$OUT_DIR/personalities"
  cp -r "$PERS" "$OUT_DIR/personalities"
  echo "  staged personalities ($(ls $OUT_DIR/personalities | wc -l | tr -d ' ') files)"
fi
if [[ -d "$BOOKS" ]]; then
  rm -rf "$OUT_DIR/books"
  cp -r "$BOOKS" "$OUT_DIR/books"
  echo "  staged books ($(du -sh $OUT_DIR/books | awk '{print $1}'))"
fi

echo "✓ Built $OUT_BIN"
ls -lh "$OUT_BIN"
