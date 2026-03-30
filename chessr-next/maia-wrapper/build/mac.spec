# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Chessr.io Maia — macOS .app bundle (onefile)."""

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
        'src.automove',
        'src.automove_state',
        'src.keybinds',
        'src.overlay',
        'websockets',
        'websockets.legacy',
        'websockets.legacy.server',
        'onnxruntime',
        'psutil',
        'chess',
        'webview',
        'webview.platforms',
        'webview.platforms.cocoa',
        'pyobjc',
        'objc',
        'Foundation',
        'AppKit',
        'WebKit',
        'CoreFoundation',
        'Quartz',
        'Security',
        'UniformTypeIdentifiers',
        'pyautogui',
        'pynput',
        'pynput.keyboard',
        'pynput.keyboard._darwin',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'torchvision', 'torchaudio', 'rumps', 'pystray', 'tkinter', 'matplotlib', 'scipy'],
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
    name='Chessr.io',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ROOT / 'assets' / 'icon.icns'),
)

app = BUNDLE(
    exe,
    name='Chessr.io.app',
    icon=str(ROOT / 'assets' / 'icon.icns'),
    bundle_identifier='io.chessr.maia',
    info_plist={
        'CFBundleShortVersionString': '1.0.0',
        'CFBundleName': 'Chessr.io',
        'NSHighResolutionCapable': True,
    },
)
