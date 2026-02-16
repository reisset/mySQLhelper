# yourSQLfriend installer for Windows
# Usage: irm https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Package = "yoursqlfriend"
$MinPythonMajor = 3
$MinPythonMinor = 10

# --- Find Python 3.10+ ---
Write-Host "==> Checking for Python ${MinPythonMajor}.${MinPythonMinor}+..." -ForegroundColor Green

$Python = $null
foreach ($cmd in @("python3", "python", "py")) {
    try {
        $ver = & $cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1
        if ($ver -match "^(\d+)\.(\d+)$") {
            $major = [int]$Matches[1]
            $minor = [int]$Matches[2]
            if ($major -eq $MinPythonMajor -and $minor -ge $MinPythonMinor) {
                $Python = $cmd
                break
            }
        }
    } catch {}
}

if (-not $Python) {
    Write-Host "Error: Python ${MinPythonMajor}.${MinPythonMinor}+ is required." -ForegroundColor Red
    Write-Host "  Install from https://python.org or via:"
    Write-Host "    winget install Python.Python.3.12"
    exit 1
}

Write-Host "==> Found $(& $Python --version 2>&1)" -ForegroundColor Green

# --- Install pipx if needed ---
$pipxAvailable = $false
try { pipx --version 2>&1 | Out-Null; $pipxAvailable = $true } catch {}

if (-not $pipxAvailable) {
    Write-Host "==> Installing pipx..." -ForegroundColor Green

    try {
        & $Python -m pip install --user pipx 2>&1 | Out-Null
        & $Python -m pipx ensurepath 2>&1 | Out-Null
    } catch {
        Write-Host "Error: Could not install pipx." -ForegroundColor Red
        Write-Host "  Install manually: https://pipx.pypa.io/stable/installation/"
        exit 1
    }

    # Refresh PATH for this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "User") + ";" + $env:PATH

    # Verify pipx is available
    try { pipx --version 2>&1 | Out-Null; $pipxAvailable = $true } catch {}

    if (-not $pipxAvailable) {
        try {
            & $Python -m pipx --version 2>&1 | Out-Null
            # Use module form for install
            Write-Host "==> Installing $Package..." -ForegroundColor Green
            & $Python -m pipx install $Package
            Write-Host ""
            Write-Host "============================================" -ForegroundColor Green
            Write-Host "  yourSQLfriend installed successfully!     " -ForegroundColor Green
            Write-Host "============================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "  Close and reopen your terminal, then type:"
            Write-Host "    yoursqlfriend" -ForegroundColor White
            exit 0
        } catch {
            Write-Host "Error: pipx installed but not available." -ForegroundColor Red
            Write-Host "  Close and reopen your terminal, then run:"
            Write-Host "    pipx install $Package"
            exit 1
        }
    }
}

Write-Host "==> Using pipx $(pipx --version 2>&1)" -ForegroundColor Green

# --- Install yoursqlfriend ---
Write-Host "==> Installing $Package..." -ForegroundColor Green

try {
    pipx install $Package 2>&1
} catch {
    try {
        pipx upgrade $Package 2>&1
    } catch {
        Write-Host "Error: Failed to install $Package" -ForegroundColor Red
        exit 1
    }
}

# --- Success ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  yourSQLfriend installed successfully!     " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Type 'yoursqlfriend' to launch the app."
Write-Host ""
Write-Host "  Options:"
Write-Host "    yoursqlfriend                    # default (port 5000)"
Write-Host "    yoursqlfriend --port 8080        # custom port"
Write-Host "    yoursqlfriend --no-browser       # don't auto-open browser"
Write-Host ""
Write-Host "  You also need a local LLM running (Ollama or LM Studio)."
Write-Host "  See: https://github.com/reisset/yourSQLfriend#llm-setup"
Write-Host ""
