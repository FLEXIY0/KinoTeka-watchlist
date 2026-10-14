#!/bin/bash

# KINOTEKA - Скрипт запуска для Linux/macOS
# Запускает Node.js сервер и открывает приложение в браузере

echo "╔══════════════════════════════════════════════════════════╗"
echo "║              🎬 KINOTEKA - Запуск приложения             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Переход в корень проекта (скрипт лежит в scripts/)
cd "$(dirname "$0")/.." || exit 1

# Проверка установки Node.js
if ! command -v node &> /dev/null
then
    echo "❌ Node.js не установлен!"
    echo "📥 Установите Node.js с https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js обнаружен: $(node --version)"
echo ""

# Проверка установки зависимостей
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей..."
    npm install
    echo ""
fi

# Запуск сервера в фоне
echo "🚀 Запуск сервера..."
node server.js &
SERVER_PID=$!

# Сохраняем PID сервера
echo $SERVER_PID > .server.pid

# Ждём запуска сервера
echo "⏳ Ожидание запуска сервера..."
sleep 3

# Открываем браузер
echo "🌐 Открытие приложения в браузере..."
URL="http://localhost:3000"

# Определяем команду для открытия браузера в зависимости от ОС
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v xdg-open &> /dev/null; then
        xdg-open "$URL" 2>/dev/null
    elif command -v gnome-open &> /dev/null; then
        gnome-open "$URL" 2>/dev/null
    else
        echo "⚠️  Не удалось открыть браузер автоматически"
        echo "🔗 Откройте вручную: $URL"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "$URL"
elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows (Git Bash)
    start "$URL"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              ✅ Приложение успешно запущено!             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "📍 URL: $URL"
echo "🔧 PID сервера: $SERVER_PID"
echo ""
echo "Для остановки нажмите Ctrl+C"
echo ""

# Ждём завершения сервера
wait $SERVER_PID

# Очищаем PID файл при выходе
rm -f .server.pid

echo ""
echo "👋 Сервер остановлен"

