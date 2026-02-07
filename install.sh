#!/bin/sh
# yourSQLfriend installer
# Usage: curl -fsSL https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.sh | sh
#
# Environment variables:
#   INSTALL_DIR  - Installation directory (default: $HOME/yourSQLfriend)
#
# Options:
#   --update     - Remove existing installation and re-download

set -e

REPO="reisset/yourSQLfriend"
BRANCH="main"
ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
INSTALL_DIR="${INSTALL_DIR:-$HOME/yourSQLfriend}"

# --- Terminal colors ---
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

info()  { printf "${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$1"; }
warn()  { printf "${YELLOW}Warning:${NC} %s\n" "$1"; }
error() { printf "${RED}Error:${NC} %s\n" "$1" >&2; exit 1; }

# --- Parse arguments ---
UPDATE_MODE=false
for arg in "$@"; do
    case "$arg" in
        --update) UPDATE_MODE=true ;;
        --help|-h)
            printf "Usage: curl -fsSL <url> | sh\n"
            printf "       curl -fsSL <url> | sh -s -- --update\n"
            printf "\nInstalls yourSQLfriend to \$HOME/yourSQLfriend\n"
            printf "Set INSTALL_DIR env var to change location.\n"
            exit 0
            ;;
        *) warn "Unknown argument: $arg" ;;
    esac
done

# --- Prerequisite checks ---
info "Checking prerequisites..."

# Python 3
if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q "Python 3"; then
    PYTHON=python
else
    error "Python 3 is required. Install from https://python.org"
fi

# Python version check (3.10+)
py_minor=$($PYTHON -c "import sys; print(sys.version_info.minor)")
if [ "$py_minor" -lt 10 ] 2>/dev/null; then
    error "Python 3.10+ is required (found $($PYTHON --version 2>&1))"
fi
info "Found $($PYTHON --version 2>&1)"

# Download tool
if command -v curl >/dev/null 2>&1; then
    DOWNLOAD="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOAD="wget"
else
    error "curl or wget is required but neither was found"
fi

# tar
command -v tar >/dev/null 2>&1 || error "tar is required but not found"

# --- Handle existing installation ---
if [ -d "$INSTALL_DIR" ]; then
    if [ "$UPDATE_MODE" = true ]; then
        info "Removing existing installation for update..."
        rm -rf "$INSTALL_DIR"
    else
        warn "Directory already exists: $INSTALL_DIR"
        if [ -f "$INSTALL_DIR/app.py" ]; then
            printf "\n  To update, re-run with --update:\n"
            printf "    curl -fsSL https://raw.githubusercontent.com/%s/main/install.sh | sh -s -- --update\n\n" "$REPO"
            printf "  Or remove it manually:\n"
            printf "    rm -rf %s\n\n" "$INSTALL_DIR"
        fi
        exit 1
    fi
fi

# --- Download and extract ---
info "Downloading yourSQLfriend..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

ARCHIVE="$TMPDIR/yourSQLfriend.tar.gz"

if [ "$DOWNLOAD" = "curl" ]; then
    curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE"
else
    wget -q "$ARCHIVE_URL" -O "$ARCHIVE"
fi

info "Extracting to $INSTALL_DIR..."
tar -xzf "$ARCHIVE" -C "$TMPDIR"
mv "$TMPDIR/yourSQLfriend-${BRANCH}" "$INSTALL_DIR"

chmod +x "$INSTALL_DIR/run.sh"

# --- Success ---
printf "\n"
printf "${GREEN}============================================${NC}\n"
printf "${GREEN}  yourSQLfriend installed successfully!     ${NC}\n"
printf "${GREEN}============================================${NC}\n"
printf "\n"
printf "  To get started:\n"
printf "\n"
printf "    ${BOLD}cd %s${NC}\n" "$INSTALL_DIR"
printf "    ${BOLD}./run.sh${NC}\n"
printf "\n"
printf "  This will set up a Python venv, install\n"
printf "  dependencies, and open the app in your browser.\n"
printf "\n"
printf "  You also need a local LLM running (Ollama or LM Studio).\n"
printf "  See: https://github.com/%s#llm-setup\n" "$REPO"
printf "\n"
