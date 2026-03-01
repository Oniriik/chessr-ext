"""
Auto-update checker for Chessr Maia.

Checks download.chessr.io for new versions on startup.
"""

import logging
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

import requests

from . import __version__

logger = logging.getLogger("maia-updater")

UPDATE_URL = "https://download.chessr.io/maia/latest.json"
CHECK_TIMEOUT = 5  # seconds


def check_for_update() -> dict | None:
    """Check if a newer version is available.

    Returns:
        dict with {version, download_url} if update available, None otherwise.
    """
    try:
        resp = requests.get(UPDATE_URL, timeout=CHECK_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        latest = data.get("version", "0.0.0")
        if _is_newer(latest, __version__):
            system = platform.system().lower()
            url_key = "mac" if system == "darwin" else "win"
            download_url = data.get(url_key)
            if download_url:
                return {"version": latest, "download_url": download_url}

    except Exception as e:
        logger.debug(f"Update check failed: {e}")

    return None


def download_and_open(url: str):
    """Download the update file and open it."""
    try:
        suffix = ".dmg" if platform.system() == "Darwin" else ".exe"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp_path = Path(tmp.name)

        logger.info(f"Downloading update from {url}")
        resp = requests.get(url, stream=True, timeout=60)
        resp.raise_for_status()

        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        logger.info(f"Update downloaded to {tmp_path}")

        # Open the installer
        if platform.system() == "Darwin":
            subprocess.Popen(["open", str(tmp_path)])
        else:
            subprocess.Popen([str(tmp_path)], shell=True)

    except Exception as e:
        logger.exception(f"Failed to download update: {e}")
        raise


def _is_newer(remote: str, local: str) -> bool:
    """Compare semantic version strings."""
    def parse(v):
        return tuple(int(x) for x in v.strip().split("."))
    try:
        return parse(remote) > parse(local)
    except (ValueError, AttributeError):
        return False
