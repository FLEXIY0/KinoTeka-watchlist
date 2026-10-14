@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
color 0B
title Установка КиноТека

REM ============================================================
REM              УСТАНОВЩИК KINOTEKA WATCHLIST
REM ============================================================

cls
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║              УСТАНОВКА ПРИЛОЖЕНИЯ КИНОТЕКА                ║
echo ║                                                            ║
echo ║         Менеджер коллекции фильмов и сериалов             ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo.

REM Путь установки по умолчанию (рядом с bat-файлом)
set "INSTALL_DIR=%~dp0KinoTeka"
set "NODEJS_DIR=%INSTALL_DIR%\nodejs"
set "APP_DIR=%INSTALL_DIR%\app"
set "LOG_FILE=%~dp0install_log.txt"

REM Очистка лог-файла
echo [%date% %time%] Начало установки КиноТека > "%LOG_FILE%"

echo [НАСТРОЙКА] Директория установки...
echo.
echo [INFO] Установка в: %INSTALL_DIR%
echo [INFO] Если хотите изменить, отредактируйте переменную INSTALL_DIR в bat-файле
echo [%date% %time%] Путь установки: %INSTALL_DIR% >> "%LOG_FILE%"
timeout /t 2 /nobreak >nul

REM ============================================================
REM                    СОЗДАНИЕ ПАПОК
REM ============================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ШАГ 1/5: Создание структуры папок                        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

if exist "%INSTALL_DIR%" (
    echo [WARN] Папка установки уже существует
    echo [INFO] Файлы будут обновлены/перезаписаны
    echo [%date% %time%] WARN: Папка уже существует, обновление >> "%LOG_FILE%"
) else (
    mkdir "%INSTALL_DIR%" 2>> "%LOG_FILE%"
    if errorlevel 1 (
        echo [ERROR] Не удалось создать папку установки
        echo [ERROR] Проверьте права доступа
        pause
        exit /b 1
    )
)

mkdir "%NODEJS_DIR%" 2>nul
mkdir "%APP_DIR%" 2>nul

echo [OK] Папки созданы
echo [%date% %time%] Папки созданы успешно >> "%LOG_FILE%"
timeout /t 1 /nobreak >nul

REM ============================================================
REM              ОПРЕДЕЛЕНИЕ АРХИТЕКТУРЫ СИСТЕМЫ
REM ============================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ШАГ 2/5: Скачивание Node.js LTS Portable                 ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

set "ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="x86" (
    if not defined PROCESSOR_ARCHITEW6432 set "ARCH=x86"
)

echo [INFO] Архитектура системы: %ARCH%
echo [%date% %time%] Архитектура: %ARCH% >> "%LOG_FILE%"

REM URL для Node.js v22 LTS
set "NODE_VERSION=22.22.0"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-%ARCH%.zip"
set "NODE_ZIP=%INSTALL_DIR%\nodejs.zip"

echo [DOWNLOAD] Скачивание Node.js v%NODE_VERSION% (%ARCH%)...
echo [INFO] Это может занять несколько минут...
echo.

powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing; exit 0 } catch { Write-Host 'ERROR:' $_.Exception.Message; exit 1 }}" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [ERROR] Не удалось скачать Node.js
    echo [ERROR] Проверьте подключение к интернету
    echo [%date% %time%] ERROR: Не удалось скачать Node.js >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo [OK] Node.js скачан
echo [%date% %time%] Node.js скачан >> "%LOG_FILE%"

REM ============================================================
REM                 РАСПАКОВКА NODE.JS
REM ============================================================

echo.
echo [EXTRACT] Распаковка Node.js...

powershell -Command "& {Add-Type -AssemblyName System.IO.Compression.FileSystem; try { [System.IO.Compression.ZipFile]::ExtractToDirectory('%NODE_ZIP%', '%NODEJS_DIR%'); exit 0 } catch { Write-Host 'ERROR:' $_.Exception.Message; exit 1 }}" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [ERROR] Не удалось распаковать Node.js
    echo [%date% %time%] ERROR: Распаковка Node.js >> "%LOG_FILE%"
    pause
    exit /b 1
)

REM Перемещение файлов из подпапки node-v* в корень nodejs
for /d %%i in ("%NODEJS_DIR%\node-v*") do (
    echo [INFO] Перемещение файлов из %%i
    xcopy "%%i\*" "%NODEJS_DIR%\" /E /I /Y >nul 2>&1
    rd /s /q "%%i" 2>nul
)

REM Удаление архива
del "%NODE_ZIP%" >nul 2>&1

echo [OK] Node.js установлен
echo [%date% %time%] Node.js распакован >> "%LOG_FILE%"

REM Проверка установки Node.js
"%NODEJS_DIR%\node.exe" --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js не работает корректно
    echo [%date% %time%] ERROR: Node.js не запускается >> "%LOG_FILE%"
    pause
    exit /b 1
)

for /f "delims=" %%v in ('"%NODEJS_DIR%\node.exe" --version') do set "NODE_VER=%%v"
echo [OK] Node.js %NODE_VER% готов к работе
timeout /t 1 /nobreak >nul

REM ============================================================
REM            СКАЧИВАНИЕ РЕПОЗИТОРИЯ С GITHUB
REM ============================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ШАГ 3/5: Скачивание приложения КиноТека                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

set "REPO_URL=https://github.com/FLEXIY0/KinoTeka-watchlist"
set "REPO_ZIP_URL=https://github.com/FLEXIY0/KinoTeka-watchlist/archive/refs/heads/main.zip"
set "REPO_ZIP=%INSTALL_DIR%\repo.zip"

REM Проверка наличия git
where git >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Git обнаружен, клонирование репозитория...
    echo [%date% %time%] Клонирование через Git >> "%LOG_FILE%"
    
    git clone "%REPO_URL%.git" "%APP_DIR%" 2>> "%LOG_FILE%"
    
    if errorlevel 1 (
        echo [WARN] Git clone не удался, переход к ZIP загрузке...
        goto DOWNLOAD_ZIP
    ) else (
        echo [OK] Репозиторий склонирован через Git
        goto INSTALL_DEPS
    )
)

:DOWNLOAD_ZIP
echo [INFO] Git не найден, скачивание ZIP архива...
echo [DOWNLOAD] Загрузка репозитория...
echo.

powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -Uri '%REPO_ZIP_URL%' -OutFile '%REPO_ZIP%' -UseBasicParsing; exit 0 } catch { Write-Host 'ERROR:' $_.Exception.Message; exit 1 }}" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [ERROR] Не удалось скачать репозиторий
    echo [ERROR] Проверьте подключение к интернету
    echo [%date% %time%] ERROR: Скачивание репозитория >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo [OK] Репозиторий скачан
echo [%date% %time%] Репозиторий скачан >> "%LOG_FILE%"

echo [EXTRACT] Распаковка репозитория...

REM Создаем временную папку для распаковки
set "TEMP_EXTRACT=%INSTALL_DIR%\temp_extract"
mkdir "%TEMP_EXTRACT%" 2>nul

powershell -Command "& {Add-Type -AssemblyName System.IO.Compression.FileSystem; try { [System.IO.Compression.ZipFile]::ExtractToDirectory('%REPO_ZIP%', '%TEMP_EXTRACT%'); exit 0 } catch { Write-Host 'ERROR:' $_.Exception.Message; exit 1 }}" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [ERROR] Не удалось распаковать репозиторий
    echo [%date% %time%] ERROR: Распаковка репозитория >> "%LOG_FILE%"
    pause
    exit /b 1
)

REM Перемещение файлов из подпапки KinoTeka-watchlist-main в APP_DIR
for /d %%i in ("%TEMP_EXTRACT%\KinoTeka-watchlist-*") do (
    echo [INFO] Перемещение файлов из %%i
    xcopy "%%i\*" "%APP_DIR%\" /E /I /Y >nul 2>&1
    rd /s /q "%%i" 2>nul
)

REM Очистка временных файлов
rd /s /q "%TEMP_EXTRACT%" 2>nul
del "%REPO_ZIP%" >nul 2>&1

echo [OK] Репозиторий распакован
echo [%date% %time%] Репозиторий распакован >> "%LOG_FILE%"
timeout /t 1 /nobreak >nul

REM ============================================================
REM              УСТАНОВКА ЗАВИСИМОСТЕЙ NPM
REM ============================================================

:INSTALL_DEPS
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ШАГ 4/5: Установка зависимостей                          ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo [NPM] Установка модулей Node.js...
echo [INFO] Это может занять несколько минут...
echo.
echo [%date% %time%] Начало npm install >> "%LOG_FILE%"

cd /d "%APP_DIR%"

REM Установка npm модулей через портативный Node.js
call "%NODEJS_DIR%\npm.cmd" install --no-audit --no-fund

echo.
if exist "%APP_DIR%\node_modules" (
    echo [OK] Зависимости установлены
    echo [%date% %time%] npm install завершен >> "%LOG_FILE%"
) else (
    echo [ERROR] Не удалось установить зависимости
    echo [ERROR] Проверьте лог-файл: %LOG_FILE%
    echo [%date% %time%] ERROR: npm install >> "%LOG_FILE%"
    pause
    exit /b 1
)

timeout /t 1 /nobreak >nul

REM ============================================================
REM          СОЗДАНИЕ ЛАУНЧЕРА ДЛЯ ЗАПУСКА
REM ============================================================

echo.
echo [CREATE] Создание лаунчера приложения...
echo [%date% %time%] Создание лаунчера >> "%LOG_FILE%"

set "LAUNCHER_PATH=%INSTALL_DIR%\Launch_Kinoteka.bat"

REM Создание bat-файла лаунчера с портативным Node.js
(
echo @echo off
echo chcp 65001 ^>nul 2^>^&1
echo title КиноТека - Запуск
echo.
echo REM Получение директории скрипта
echo set "SCRIPT_DIR=%%~dp0"
echo set "SCRIPT_DIR=%%SCRIPT_DIR:~0,-1%%"
echo.
echo REM Добавление портативного Node.js в PATH
echo set "PATH=%%SCRIPT_DIR%%\nodejs;%%PATH%%"
echo.
echo REM Переход в папку приложения
echo cd /d "%%SCRIPT_DIR%%\app"
echo.
echo REM Проверка Node.js
echo node --version ^>nul 2^>^&1
echo if errorlevel 1 ^(
echo     echo [ERROR] Node.js не найден
echo     echo [INFO] Переустановите приложение
echo     pause
echo     exit /b 1
echo ^)
echo.
echo REM Запуск оригинального start.bat
echo call "%%SCRIPT_DIR%%\app\start.bat"
echo.
echo exit /b 0
) > "%LAUNCHER_PATH%"

if exist "%LAUNCHER_PATH%" (
    echo [OK] Лаунчер создан: Запуск_КиноТека.bat
    echo [%date% %time%] Лаунчер создан >> "%LOG_FILE%"
) else (
    echo [ERROR] Не удалось создать лаунчер
    echo [%date% %time%] ERROR: Лаунчер не создан >> "%LOG_FILE%"
    pause
    exit /b 1
)

timeout /t 1 /nobreak >nul

REM ============================================================
REM          СОЗДАНИЕ ЯРЛЫКА НА РАБОЧЕМ СТОЛЕ
REM ============================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ШАГ 5/5: Создание ярлыка на рабочем столе                ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo [%date% %time%] Создание ярлыка на рабочем столе >> "%LOG_FILE%"

set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP%\Kinoteka.lnk"
set "VBS_SCRIPT=%INSTALL_DIR%\create_shortcut.vbs"

REM Создание VBS скрипта для создания ярлыка
(
echo Set oWS = WScript.CreateObject^("WScript.Shell"^)
echo sLinkFile = "%SHORTCUT_PATH%"
echo Set oLink = oWS.CreateShortcut^(sLinkFile^)
echo oLink.TargetPath = "%LAUNCHER_PATH%"
echo oLink.WorkingDirectory = "%INSTALL_DIR%"
echo oLink.Description = "Запуск приложения КиноТека - Менеджер фильмов"
echo oLink.WindowStyle = 1
echo oLink.Save
) > "%VBS_SCRIPT%"

REM Выполнение VBS скрипта
cscript //nologo "%VBS_SCRIPT%" >nul 2>&1

timeout /t 1 /nobreak >nul

if exist "%SHORTCUT_PATH%" (
    echo [OK] Ярлык создан на рабочем столе
    echo [%date% %time%] Ярлык создан >> "%LOG_FILE%"
) else (
    echo [WARN] Не удалось создать ярлык автоматически
    echo [INFO] Вы можете запустить приложение вручную через Launch_Kinoteka.bat
    echo [%date% %time%] WARN: Ярлык не создан >> "%LOG_FILE%"
)

REM Удаление VBS скрипта
del "%VBS_SCRIPT%" >nul 2>&1

timeout /t 1 /nobreak >nul

REM ============================================================
REM                 ЗАВЕРШЕНИЕ УСТАНОВКИ
REM ============================================================

cls
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║           УСТАНОВКА ЗАВЕРШЕНА УСПЕШНО!                    ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo.
echo [✓] Node.js установлен:     %NODEJS_DIR%
echo [✓] Приложение установлено: %APP_DIR%
echo [✓] Лаунчер создан:         Launch_Kinoteka.bat
echo [✓] Ярлык создан:           Kinoteka.lnk (на рабочем столе)
echo.
echo ════════════════════════════════════════════════════════════
echo.
echo                  КАК ИСПОЛЬЗОВАТЬ:
echo.
echo  1. Запуск через ярлык "Kinoteka" на рабочем столе
echo.
echo  2. Ручной запуск через файл:
echo     %INSTALL_DIR%\Launch_Kinoteka.bat
echo.
echo  3. После запуска откроется браузер по адресу:
echo     http://localhost:3000/
echo.
echo ════════════════════════════════════════════════════════════
echo.
echo [%date% %time%] Установка завершена успешно >> "%LOG_FILE%"

REM ============================================================
REM                   ПЕРВЫЙ ЗАПУСК
REM ============================================================

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  ЗАПУСК ПРИЛОЖЕНИЯ...                                      ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

cd /d "%INSTALL_DIR%"

echo [START] Запуск сервера КиноТека...
echo [INFO] Откроется новое окно с сервером
echo [INFO] НЕ ЗАКРЫВАЙТЕ окно сервера во время работы!
echo.
echo [%date% %time%] Автоматический запуск приложения >> "%LOG_FILE%"
timeout /t 2 /nobreak >nul

REM Запуск через лаунчер
start "" "%LAUNCHER_PATH%"

echo.
echo [OK] Приложение запущено!
echo.
echo [INFO] Это окно можно закрыть
echo [INFO] Ярлык "Kinoteka" создан на рабочем столе
echo.
timeout /t 5 /nobreak >nul

exit /b 0

