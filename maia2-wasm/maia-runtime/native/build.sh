#!/usr/bin/env bash
# Build the native (Linux x86_64) Maia runtime binary.
#
# Compiles inside a debian:12-slim container so we get a portable ELF
# without setting up a cross-compile toolchain on macOS. Output:
#   maia-native (~80 MB — weights are baked in via wasm/weights_data.cpp)
#
# Run:
#   ./native/build.sh
#
# To install into the serveur engines dir for use by the chessr-v3 stack:
#   cp native/maia-native ../../chessr-v3/serveur/engines/linux/
#
# Note: NO SIMD enabled in this build. The model.cpp / ops.cpp SIMD blocks
# are gated on `__wasm_simd128__` which is only defined under em++. Native
# compilation falls back to scalar paths — slower but functionally
# identical. AVX2 SIMD can be added in a follow-up by abstracting the
# intrinsics layer.

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${OUT:-native/maia-native}"

if [[ ! -f native/weights.bin ]]; then
  echo "ERR: native/weights.bin missing. Generate it first:"
  echo "  python3 -c 'import re; src=open(\"wasm/weights_data.cpp\",\"rb\").read(); open(\"native/weights.bin\",\"wb\").write(bytes.fromhex((b\"\".join(re.findall(rb\"0x([0-9a-fA-F]{2})\", src))).decode()))'"
  exit 1
fi

echo "Building Maia native runtime → $OUT"
echo "  weights.bin: $(stat -f%z native/weights.bin 2>/dev/null || stat -c%s native/weights.bin) bytes embedded via ld -b binary"

docker run --rm \
  -v "$PWD:/work" \
  -w /work \
  --platform linux/amd64 \
  debian:12-slim \
  bash -lc '
    set -euo pipefail
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends g++ ca-certificates >/dev/null
    # Skip parsing wasm/weights_data.cpp (5 M lines → cc1plus OOMs even at
    # -O0). Instead embed the raw native/weights.bin via `ld -r -b binary`,
    # which produces _binary_weights_bin_{start,end,size} symbols that the
    # native main.cpp consumes.
    apt-get install -y -qq --no-install-recommends binutils >/dev/null
    cd native
    ld -r -b binary -o /tmp/weights.o weights.bin
    cd ..
    g++ -O3 -std=c++20 -DNDEBUG -pipe \
      -I src \
      native/main.cpp \
      src/ops.cpp \
      src/model.cpp \
      src/encoding.cpp \
      /tmp/weights.o \
      -o '"$OUT"'
    strip --strip-unneeded '"$OUT"' 2>/dev/null || true
  '

ls -lh "$OUT"
file "$OUT" 2>/dev/null || true
echo
echo "Smoke test (sends one predict, expects \"result 0.\" prefix):"
echo "  echo \"predict|rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1|5|5\" | docker run --rm -i --platform linux/amd64 -v \"\$PWD/native:/w\" -w /w debian:12-slim ./maia-native | cut -c1-60"
