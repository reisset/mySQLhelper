# -*- mode: python ; coding: utf-8 -*-
# Copyright 2025 Reisset
# Licensed under the Apache License, Version 2.0
# See LICENSE file for details

"""
PyInstaller spec file for yourSQLfriend desktop application.

Build commands:
  Linux:   pyinstaller yourSQLfriend.spec
  Windows: pyinstaller yourSQLfriend.spec
"""

import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all data files needed
datas = [
    ('templates', 'templates'),
    ('static', 'static'),
    ('assets', 'assets'),
    ('ascii.txt', '.'),
]

# Hidden imports for Flask, pywebview, and their dependencies
hiddenimports = [
    'flask',
    'flask_session',
    'werkzeug',
    'jinja2',
    'markupsafe',
    'itsdangerous',
    'click',
    'pandas',
    'requests',
    'webview',
    'sqlite3',
    'cachelib',
    'cachelib.file',
]

# Platform-specific hidden imports for pywebview
if sys.platform == 'win32':
    hiddenimports.extend([
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'clr',
        'pythonnet',
    ])
elif sys.platform == 'linux':
    hiddenimports.extend([
        'webview.platforms.gtk',
        'gi',
        'gi.repository.Gtk',
        'gi.repository.Gdk',
        'gi.repository.GLib',
        'gi.repository.WebKit2',
    ])
elif sys.platform == 'darwin':
    hiddenimports.extend([
        'webview.platforms.cocoa',
    ])

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy',
        'scipy',
        'PIL',
        'cv2',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Determine icon based on platform
if sys.platform == 'win32':
    icon_file = 'assets/yourSQLfriend_icon.ico'
else:
    icon_file = 'assets/yourSQLfriend_icon.png'

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='yourSQLfriend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # No console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_file,
)
