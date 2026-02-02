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

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

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
