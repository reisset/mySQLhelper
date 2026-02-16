#!/bin/sh
# yourSQLfriend installer
# Usage: curl -fsSL https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.sh | sh
#
# Options:
#   --update     Upgrade to latest version

set -e

PACKAGE="yoursqlfriend"
MIN_PYTHON_MAJOR=3
MIN_PYTHON_MINOR=10

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
            printf "\nInstalls yourSQLfriend via pipx.\n"
            printf "Requires Python %s.%s+\n" "$MIN_PYTHON_MAJOR" "$MIN_PYTHON_MINOR"
            exit 0
            ;;
        *) warn "Unknown argument: $arg" ;;
    esac
done

# --- Find Python 3.10+ ---
info "Checking for Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+..."

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
        py_version=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null) || continue
        py_major=$(echo "$py_version" | cut -d. -f1)
        py_minor=$(echo "$py_version" | cut -d. -f2)
        if [ "$py_major" -eq "$MIN_PYTHON_MAJOR" ] && [ "$py_minor" -ge "$MIN_PYTHON_MINOR" ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    error "Python ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}+ is required but not found.
  Install from https://python.org or your system package manager:
    Ubuntu/Debian: sudo apt install python3
    Fedora:        sudo dnf install python3
    Arch:          sudo pacman -S python
    macOS:         brew install python3"
fi

info "Found $($PYTHON --version 2>&1)"

# --- Install pipx if needed ---
if ! command -v pipx >/dev/null 2>&1; then
    info "Installing pipx..."

    if "$PYTHON" -m pip install --user pipx 2>/dev/null; then
        "$PYTHON" -m pipx ensurepath 2>/dev/null || true
    elif command -v apt >/dev/null 2>&1; then
        warn "pip install failed, trying apt..."
        sudo apt install -y pipx 2>/dev/null || error "Could not install pipx. Install it manually: https://pipx.pypa.io/stable/installation/"
    elif command -v dnf >/dev/null 2>&1; then
        warn "pip install failed, trying dnf..."
        sudo dnf install -y pipx 2>/dev/null || error "Could not install pipx. Install it manually."
    elif command -v pacman >/dev/null 2>&1; then
        warn "pip install failed, trying pacman..."
        sudo pacman -S --noconfirm python-pipx 2>/dev/null || error "Could not install pipx. Install it manually."
    elif command -v brew >/dev/null 2>&1; then
        warn "pip install failed, trying brew..."
        brew install pipx 2>/dev/null || error "Could not install pipx. Install it manually."
    else
        error "Could not install pipx. Install it manually:
  https://pipx.pypa.io/stable/installation/"
    fi

    # Add pipx bin dir to PATH for this session
    export PATH="$HOME/.local/bin:$PATH"

    if ! command -v pipx >/dev/null 2>&1; then
        if "$PYTHON" -m pipx --version >/dev/null 2>&1; then
            # pipx works as a module — create alias for this session
            pipx() { "$PYTHON" -m pipx "$@"; }
        else
            error "pipx installed but not found on PATH.
  Close and reopen your terminal, then run:
    pipx install $PACKAGE"
        fi
    fi
fi

info "Using pipx $(pipx --version 2>&1)"

# --- Install or upgrade yoursqlfriend ---
if [ "$UPDATE_MODE" = true ]; then
    info "Upgrading $PACKAGE..."
    pipx upgrade "$PACKAGE" 2>/dev/null || pipx install "$PACKAGE" --force
else
    info "Installing $PACKAGE..."
    pipx install "$PACKAGE" 2>/dev/null || pipx upgrade "$PACKAGE"
fi

# --- Verify installation ---
if command -v yoursqlfriend >/dev/null 2>&1; then
    printf "\n"
    printf "${GREEN}============================================${NC}\n"
    printf "${GREEN}  yourSQLfriend installed successfully!     ${NC}\n"
    printf "${GREEN}============================================${NC}\n"
    printf "\n"
    printf "  Type ${BOLD}yoursqlfriend${NC} to launch the app.\n"
    printf "\n"
    printf "  Options:\n"
    printf "    yoursqlfriend                    # default (port 5000)\n"
    printf "    yoursqlfriend --port 8080        # custom port\n"
    printf "    yoursqlfriend --no-browser       # don't auto-open browser\n"
    printf "\n"
    printf "  You also need a local LLM running (Ollama or LM Studio).\n"
    printf "  See: https://github.com/reisset/yourSQLfriend#llm-setup\n"
    printf "\n"
else
    warn "Installation completed but 'yoursqlfriend' not found on PATH."
    printf "  You may need to restart your terminal or run:\n"
    printf "    pipx ensurepath\n"
    printf "  Then try: yoursqlfriend\n"
fi
