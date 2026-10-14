/**
 * Легковесный launcher для веб-приложения (Node.js версия)
 * Запускает сервер и открывает приложение в браузере
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3000;
const APP_URL = `http://localhost:${PORT}/`;
// Лаунчер лежит в scripts/, сервер — в корне проекта
const ROOT_DIR = path.join(__dirname, '..');

// Проверка, отвечает ли сервер на порту
function isPortInUse(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
    });
}

// Ожидание запуска сервера
async function waitForServer(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        if (await isPortInUse(PORT)) {
            console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

// Открытие в браузере
function openBrowser(url) {
    const start = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
    
    // Для Windows используем специальную команду для открытия в приложении-режиме
    if (process.platform === 'win32') {
        // Открываем в Chrome app mode (если доступен)
        const { exec } = require('child_process');
        
        // Пробуем найти Chrome
        const chromePaths = [
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe'
        ];
        
        let chromeFound = false;
        for (const chromePath of chromePaths) {
            if (require('fs').existsSync(chromePath)) {
                console.log('🚀 Запуск приложения...');
                exec(`"${chromePath}" --app="${url}" --window-size=1400,900`);
                chromeFound = true;
                break;
            }
        }
        
        // Если Chrome не найден, используем Edge
        if (!chromeFound) {
            const edgePath = process.env.PROGRAMFILES + '\\Microsoft\\Edge\\Application\\msedge.exe';
            if (require('fs').existsSync(edgePath)) {
                console.log('🚀 Запуск приложения в Edge...');
                exec(`"${edgePath}" --app="${url}" --window-size=1400,900`);
            } else {
                // Обычное открытие в браузере по умолчанию
                exec(`${start} "" "${url}"`);
            }
        }
    } else {
        require('child_process').exec(`${start} "${url}"`);
    }
}

// Основная функция
async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  Менеджер Фильмов и Сериалов');
    console.log('═══════════════════════════════════════════\n');
    
    // Проверяем, не запущен ли уже сервер
    if (await isPortInUse(PORT)) {
        console.log('⚠️  Сервер уже запущен');
        console.log('🌐 Открываю приложение...\n');
        openBrowser(APP_URL);
        return;
    }
    
    console.log('🔄 Запуск сервера...');
    
    // Запускаем сервер
    // process.execPath — тот же node, которым запущен лаунчер (не зависит от PATH)
    const serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        detached: false
    });
    
    // Обработка ошибок
    serverProcess.on('error', (err) => {
        console.error('❌ Ошибка запуска сервера:', err.message);
        process.exit(1);
    });
    
    // Ждем запуска сервера
    const serverStarted = await waitForServer();
    
    if (serverStarted) {
        console.log('🌐 Открываю приложение...\n');
        openBrowser(APP_URL);
        
        console.log('───────────────────────────────────────────');
        console.log('✨ Приложение запущено!');
        console.log(`📍 URL: ${APP_URL}`);
        console.log('🛑 Для остановки нажмите Ctrl+C');
        console.log('───────────────────────────────────────────\n');
    } else {
        console.error('❌ Не удалось запустить сервер');
        serverProcess.kill();
        process.exit(1);
    }
    
    // Обработка выхода
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Остановка приложения...');
        serverProcess.kill();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        serverProcess.kill();
        process.exit(0);
    });
}

// Запуск
main().catch(err => {
    console.error('❌ Критическая ошибка:', err);
    process.exit(1);
});

