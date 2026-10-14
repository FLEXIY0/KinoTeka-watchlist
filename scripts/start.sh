#!/bin/bash
# KINOTEKA — запуск для Linux/macOS
# Запускает сервер и открывает приложение в браузере (интерфейс в терминале)

cd "$(dirname "$0")/.." || exit 1

if ! command -v node &> /dev/null; then
    echo "Node.js не установлен. Установите LTS-версию с https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Установка зависимостей..."
    npm install --omit=dev --no-audit --no-fund || exit 1
fi

exec node scripts/app_launcher.js "$@"
