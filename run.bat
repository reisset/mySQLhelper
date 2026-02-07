@echo off
setlocal

cd /d "%~dp0"

set PORT=%1
if "%PORT%"=="" set PORT=5000

echo ===================================
echo   yourSQLfriend v3.3.0
echo ===================================
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python 3 is required but not found.
    echo Install from https://python.org
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

REM Install/update deps
echo Checking dependencies...
pip install -q -r requirements.txt

echo.
echo Starting yourSQLfriend on http://127.0.0.1:%PORT%
echo Press Ctrl+C to stop
echo.

python app.py --port %PORT%
