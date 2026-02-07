#!/bin/bash
# Copyright 2025 Reisset
# Licensed under the Apache License, Version 2.0
# See LICENSE file for details

# Build script for yourSQLfriend on Linux

set -e

echo "==================================="
echo " yourSQLfriend Linux Build Script"
echo "==================================="
echo ""

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found."
    exit 1
fi

# Create virtual environment with system-site-packages access
# (Required for gi/PyGObject which must come from system packages)
if [ -d "venv" ]; then
    if ! grep -qi "include-system-site-packages = true" venv/pyvenv.cfg 2>/dev/null; then
        echo "Existing venv missing system-site-packages. Recreating..."
        rm -rf venv
    fi
fi

if [ ! -d "venv" ]; then
    echo "Creating virtual environment with --system-site-packages..."
    python3 -m venv --system-site-packages venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Verify gi (PyGObject) is accessible
if ! python3 -c "import gi" 2>/dev/null; then
    echo ""
    echo "Error: PyGObject (gi) not found. Install it with:"
    echo "  Ubuntu/Debian: sudo apt install python3-gi python3-gi-cairo gir1.2-webkit2-4.1"
    echo "  Fedora:        sudo dnf install python3-gobject webkit2gtk4.1"
    echo "  Arch:          sudo pacman -S python-gobject webkit2gtk-4.1"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Build the executable
echo ""
echo "Building executable..."
pyinstaller yourSQLfriend.spec --clean

echo ""
echo "==================================="
echo " Build complete!"
echo "==================================="
echo ""
echo "Output: dist/yourSQLfriend"
echo ""
echo "To run: ./dist/yourSQLfriend"
echo ""
echo "Note: Users need WebKitGTK installed:"
echo "  Ubuntu/Debian: sudo apt install gir1.2-webkit2-4.1"
echo "  Fedora:        sudo dnf install webkit2gtk4.1"
echo "  Arch:          sudo pacman -S webkit2gtk-4.1"
echo ""
