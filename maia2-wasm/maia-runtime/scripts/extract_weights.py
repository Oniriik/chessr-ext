#!/usr/bin/env python3
"""
Extract Maia 2 weights from the official PyTorch checkpoint into a flat
fp32 binary in the EXACT order our C++ runtime (`maia-runtime/src/model.cpp::load_weights`)
expects, then emit a C array source file for embedding in the WASM build.

The order MUST match `load_weights()` byte-for-byte. If you change one,
update the other.

Usage:
    cd maia2-wasm/python
    .venv/bin/python ../maia-runtime/scripts/extract_weights.py \
        --checkpoint models/blitz_model.pt \
        --out ../maia-runtime/wasm/weights_data.cpp
"""

import argparse
import struct
import sys
from pathlib import Path

import torch
import numpy as np

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT.parent.parent / "python" / "maia2_src"))


def collect_tensors(state_dict, cfg):
    """Return a list of (name, np.ndarray) in the order our C++ load_weights() expects."""
    tensors = []

    def add(key, expected_shape=None, transpose_for_linear=False):
        t = state_dict[key].detach().cpu()
        if transpose_for_linear:
            # PyTorch nn.Linear stores weights as [out, in]. Our linear() expects [in, out].
            t = t.t().contiguous()
        arr = t.numpy().astype(np.float32)
        if expected_shape and tuple(arr.shape) != tuple(expected_shape):
            raise ValueError(f"{key}: expected shape {expected_shape}, got {arr.shape}")
        tensors.append((key, arr))

    # ChessResNet input conv
    add("chess_cnn.conv1.weight", (cfg.dim_cnn, cfg.input_channels, 3, 3))
    add("chess_cnn.bn1.weight",       (cfg.dim_cnn,))
    add("chess_cnn.bn1.bias",         (cfg.dim_cnn,))
    add("chess_cnn.bn1.running_mean", (cfg.dim_cnn,))
    add("chess_cnn.bn1.running_var",  (cfg.dim_cnn,))

    # ResNet blocks
    for i in range(cfg.num_blocks_cnn):
        prefix = f"chess_cnn.layers.{i}"
        add(f"{prefix}.conv1.weight", (cfg.dim_cnn, cfg.dim_cnn, 3, 3))
        add(f"{prefix}.bn1.weight",       (cfg.dim_cnn,))
        add(f"{prefix}.bn1.bias",         (cfg.dim_cnn,))
        add(f"{prefix}.bn1.running_mean", (cfg.dim_cnn,))
        add(f"{prefix}.bn1.running_var",  (cfg.dim_cnn,))
        add(f"{prefix}.conv2.weight", (cfg.dim_cnn, cfg.dim_cnn, 3, 3))
        add(f"{prefix}.bn2.weight",       (cfg.dim_cnn,))
        add(f"{prefix}.bn2.bias",         (cfg.dim_cnn,))
        add(f"{prefix}.bn2.running_mean", (cfg.dim_cnn,))
        add(f"{prefix}.bn2.running_var",  (cfg.dim_cnn,))

    # Output conv
    add("chess_cnn.conv_last.weight", (cfg.vit_length, cfg.dim_cnn, 3, 3))
    add("chess_cnn.bn_last.weight",       (cfg.vit_length,))
    add("chess_cnn.bn_last.bias",         (cfg.vit_length,))
    add("chess_cnn.bn_last.running_mean", (cfg.vit_length,))
    add("chess_cnn.bn_last.running_var",  (cfg.vit_length,))

    # Patch embedding (Linear 64→dim_vit + LayerNorm)
    add("to_patch_embedding.0.weight", (64, cfg.dim_vit), transpose_for_linear=True)
    add("to_patch_embedding.0.bias",   (cfg.dim_vit,))
    add("to_patch_embedding.1.weight", (cfg.dim_vit,))   # LN gamma
    add("to_patch_embedding.1.bias",   (cfg.dim_vit,))   # LN beta

    # Positional embedding
    add("pos_embedding", (1, cfg.vit_length, cfg.dim_vit))  # we'll squeeze in C++

    # Elo embedding
    add("elo_embedding.weight", (11, cfg.elo_dim))         # NUM_ELO_BUCKETS = 11

    inner_dim = 16 * 64  # heads * dim_head
    elo_dim_2 = cfg.elo_dim * 2
    mlp_dim = cfg.dim_vit

    # Transformer blocks
    for i in range(cfg.num_blocks_vit):
        prefix = f"transformer.elo_layers.{i}"
        # Attention
        add(f"{prefix}.0.norm.weight", (cfg.dim_vit,))
        add(f"{prefix}.0.norm.bias",   (cfg.dim_vit,))
        add(f"{prefix}.0.to_qkv.weight", (cfg.dim_vit, inner_dim * 3), transpose_for_linear=True)
        # No bias on to_qkv (bias=False in PyTorch source)
        add(f"{prefix}.0.elo_query.weight", (elo_dim_2, inner_dim), transpose_for_linear=True)
        # No bias on elo_query
        add(f"{prefix}.0.to_out.0.weight", (inner_dim, cfg.dim_vit), transpose_for_linear=True)
        add(f"{prefix}.0.to_out.0.bias",   (cfg.dim_vit,))
        # FFN (Sequential: LN → Linear → GELU → Dropout → Linear → Dropout)
        add(f"{prefix}.1.net.0.weight", (cfg.dim_vit,))   # LN gamma
        add(f"{prefix}.1.net.0.bias",   (cfg.dim_vit,))   # LN beta
        add(f"{prefix}.1.net.1.weight", (cfg.dim_vit, mlp_dim), transpose_for_linear=True)
        add(f"{prefix}.1.net.1.bias",   (mlp_dim,))
        add(f"{prefix}.1.net.4.weight", (mlp_dim, cfg.dim_vit), transpose_for_linear=True)
        add(f"{prefix}.1.net.4.bias",   (cfg.dim_vit,))

    # Transformer outer LN
    add("transformer.norm.weight", (cfg.dim_vit,))
    add("transformer.norm.bias",   (cfg.dim_vit,))

    # Final LN + heads
    add("last_ln.weight", (cfg.dim_vit,))
    add("last_ln.bias",   (cfg.dim_vit,))
    add("fc_1.weight", (cfg.dim_vit, 1880), transpose_for_linear=True)   # NUM_MOVES=1880
    add("fc_1.bias",   (1880,))
    add("fc_3_1.weight", (cfg.dim_vit, 128), transpose_for_linear=True)
    add("fc_3_1.bias",   (128,))
    add("fc_3.weight", (128, 1), transpose_for_linear=True)
    add("fc_3.bias",   (1,))

    return tensors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, help="Path to blitz_model.pt")
    ap.add_argument("--out", required=True, help="Output .cpp file (C array of weights)")
    args = ap.parse_args()

    print(f"Loading {args.checkpoint}…")
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    state_dict = ckpt.get("model_state_dict", ckpt)
    # Strip "module." prefix from DataParallel checkpoints.
    if any(k.startswith("module.") for k in state_dict):
        state_dict = {k.removeprefix("module."): v for k, v in state_dict.items()}

    # Synthesize a minimal cfg from observed shapes.
    class Cfg: pass
    cfg = Cfg()
    cfg.input_channels  = 18
    cfg.dim_cnn         = state_dict["chess_cnn.bn1.weight"].shape[0]
    cfg.dim_vit         = state_dict["to_patch_embedding.0.weight"].shape[0]
    cfg.num_blocks_cnn  = sum(1 for k in state_dict if k.startswith("chess_cnn.layers.") and k.endswith(".conv1.weight"))
    cfg.vit_length      = state_dict["chess_cnn.conv_last.weight"].shape[0]
    cfg.elo_dim         = state_dict["elo_embedding.weight"].shape[1]
    cfg.num_blocks_vit  = sum(1 for k in state_dict if k.startswith("transformer.elo_layers.") and k.endswith(".0.norm.weight"))

    print(f"Detected config: dim_cnn={cfg.dim_cnn}, dim_vit={cfg.dim_vit}, "
          f"num_blocks_cnn={cfg.num_blocks_cnn}, num_blocks_vit={cfg.num_blocks_vit}, "
          f"vit_length={cfg.vit_length}, elo_dim={cfg.elo_dim}")

    tensors = collect_tensors(state_dict, cfg)
    total_floats = sum(t.size for _, t in tensors)
    print(f"Collected {len(tensors)} tensors, {total_floats:,} floats ({total_floats * 4 / 1e6:.1f} MB)")

    # Concatenate to a single fp32 byte stream (little-endian).
    blob = b"".join(arr.astype(np.float32).tobytes() for _, arr in tensors)
    assert len(blob) == total_floats * 4

    print(f"Writing {args.out}…")
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        f.write("// Auto-generated by extract_weights.py — do not edit.\n")
        f.write("// Total tensors: %d, total bytes: %d\n\n" % (len(tensors), len(blob)))
        f.write('extern "C" {\n')
        f.write(f"alignas(64) extern const unsigned char g_maia_weights[{len(blob)}] = {{\n")
        for i in range(0, len(blob), 16):
            chunk = blob[i:i + 16]
            f.write("  " + ", ".join(f"0x{b:02x}" for b in chunk) + ",\n")
        f.write("};\n")
        f.write(f"extern const unsigned int g_maia_weights_size = {len(blob)};\n")
        f.write("}\n")

    print(f"✓ {out_path} ({out_path.stat().st_size / 1e6:.1f} MB source)")


if __name__ == "__main__":
    main()
