"""
Chessr Maia — Entry point.

Launches the tray app with the Maia-2 engine.
"""

import logging
import os
import sys
from pathlib import Path

from .server import DEFAULT_PORT
from .tray import MaiaTray, load_config

LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"


def _get_model_path() -> Path:
    """Resolve the model.onnx path (works both in dev and PyInstaller bundle)."""
    if getattr(sys, "frozen", False):
        # PyInstaller bundle: try _MEIPASS first, then next to executable
        candidates = [
            Path(sys._MEIPASS) / "model.onnx",
            Path(sys.executable).parent / "model.onnx",
            Path(sys.executable).parent.parent / "Resources" / "model.onnx",
        ]
        for p in candidates:
            if p.exists():
                return p
        return candidates[0]  # fallback for error message
    else:
        # Development: model is in project root
        return Path(__file__).parent.parent / "model.onnx"


def main():
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    logger = logging.getLogger("maia")

    port = int(os.environ.get("MAIA_PORT", DEFAULT_PORT))
    model_path = os.environ.get("MAIA_MODEL", str(_get_model_path()))

    if getattr(sys, "frozen", False):
        logger.info(f"Frozen mode: _MEIPASS={sys._MEIPASS}, executable={sys.executable}")
    logger.info(f"Starting Chessr Maia (model: {model_path})")

    config = load_config()
    tray = MaiaTray(model_path=model_path, port=port, engine_config=config)
    tray.run()


if __name__ == "__main__":
    main()
