"""
Maia 2 → ONNX export.

Loads the official Maia 2 PyTorch checkpoint, strips DataParallel,
and exports to ONNX with dynamic batch dimension.

Usage:
    python export.py --type blitz
    python export.py --type rapid
"""

import argparse
import json
import os
import sys
from pathlib import Path

import torch
import torch.nn as nn

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT / "maia2_src"))

from maia2 import model as maia_model_mod  # noqa: E402
from maia2.utils import (  # noqa: E402
    create_elo_dict,
    get_all_possible_moves,
    parse_args,
)
from maia2.main import MAIA2Model  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["blitz", "rapid"], default="blitz")
    ap.add_argument("--out-dir", default=str(ROOT / "models"))
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    print(f"[1/4] Downloading {args.type} checkpoint via maia2.from_pretrained …")
    model = maia_model_mod.from_pretrained(type=args.type, device="cpu",
                                           save_root=args.out_dir)
    model.eval()

    all_moves = get_all_possible_moves()
    elo_dict = create_elo_dict()
    print(f"      moves={len(all_moves)}  elo_buckets={len(elo_dict)}")

    # Dummy inputs matching MAIA2Model.forward signature.
    cfg = model.cfg
    in_ch = cfg.input_channels
    boards = torch.zeros(1, in_ch, 8, 8, dtype=torch.float32)
    elos_self = torch.zeros(1, dtype=torch.long)
    elos_oppo = torch.zeros(1, dtype=torch.long)

    out_path = os.path.join(args.out_dir, f"{args.type}_model.onnx")
    print(f"[2/4] Exporting to ONNX (opset={args.opset}) → {out_path}")

    torch.onnx.export(
        model,
        (boards, elos_self, elos_oppo),
        out_path,
        input_names=["boards", "elos_self", "elos_oppo"],
        output_names=["logits_maia", "logits_side_info", "logits_value"],
        dynamic_axes={
            "boards":           {0: "batch"},
            "elos_self":        {0: "batch"},
            "elos_oppo":        {0: "batch"},
            "logits_maia":      {0: "batch"},
            "logits_side_info": {0: "batch"},
            "logits_value":     {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
        dynamo=False,  # Use legacy TorchScript exporter (cleaner ONNX, plays nice with quantizer).
    )

    # Sanity-check: load with onnxruntime and compare a single forward pass.
    print("[3/4] Verifying parity with onnxruntime …")
    import onnxruntime as ort
    import numpy as np

    sess = ort.InferenceSession(out_path, providers=["CPUExecutionProvider"])
    np.random.seed(0)
    rng_boards = np.random.rand(2, in_ch, 8, 8).astype(np.float32)
    rng_self = np.array([3, 7], dtype=np.int64)
    rng_oppo = np.array([5, 5], dtype=np.int64)

    with torch.no_grad():
        torch_out = model(
            torch.from_numpy(rng_boards),
            torch.from_numpy(rng_self),
            torch.from_numpy(rng_oppo),
        )
    ort_out = sess.run(None, {
        "boards": rng_boards,
        "elos_self": rng_self,
        "elos_oppo": rng_oppo,
    })

    for i, (t, o) in enumerate(zip(torch_out, ort_out)):
        diff = float(np.abs(t.numpy() - o).max())
        print(f"      output[{i}] max_abs_diff = {diff:.2e}")
        assert diff < 1e-3, f"output[{i}] diverges: {diff}"

    # Dump moves and elo dict so the JS side reuses the exact same encoding.
    print("[4/4] Writing moves.json and elo_dict.json …")
    with open(os.path.join(args.out_dir, "moves.json"), "w") as f:
        json.dump(all_moves, f)
    with open(os.path.join(args.out_dir, "elo_dict.json"), "w") as f:
        json.dump(elo_dict, f)

    meta = {
        "type": args.type,
        "input_channels": in_ch,
        "num_moves": len(all_moves),
        "num_elo_buckets": len(elo_dict),
        "opset": args.opset,
    }
    with open(os.path.join(args.out_dir, f"{args.type}_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nDone. Files in {args.out_dir}:")
    for p in sorted(Path(args.out_dir).iterdir()):
        size_mb = p.stat().st_size / 1e6
        print(f"  {p.name:30s}  {size_mb:7.1f} MB")


if __name__ == "__main__":
    main()
