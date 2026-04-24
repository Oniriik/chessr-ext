# Maia 2 custom WASM runtime

Tiny C++ runtime that replaces `onnxruntime-web` for client-side Maia 2
inference. Forward pass (Conv2d / BN / Linear / LayerNorm / GELU / Softmax /
MHA / Embedding) written in ~2 KLOC, SIMD-accelerated via WASM v128.

## Build

```bash
# 1. Extract PyTorch weights to C array (one-time)
python scripts/extract_weights.py \
  --ckpt ../python/models/blitz_model.pt \
  --out wasm/weights_data.cpp

# 2. Build WASM
cd wasm && ./build.sh

# 3. Parity test vs PyTorch reference
python scripts/make_reference.py --positions 10 --out tests/reference.json
cd tests && node parity_test.mjs
```

## Outputs

- `wasm/maia.js` — emscripten glue (~23 KB)
- `wasm/maia.wasm` — ~81 MB (weights baked in)

Copy both to `chessr-v3/extension/public/engine/maia2/` to ship.
