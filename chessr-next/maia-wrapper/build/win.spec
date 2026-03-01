# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Chessr.io Maia — Windows single-file .exe."""

import sys
from pathlib import Path

block_cipher = None

ROOT = Path(SPECPATH).parent

a = Analysis(
    [str(ROOT / 'launcher.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / 'model.onnx'), '.'),
        (str(ROOT / 'src' / 'move_vocab.json'), 'src'),
        (str(ROOT / 'assets' / 'logo.png'), 'assets'),
    ],
    hiddenimports=[
        'src',
        'src.main',
        'src.engine',
        'src.server',
        'src.tray',
        'src.updater',
        'src.auth',
        'websockets',
        'websockets.legacy',
        'websockets.legacy.server',
        'onnxruntime',
        'chess',
        'webview',
        'webview.platforms',
        'webview.platforms.edgechromium',
        'clr',
        'pythonnet',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'torchaudio', 'rumps', 'pyobjc', 'tkinter', 'matplotlib', 'scipy'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Chessr.io',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ROOT / 'assets' / 'icon.ico'),
)
