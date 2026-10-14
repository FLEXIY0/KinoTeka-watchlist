@echo off
chcp 65001 >nul
title Менеджер Фильмов и Сериалов

echo.
echo ═══════════════════════════════════════════
echo   Менеджер Фильмов и Сериалов
echo ═══════════════════════════════════════════
echo.

REM Проверка наличия Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js не найден!
    echo    Установите Node.js с https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Переход в корень проекта (скрипт лежит в scripts\)
cd /d "%~dp0.."

REM Установка зависимостей при первом запуске
if not exist "node_modules\" (
    echo 📦 Установка зависимостей...
    call npm install --no-audit --no-fund
)

REM Запуск приложения
echo 🚀 Запуск приложения...
echo.

node scripts\app_launcher.js

pause

