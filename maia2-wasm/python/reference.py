"""
Run the official Maia 2 PyTorch model on a given position and print the result.
Useful as a parity reference when checking the JS / ONNX port.

    python reference.py --fen "..." --elo-self 1500 --elo-oppo 1500
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT / "maia2_src"))

import torch  # noqa: E402
from maia2 import model as maia_model_mod  # noqa: E402
from maia2.inference import inference_each, prepare  # noqa: E402

import onnxruntime as ort  # noqa: E402
import numpy as np  # noqa: E402
import chess  # noqa: E402


def run_pytorch(model, fen, elo_self, elo_oppo):
    prepared = prepare()
    return inference_each(model, prepared, fen, elo_self, elo_oppo)


def run_onnx(sess, fen, elo_self, elo_oppo, all_moves, all_moves_dict, elo_dict):
    # Replicate maia2/inference.py:preprocessing
    from maia2.utils import board_to_tensor, map_to_category, mirror_move

    side = fen.split(" ")[1]
    board = chess.Board(fen) if side == "w" else chess.Board(fen).mirror()
    board_t = board_to_tensor(board).unsqueeze(0).numpy()

    elo_s = np.array([map_to_category(elo_self, elo_dict)], dtype=np.int64)
    elo_o = np.array([map_to_category(elo_oppo, elo_dict)], dtype=np.int64)

    legal_mask = np.zeros(len(all_moves), dtype=np.float32)
    for m in board.legal_moves:
        legal_mask[all_moves_dict[m.uci()]] = 1.0

    out = sess.run(None, {
        "boards": board_t.astype(np.float32),
        "elos_self": elo_s,
        "elos_oppo": elo_o,
    })
    logits_maia = out[0][0]
    logits_value = float(out[2][0])

    masked = logits_maia * legal_mask
    # Softmax over the full vector.
    m = masked.max()
    exp = np.exp(masked - m)
    probs = exp / exp.sum()

    move_probs = {}
    legal_idx = np.where(legal_mask > 0)[0]
    rev = {v: k for k, v in all_moves_dict.items()}
    for i in legal_idx:
        uci = rev[int(i)]
        if side == "b":
            uci = mirror_move(uci)
        move_probs[uci] = float(probs[i])
    move_probs = dict(sorted(move_probs.items(), key=lambda kv: kv[1], reverse=True))

    win = max(0.0, min(1.0, logits_value / 2 + 0.5))
    if side == "b":
        win = 1 - win
    return move_probs, win


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fen", required=True)
    ap.add_argument("--elo-self", type=int, default=1500)
    ap.add_argument("--elo-oppo", type=int, default=1500)
    ap.add_argument("--type", choices=["blitz", "rapid"], default="blitz")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--include-onnx", action="store_true",
                    help="Also run the exported (fp32 + int8) ONNX models for diff.")
    args = ap.parse_args()

    print("\n[ PyTorch (.pt) ]")
    model = maia_model_mod.from_pretrained(type=args.type, device="cpu",
                                           save_root=str(ROOT / "models"))
    move_probs, win = run_pytorch(model, args.fen, args.elo_self, args.elo_oppo)
    print(f"  win_prob = {win:.4f}")
    for i, (uci, p) in enumerate(list(move_probs.items())[:args.top]):
        print(f"    {i+1:2d}. {uci:6s}  {p*100:6.2f}%")

    if args.include_onnx:
        from maia2.utils import get_all_possible_moves, create_elo_dict
        all_moves = get_all_possible_moves()
        all_moves_dict = {m: i for i, m in enumerate(all_moves)}
        elo_dict = create_elo_dict()

        for variant in ["onnx", "fp16.onnx", "int8.onnx"]:
            path = str(ROOT / "models" / f"{args.type}_model.{variant}")
            print(f"\n[ ONNX {variant} ]")
            sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            mp, w = run_onnx(sess, args.fen, args.elo_self, args.elo_oppo,
                             all_moves, all_moves_dict, elo_dict)
            print(f"  win_prob = {w:.4f}")
            for i, (uci, p) in enumerate(list(mp.items())[:args.top]):
                print(f"    {i+1:2d}. {uci:6s}  {p*100:6.2f}%")


if __name__ == "__main__":
    main()
