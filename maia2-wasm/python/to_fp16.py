"""
Convert fp32 ONNX model to fp16. Halves the file size with negligible accuracy loss.
"""

import argparse
import os
from pathlib import Path

import onnx
from onnxconverter_common import float16

ROOT = Path(__file__).parent.resolve()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["blitz", "rapid"], default="blitz")
    ap.add_argument("--models-dir", default=str(ROOT / "models"))
    args = ap.parse_args()

    src = os.path.join(args.models_dir, f"{args.type}_model.onnx")
    dst = os.path.join(args.models_dir, f"{args.type}_model.fp16.onnx")
    if not os.path.exists(src):
        raise SystemExit(f"missing input: {src}")

    print(f"Converting {src} → {dst} (fp16)")
    model = onnx.load(src)
    # keep_io_types preserves fp32 inputs/outputs (avoids JS-side conversion).
    model_fp16 = float16.convert_float_to_float16(model, keep_io_types=True)
    onnx.save(model_fp16, dst)

    src_size = os.path.getsize(src) / 1e6
    dst_size = os.path.getsize(dst) / 1e6
    print(f"  fp32: {src_size:7.2f} MB")
    print(f"  fp16: {dst_size:7.2f} MB   ({dst_size/src_size*100:.1f}%)")

    import onnxruntime as ort
    import numpy as np

    sess_fp = ort.InferenceSession(src, providers=["CPUExecutionProvider"])
    sess_h  = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])

    np.random.seed(42)
    boards = np.random.rand(1, 18, 8, 8).astype(np.float32)
    elos_self = np.array([5], dtype=np.int64)
    elos_oppo = np.array([5], dtype=np.int64)
    feed = {"boards": boards, "elos_self": elos_self, "elos_oppo": elos_oppo}

    out_fp = sess_fp.run(None, feed)
    out_h  = sess_h.run(None, feed)

    print("\nParity check (fp32 vs fp16 on random input):")
    for i, (a, b) in enumerate(zip(out_fp, out_h)):
        diff = float(np.abs(a - b).max())
        if i == 0:
            order_fp = np.argsort(-a[0])[:10]
            order_h  = np.argsort(-b[0])[:10]
            overlap = len(set(order_fp.tolist()) & set(order_h.tolist()))
            print(f"  output[{i}] max_abs_diff = {diff:.3e}  top10_overlap = {overlap}/10")
        else:
            print(f"  output[{i}] max_abs_diff = {diff:.3e}")


if __name__ == "__main__":
    main()
