@echo off
REM yourSQLfriend Dev Launcher — for local development from git clone
REM End users: install via 'pipx install yoursqlfriend' instead.

setlocal

cd /d "%~dp0"

set PORT=%1
if "%PORT%"=="" set PORT=5000

echo ===================================
echo   yourSQLfriend (dev mode)
echo ===================================
echo.

REM Check for Python 3
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python 3 is required but not found.
    echo Install from https://python.org
    pause
    exit /b 1
)
REM Enforce the same 3.10+ minimum as pyproject.toml / install.ps1 —
REM otherwise pip fails later with a confusing requires-python error.
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
    for /f "tokens=2" %%V in ('python --version 2^>^&1') do set PYVER=%%V
    echo Error: Python 3.10 or newer is required but found Python %PYVER%
    echo Install a current Python 3 from https://python.org
    pause
    exit /b 1
)

REM Create venv if needed
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate venv
call venv\Scripts\activate.bat

REM Install in editable mode (development)
echo Checking dependencies...
pip install -q -e .

echo.
echo Starting yourSQLfriend on http://127.0.0.1:%PORT%
echo Press Ctrl+C to stop
echo.

python -m yoursqlfriend.app --port %PORT%
