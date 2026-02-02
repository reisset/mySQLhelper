# Copyright 2025 Reisset
# Licensed under the Apache License, Version 2.0
# See LICENSE file for details

"""
yourSQLfriend Desktop Application

This is the entry point for running yourSQLfriend as a standalone
desktop application using pywebview.
"""

import webview
from app import app

def main():
    """Launch yourSQLfriend in a native window."""
    window = webview.create_window(
        'yourSQLfriend',
        app,
        width=1400,
        height=900,
        min_size=(1024, 700)
    )
    webview.start()

if __name__ == '__main__':
    main()
