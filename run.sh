#!/bin/bash
# yourSQLfriend Launcher — Linux/macOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${1:-5000}"

# Display ASCII art if terminal is wide enough
if [ -f ascii.txt ] && [ "$(tput cols 2>/dev/null || echo 80)" -ge 145 ]; then
    cat ascii.txt
    echo ""
fi

echo "==================================="
echo "  yourSQLfriend v3.4.1"
echo "==================================="
echo ""

# Check for Python 3
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null && python --version 2>&1 | grep -q "Python 3"; then
    PYTHON=python
else
    echo "Error: Python 3 is required but not found."
    echo "Install from https://python.org or your system package manager."
    exit 1
fi

echo "Using: $($PYTHON --version)"

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    $PYTHON -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install/update deps (quiet if already satisfied)
echo "Checking dependencies..."
pip install -q -r requirements.txt

echo ""
echo "Starting yourSQLfriend on http://127.0.0.1:$PORT"
echo "Press Ctrl+C to stop"
echo ""

# Run with auto-browser-open; clean shutdown on Ctrl+C
trap 'echo ""; echo "Server stopped."; exit 0' INT TERM
python app.py --port "$PORT"
