@echo off
setlocal
chcp 65001 >nul 2>&1
title KinoTeka
cd /d "%~dp0"

REM Node.js: bundled one from the release zip (node\node.exe) or the installed one
set "NODE_EXE=node"
if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found.
    echo.
    echo Download the ready-to-run version for Windows:
    echo   https://github.com/FLEXIY0/KinoTeka-watchlist/releases/latest
    echo or install Node.js LTS from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies, please wait...
    call npm install --omit=dev --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
)

REM The launcher shows server status and opens the app in the browser.
REM Keys: O - open, R - restart, Q - quit.
"%NODE_EXE%" scripts\app_launcher.js %*
if errorlevel 1 pause
endlocal
