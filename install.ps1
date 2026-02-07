# yourSQLfriend installer for Windows
# Usage: irm https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.ps1 | iex
#
# Environment variables:
#   INSTALL_DIR  - Installation directory (default: $HOME\yourSQLfriend)

$ErrorActionPreference = "Stop"

$Repo = "reisset/yourSQLfriend"
$Branch = "main"
$ArchiveUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME "yourSQLfriend" }

# --- Prerequisite checks ---
Write-Host "==> Checking prerequisites..." -ForegroundColor Green

# Python 3
$Python = $null
try {
    $ver = & python3 --version 2>&1
    if ($ver -match "Python 3") { $Python = "python3" }
} catch {}

if (-not $Python) {
    try {
        $ver = & python --version 2>&1
        if ($ver -match "Python 3") { $Python = "python" }
    } catch {}
}

if (-not $Python) {
    Write-Host "Error: Python 3 is required. Install from https://python.org" -ForegroundColor Red
    exit 1
}

# Python version check (3.10+)
$pyMinor = & $Python -c "import sys; print(sys.version_info.minor)" 2>&1
if ([int]$pyMinor -lt 10) {
    Write-Host "Error: Python 3.10+ is required (found $(& $Python --version 2>&1))" -ForegroundColor Red
    exit 1
}
Write-Host "==> Found $(& $Python --version 2>&1)" -ForegroundColor Green

# --- Handle existing installation ---
if (Test-Path $InstallDir) {
    Write-Host "Warning: Directory already exists: $InstallDir" -ForegroundColor Yellow
    if (Test-Path (Join-Path $InstallDir "app.py")) {
        Write-Host ""
        Write-Host "  To update, remove the directory first:" -ForegroundColor Yellow
        Write-Host "    Remove-Item -Recurse -Force '$InstallDir'"
        Write-Host "  Then re-run this installer."
        Write-Host ""
    }
    exit 1
}

# --- Download and extract ---
Write-Host "==> Downloading yourSQLfriend..." -ForegroundColor Green

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "yourSQLfriend-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $Archive = Join-Path $TmpDir "yourSQLfriend.zip"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ArchiveUrl -OutFile $Archive -UseBasicParsing

    Write-Host "==> Extracting to $InstallDir..." -ForegroundColor Green
    Expand-Archive -Path $Archive -DestinationPath $TmpDir -Force

    $ExtractedDir = Join-Path $TmpDir "yourSQLfriend-$Branch"
    Move-Item -Path $ExtractedDir -Destination $InstallDir
} finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}

# --- Success ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  yourSQLfriend installed successfully!     " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To get started:"
Write-Host ""
Write-Host "    cd $InstallDir" -ForegroundColor White
Write-Host "    .\run.bat" -ForegroundColor White
Write-Host ""
Write-Host "  This will set up a Python venv, install"
Write-Host "  dependencies, and open the app in your browser."
Write-Host ""
Write-Host "  You also need a local LLM running (Ollama or LM Studio)."
Write-Host "  See: https://github.com/$Repo#llm-setup"
Write-Host ""
