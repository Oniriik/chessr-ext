"""
Chessr Maia — Entry point.

Launches the tray app with the Maia-2 engine.
"""

import logging
import os
import sys
from pathlib import Path

from .engine import MaiaEngine
from .server import DEFAULT_PORT
from .tray import MaiaTray

LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"


def _get_model_path() -> Path:
    """Resolve the model.onnx path (works both in dev and PyInstaller bundle)."""
    if getattr(sys, "frozen", False):
        # PyInstaller bundle: model is next to the executable
        base = Path(sys._MEIPASS)
    else:
        # Development: model is in project root
        base = Path(__file__).parent.parent

    return base / "model.onnx"


def main():
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    logger = logging.getLogger("maia")

    port = int(os.environ.get("MAIA_PORT", DEFAULT_PORT))
    model_path = os.environ.get("MAIA_MODEL", str(_get_model_path()))

    logger.info(f"Loading Maia-2 model from {model_path}")

    try:
        engine = MaiaEngine(model_path)
    except FileNotFoundError:
        logger.error(
            f"Model not found at {model_path}. "
            "Run 'python -m scripts.export_onnx' first to generate model.onnx"
        )
        sys.exit(1)

    logger.info(f"Model loaded. Starting tray app on port {port}.")
    tray = MaiaTray(engine, port)
    tray.run()


if __name__ == "__main__":
    main()
