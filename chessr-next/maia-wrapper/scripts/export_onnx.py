"""
Export Maia-2 PyTorch model to ONNX format.

Usage:
    pip install torch maia2
    python -m scripts.export_onnx

This only needs to be run once to generate model.onnx.
The resulting ONNX file is then bundled into the app.
"""

import sys
from pathlib import Path

import torch


def export():
    from maia2 import model as maia_model

    print("Loading Maia-2 pretrained model (rapid)...")
    m = maia_model.from_pretrained(type="rapid", device="cpu")
    m.eval()

    print("Preparing dummy inputs...")
    dummy_boards = torch.randn(1, 18, 8, 8)
    dummy_elo_self = torch.tensor([5], dtype=torch.long)  # category index
    dummy_elo_oppo = torch.tensor([5], dtype=torch.long)

    output_path = Path(__file__).parent.parent / "model.onnx"

    print(f"Exporting to {output_path}...")
    # Use dynamo=False to force legacy TorchScript-based export
    # which properly embeds weights into the ONNX file
    torch.onnx.export(
        m,
        (dummy_boards, dummy_elo_self, dummy_elo_oppo),
        str(output_path),
        input_names=["boards", "elos_self", "elos_oppo"],
        output_names=["logits_maia", "logits_side_info", "logits_value"],
        dynamic_axes={
            "boards": {0: "batch"},
            "elos_self": {0: "batch"},
            "elos_oppo": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Done! Model exported to {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    export()
