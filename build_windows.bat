@echo off
REM Copyright 2025 Reisset
REM Licensed under the Apache License, Version 2.0
REM See LICENSE file for details

REM Build script for yourSQLfriend on Windows

echo ===================================
echo  yourSQLfriend Windows Build Script
echo ===================================
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is required but not found.
    echo Please install Python from https://python.org
    pause
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

REM Build the executable
echo.
echo Building executable...
pyinstaller yourSQLfriend.spec --clean

echo.
echo ===================================
echo  Build complete!
echo ===================================
echo.
echo Output: dist\yourSQLfriend.exe
echo.
echo To run: Double-click dist\yourSQLfriend.exe
echo.
pause
