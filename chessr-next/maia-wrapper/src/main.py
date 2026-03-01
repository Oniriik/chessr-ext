"""
Chessr Maia — Entry point.

Launches the tray app with the Maia-2 engine.
"""

import logging
import os
import sys
from pathlib import Path

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

    logger.info(f"Starting Chessr Maia (model: {model_path})")

    tray = MaiaTray(model_path=model_path, port=port)
    tray.run()


if __name__ == "__main__":
    main()
