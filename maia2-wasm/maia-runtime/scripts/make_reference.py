#!/usr/bin/env python3
"""
Generate reference outputs from PyTorch for the custom-runtime parity test.

For each FEN position, runs the official Maia 2 PyTorch model and records:
  - top-3 logit indices (in the all_moves space, 1880 entries)
  - winProb (raw model value, before sigmoid clamp)

The custom WASM runtime must reproduce these (top-3 set + value within 0.05).

Usage:
    cd maia2-wasm/python
    .venv/bin/python ../maia-runtime/scripts/make_reference.py \
        --checkpoint models/blitz_model.pt \
        --out ../maia-runtime/tests/reference.json \
        --positions 50
"""

import argparse
import json
import sys
from pathlib import Path

import torch
import chess
import numpy as np

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT.parent.parent / "python" / "maia2_src"))

from maia2 import model as maia_model_mod
from maia2.utils import board_to_tensor, get_all_possible_moves, create_elo_dict, map_to_category

DEFAULT_FENS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 5 4",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    "8/8/4k3/8/4K3/8/4P3/8 w - - 0 1",
    "rnbqkb1r/pp3ppp/2p1pn2/3p4/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 5",
    "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 8",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--positions", type=int, default=10,
                    help="Use first N positions from a built-in test set.")
    args = ap.parse_args()

    print(f"Loading {args.checkpoint}…")
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    state_dict = ckpt.get("model_state_dict", ckpt)
    if any(k.startswith("module.") for k in state_dict):
        state_dict = {k.removeprefix("module."): v for k, v in state_dict.items()}

    # Build fresh MAIA2Model with default cfg (matches what's in checkpoint)
    from maia2.utils import parse_args
    cfg_path = Path(args.checkpoint).parent / "config.yaml"
    cfg = parse_args(str(cfg_path))
    all_moves = get_all_possible_moves()
    elo_dict = create_elo_dict()
    model = maia_model_mod.MAIA2Model(len(all_moves), elo_dict, cfg)
    model.load_state_dict(state_dict)
    model.eval()

    fens = DEFAULT_FENS[:args.positions]
    cases = []
    with torch.no_grad():
        for fen in fens:
            side = fen.split()[1]
            board = chess.Board(fen) if side == "w" else chess.Board(fen).mirror()
            board_t = board_to_tensor(board).unsqueeze(0)
            elo_self = torch.tensor([map_to_category(1500, elo_dict)])
            elo_oppo = torch.tensor([map_to_category(1500, elo_dict)])
            logits, _, value = model(board_t, elo_self, elo_oppo)
            logits = logits[0].numpy()
            top3 = np.argsort(-logits)[:3].tolist()
            cases.append({
                "fen": fen,
                "eloSelf": int(map_to_category(1500, elo_dict)),
                "eloOppo": int(map_to_category(1500, elo_dict)),
                "top3_indices": [int(x) for x in top3],
                "value": float(value.item()),
            })
            print(f"  {fen[:32]}…  top3={top3[:3]}  value={value.item():.4f}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump({"cases": cases}, f, indent=2)
    print(f"\n✓ Wrote {len(cases)} reference cases to {args.out}")


if __name__ == "__main__":
    main()
