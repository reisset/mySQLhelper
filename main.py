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


class Api:
    """JavaScript API exposed to the webview."""

    def __init__(self):
        self.window = None

    def set_window(self, window):
        self.window = window

    def open_file_dialog(self):
        """Open native file dialog and return selected file path."""
        file_types = (
            'Database files (*.db;*.sqlite;*.sqlite3;*.sql;*.csv)',
            'All files (*.*)'
        )
        result = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=file_types
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def save_file_dialog(self, content, filename):
        """Open native save dialog and write content to the chosen path."""
        result = self.window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=filename
        )
        if result:
            path = result if isinstance(result, str) else result[0]
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False


api = Api()


def main():
    """Launch yourSQLfriend in a native window."""
    window = webview.create_window(
        'yourSQLfriend',
        app,
        width=1400,
        height=900,
        min_size=(1024, 700),
        js_api=api,
        text_select=True
    )
    api.set_window(window)
    webview.start()


if __name__ == '__main__':
    main()
