# yourSQLfriend installer for Windows
# Usage: irm https://raw.githubusercontent.com/reisset/yourSQLfriend/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Package = "yoursqlfriend"
$MinPythonMajor = 3
$MinPythonMinor = 10

# --- Helper: run a native executable and return its exit code.
#     We do NOT use 2>&1 here. In PowerShell 5.1, redirecting a native
#     command's stderr with 2>&1 wraps each stderr line in an ErrorRecord
#     (NativeCommandError), which trips $ErrorActionPreference = "Stop"
#     even when the process exits 0. Instead we let stderr flow to the
#     console normally and judge success only by $LASTEXITCODE.
function Invoke-Native {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [switch]$Silent   # suppress both stdout and stderr (use sparingly)
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"   # prevent PS from treating stderr as fatal
    try {
        if ($Silent) {
            & $Exe @Arguments >$null 2>$null
        } else {
            & $Exe @Arguments
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

# --- Find Python 3.10+ ---
Write-Host "==> Checking for Python ${MinPythonMajor}.${MinPythonMinor}+..." -ForegroundColor Green

$Python = $null
foreach ($cmd in @("python3", "python", "py")) {
    try {
        $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        $ver = & $cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        $ErrorActionPreference = $prev
        if ($ver -match "^(\d+)\.(\d+)$") {
            $major = [int]$Matches[1]
            $minor = [int]$Matches[2]
            if ($major -eq $MinPythonMajor -and $minor -ge $MinPythonMinor) {
                $Python = $cmd
                break
            }
        }
    } catch { $ErrorActionPreference = $prev }
}

if (-not $Python) {
    Write-Host "Error: Python ${MinPythonMajor}.${MinPythonMinor}+ is required." -ForegroundColor Red
    Write-Host "  Install from https://python.org or via:"
    Write-Host "    winget install Python.Python.3.12"
    exit 1
}

$prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$pyVer = & $Python --version 2>&1   # --version prints to stdout on 3.x; 2>&1 is safe here (no loop, no Stop)
$ErrorActionPreference = $prev
Write-Host "==> Found $pyVer" -ForegroundColor Green

# --- Locate the Python user Scripts dir (where pip --user puts pipx.exe) ---
$prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$userScripts = & $Python -c "import site; print(site.getusersitepackages())" 2>$null
$ErrorActionPreference = $prev
if ($userScripts) {
    # getusersitepackages() → ...Python\Python3x\site-packages; Scripts is two levels up
    $userScripts = Split-Path (Split-Path $userScripts -Parent) -Parent
    $userScripts = Join-Path $userScripts "Scripts"
}

# --- Install pipx if needed ---
$pipxAvailable = (Invoke-Native -Exe $Python -Arguments @("-m", "pipx", "--version") -Silent) -eq 0

if (-not $pipxAvailable) {
    Write-Host "==> Installing pipx..." -ForegroundColor Green

    # pip install: let stderr flow to console so the user sees real errors;
    # judge success by exit code only — harmless pip warnings must not abort us.
    $rc = Invoke-Native -Exe $Python -Arguments @("-m", "pip", "install", "--user", "--upgrade", "pipx")
    if ($rc -ne 0) {
        Write-Host "Error: Could not install pipx (pip exited $rc)." -ForegroundColor Red
        Write-Host "  Install manually: https://pipx.pypa.io/stable/installation/"
        exit 1
    }

    # Best-effort: register pipx's bin dir in the persistent User PATH for future terminals.
    Invoke-Native -Exe $Python -Arguments @("-m", "pipx", "ensurepath") -Silent | Out-Null

    # Refresh PATH for this session from the registry, then also add the user Scripts dir.
    $machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $env:PATH    = ($machinePath + ";" + $userPath).TrimStart(";")
    if ($userScripts -and (Test-Path $userScripts)) {
        $env:PATH = "$userScripts;$env:PATH"
    }
    # Also add ~/.local/bin in case ensurepath put pipx there
    $localBin = Join-Path $HOME ".local\bin"
    if (Test-Path $localBin) { $env:PATH = "$localBin;$env:PATH" }
}

# Report the pipx version we'll use (module form is always available even if .exe isn't on PATH yet)
$prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$pipxVer = & $Python -m pipx --version 2>$null
$ErrorActionPreference = $prev
Write-Host "==> Using pipx $pipxVer" -ForegroundColor Green

# --- Install yoursqlfriend ---
# Always use the module form so we don't depend on pipx.exe landing on the
# session PATH — it may only appear after the user reopens their terminal.
Write-Host "==> Installing $Package..." -ForegroundColor Green

$rc = Invoke-Native -Exe $Python -Arguments @("-m", "pipx", "install", $Package)
if ($rc -ne 0) {
    # Already installed? try --force (same as install.sh behaviour)
    Write-Host "    Retrying with --force (already installed or conflict)..." -ForegroundColor Yellow
    $rc = Invoke-Native -Exe $Python -Arguments @("-m", "pipx", "install", $Package, "--force")
}
if ($rc -ne 0) {
    Write-Host "Error: Failed to install $Package (exit $rc)." -ForegroundColor Red
    Write-Host "  Try manually: python -m pipx install $Package"
    exit 1
}

# --- Verify the launcher is reachable ---
$launcherFound = $false
try {
    $found = Get-Command yoursqlfriend -ErrorAction SilentlyContinue
    if ($found) { $launcherFound = $true }
} catch {}
if (-not $launcherFound) {
    # The exe may live in the pipx venv bin — check via module listing as fallback
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $pipxList = & $Python -m pipx list 2>$null
    $ErrorActionPreference = $prev
    if ($pipxList -match $Package) { $launcherFound = $true }
}

# --- Success ---
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  yourSQLfriend installed successfully!     " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

if ($launcherFound) {
    Write-Host "  Type 'yoursqlfriend' to launch the app."
} else {
    Write-Host "  Close and reopen your terminal so the PATH update takes effect,"
    Write-Host "  then type:" -ForegroundColor Yellow
    Write-Host "    yoursqlfriend" -ForegroundColor White
}

Write-Host ""
Write-Host "  Options:"
Write-Host "    yoursqlfriend                    # default (port 5000)"
Write-Host "    yoursqlfriend --port 8080        # custom port"
Write-Host "    yoursqlfriend --no-browser       # don't auto-open browser"
Write-Host ""
Write-Host "  You also need a local LLM running (Ollama or LM Studio)."
Write-Host "  See: https://github.com/reisset/yourSQLfriend#llm-setup"
Write-Host ""
