"""
Quantize the exported Maia 2 ONNX model to int8 for the web.

Uses dynamic quantization (no calibration data needed). For Maia 2's
mostly-Linear/Conv arch, dynamic int8 keeps move-distribution accuracy
near identical while shrinking the file ~3-4x.
"""

import argparse
import os
from pathlib import Path

from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process

ROOT = Path(__file__).parent.resolve()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["blitz", "rapid"], default="blitz")
    ap.add_argument("--models-dir", default=str(ROOT / "models"))
    args = ap.parse_args()

    src = os.path.join(args.models_dir, f"{args.type}_model.onnx")
    pre = os.path.join(args.models_dir, f"{args.type}_model.preproc.onnx")
    dst = os.path.join(args.models_dir, f"{args.type}_model.int8.onnx")
    if not os.path.exists(src):
        raise SystemExit(f"missing input: {src}")

    print(f"Pre-processing (shape inference + symbolic-shape) {src} → {pre}")
    quant_pre_process(
        input_model_path=src,
        output_model_path=pre,
        skip_symbolic_shape=False,
        skip_optimization=False,
        skip_onnx_shape=False,
    )

    print(f"Quantizing {pre} → {dst} (dynamic int8)")
    quantize_dynamic(
        model_input=pre,
        model_output=dst,
        weight_type=QuantType.QInt8,
        per_channel=True,
        reduce_range=False,
    )

    # Compare model + parity sanity-check.
    src_size = os.path.getsize(src) / 1e6
    # External data file may or may not exist depending on export.
    src_ext = src + ".data"
    if os.path.exists(src_ext):
        src_size += os.path.getsize(src_ext) / 1e6
    dst_size = os.path.getsize(dst) / 1e6
    dst_ext = dst + ".data"
    if os.path.exists(dst_ext):
        dst_size += os.path.getsize(dst_ext) / 1e6
    print(f"  fp32: {src_size:7.2f} MB")
    print(f"  int8: {dst_size:7.2f} MB   ({dst_size/src_size*100:.1f}%)")

    # Quick parity check.
    import onnxruntime as ort
    import numpy as np

    sess_fp = ort.InferenceSession(src, providers=["CPUExecutionProvider"])
    sess_q  = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])

    np.random.seed(42)
    boards = np.random.rand(1, 18, 8, 8).astype(np.float32)
    elos_self = np.array([5], dtype=np.int64)
    elos_oppo = np.array([5], dtype=np.int64)
    feed = {"boards": boards, "elos_self": elos_self, "elos_oppo": elos_oppo}

    out_fp = sess_fp.run(None, feed)
    out_q  = sess_q.run(None, feed)

    print("\nParity check (fp32 vs int8 on random input):")
    for i, (a, b) in enumerate(zip(out_fp, out_q)):
        diff = float(np.abs(a - b).max())
        # Rank-correlation on logits_maia (output 0): cares about ordering, not magnitudes.
        if i == 0:
            order_fp = np.argsort(-a[0])[:10]
            order_q  = np.argsort(-b[0])[:10]
            overlap = len(set(order_fp.tolist()) & set(order_q.tolist()))
            print(f"  output[{i}] max_abs_diff = {diff:.3e}  top10_overlap = {overlap}/10")
        else:
            print(f"  output[{i}] max_abs_diff = {diff:.3e}")


if __name__ == "__main__":
    main()
