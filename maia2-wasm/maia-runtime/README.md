# maia-runtime — custom Maia 2 WASM runtime (premium gate, no ORT)

A from-scratch C++ runtime that runs Maia 2 inference in WebAssembly, replacing
`onnxruntime-web`. Reuses the same Ed25519 license-check chain as Patricia
(see `../patricia-build/LICENSE_DESIGN.md`) so a free user cannot bypass the
premium gate by patching JS.

## Status (work in progress)

- [x] `src/tensor.h` — minimal fp32 tensor, owns or borrows storage
- [x] `src/ops.{h,cpp}` — Linear, ReLU, GELU, LayerNorm, Softmax, Embedding, BatchNorm2d, Conv2d 3x3 s1 p1, batched matmul, transpose. WASM SIMD where straightforward.
- [x] `src/encoding.{h,cpp}` — `board_to_tensor(fen)` + `mirror_fen` + `mirror_move` (port of maia2/utils.py)
- [x] `src/model.{h,cpp}` — `MAIA2Model` forward (B=1) + weight blob layout
- [x] `wasm/maia_wasm.cpp` — entrypoints `wasm_init` / `wasm_set_auth_token` / `wasm_predict` / accessors. Calls `license_verify("maia2")` on each predict.
- [x] `wasm/build.sh` — em++ build, reuses `../patricia-build/wasm/license.cpp` + `monocypher/`
- [x] `scripts/extract_weights.py` — dumps PyTorch state_dict into the flat blob `wasm/weights_data.cpp`
- [ ] **Numerical parity tests vs PyTorch** — must pass top-3 moves identical on 100 positions before shipping
- [ ] Wiring into `chessr-v3/extension/entrypoints/content/lib/maiaSuggestionEngine.ts`
- [ ] End-to-end smoke test

## Build flow

```bash
# 1. Extract weights from the existing PyTorch checkpoint (one-time, or after upstream model update)
cd /path/to/maia2-wasm/python
.venv/bin/python ../maia-runtime/scripts/extract_weights.py \
    --checkpoint models/blitz_model.pt \
    --out ../maia-runtime/wasm/weights_data.cpp

# 2. Build the WASM (uses the same MASTER_PUBLIC_KEY_HEX as Patricia)
cd ../maia-runtime/wasm
MASTER_PUBLIC_KEY_HEX=<hex> ./build.sh

# 3. Outputs: wasm/maia.{js,wasm}
#    Copy into chessr-v3/extension/public/engine/maia2/
```

## Numerical-parity testing strategy (TODO)

Before shipping, we MUST verify `maia.wasm` produces the same top-3 moves and
winProb (within fp32 noise) as the PyTorch reference for a representative set
of positions.

Plan:
1. Generate 100 reference positions + PyTorch outputs (reuse
   `../python/reference.py`)
2. Build a Node test that loads `maia_node.js` (via `ENVIRONMENT=node` build)
   and runs the same 100 positions
3. Compare top-3 moves (set equality) and winProb (abs diff < 1e-3)
4. If any divergence → bisect by op, fix accumulator order or intermediate
   buffer reuse

Common sources of fp32 divergence to expect:
- Order of summation in conv/matmul (can shift by ~1e-5 per op)
- LayerNorm: numerical stability of variance
- Softmax: max-subtract is essential
- Conv: padding strategy must exactly match PyTorch's "padding=1"

## Threat model

Same as Patricia — see `../patricia-build/LICENSE_DESIGN.md`. Free users
who patch the extension's JS get nothing because:
1. The WASM does its own `emscripten_fetch` to `/api/license/verify`
2. The response is verified against the master Ed25519 pubkey baked at
   build time
3. `wasm_predict` returns 0 (no logits) without a valid grant

## Why `model.cpp` keeps no comments about what's checked

Comments are stripped at compile time so they don't appear in the WASM, but
revealing function names, string literals ("license", "MASTER", etc.) DO
make decompilation easier. Internal helpers + descriptive naming live here
in the source for maintainability; semantic explanation of the gate is
intentionally kept out of `wasm/maia_wasm.cpp` and `license.cpp`.
