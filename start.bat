@echo off
chcp 65001 >nul 2>&1
color 0A
title Kinoteka Server
cls

echo.
echo ===============================================================
echo                KINOTEKA - SERVER START
echo ===============================================================
echo.
echo [INIT] System initialization...
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found
    echo [INFO] Install from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js................[FOUND]
timeout /t 1 /nobreak >nul
echo.

REM Run from the folder this script is in
cd /d "%~dp0"

REM Check server.js
if not exist "server.js" (
    echo [ERROR] server.js not found
    echo [INFO] Run from project root directory
    echo.
    pause
    exit /b 1
)

echo [OK] server.js..............[FOUND]
timeout /t 1 /nobreak >nul
echo.

REM Check node_modules
if not exist "node_modules\" (
    echo [WARN] node_modules not found
    echo [INFO] Installing dependencies...
    echo.
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] Failed to install modules
        echo [INFO] Check internet connection
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Modules installed......[DONE]
    timeout /t 1 /nobreak >nul
    echo.
) else (
    echo [OK] node_modules..........[FOUND]
    timeout /t 1 /nobreak >nul
    echo.
)

REM Start server
echo [START] Starting web server...
start "Kinoteka Server" /MIN cmd /k "node server.js"

REM Wait for server
echo [WAIT] Server initialization...
timeout /t 3 /nobreak >nul

REM Check port
netstat -ano | findstr :3000 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Server running.........[ACTIVE]
    echo [INFO] Port: localhost:3000
) else (
    echo [WARN] Port 3000 not responding
    echo [INFO] Check server window for errors
)
echo.
timeout /t 1 /nobreak >nul

REM Open browser
echo [START] Opening browser...
start http://localhost:3000/
timeout /t 1 /nobreak >nul
echo [OK] Browser opened.........[DONE]
echo.
echo ===============================================================
echo               SYSTEM STARTED SUCCESSFULLY
echo.
echo  URL: http://localhost:3000
echo.
echo  [!] CLOSE THIS WINDOW TO STOP SERVER
echo ===============================================================
echo.
echo Press any key to stop server...
echo.

REM Keep window open
pause >nul

REM Stop server
echo.
echo [STOP] Stopping server...
echo.

REM Close server window (only our server, other Node.js processes are left alone)
taskkill /F /T /FI "WINDOWTITLE eq Kinoteka Server*" >nul 2>&1

timeout /t 1 /nobreak >nul
echo [OK] Server stopped.........[COMPLETE]
echo.
timeout /t 1 /nobreak >nul
