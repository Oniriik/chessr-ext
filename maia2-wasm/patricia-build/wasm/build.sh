#!/usr/bin/env bash
# Build Patricia WASM.
#
# Optional env:
#   BUILD_TYPE   — "release" (default, -O3) or "debug" (-O0)
#
# Outputs: patricia.js + patricia.wasm in $(pwd).

set -euo pipefail
cd "$(dirname "$0")"

BUILD_TYPE="${BUILD_TYPE:-release}"

if [[ "$BUILD_TYPE" == "debug" ]]; then
  OPT_FLAGS="-O0 -g"
else
  OPT_FLAGS="-O3 -ffast-math -msimd128"
fi

OUT_BASENAME="${OUT_BASENAME:-patricia}"

echo "Building $OUT_BASENAME.{js,wasm}"
echo "  build_type = $BUILD_TYPE"

em++ \
  patricia_wasm.cpp \
  nnue_data.cpp \
  $OPT_FLAGS \
  -std=c++20 -DNDEBUG \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=0 \
  -s ENVIRONMENT=worker \
  -s INITIAL_MEMORY=64MB -s ALLOW_MEMORY_GROWTH=1 \
  -s STACK_SIZE=8MB \
  -s NO_EXIT_RUNTIME=1 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]' \
  -s EXPORTED_FUNCTIONS='["_wasm_init","_wasm_command","_malloc","_free"]' \
  -o "${OUT_BASENAME}.js"

echo "Built:"
ls -lh "${OUT_BASENAME}.js" "${OUT_BASENAME}.wasm"
