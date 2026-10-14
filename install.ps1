# КиноТека — установка и запуск одной командой (Windows PowerShell 5.1+ / PowerShell 7).
#
#   irm https://raw.githubusercontent.com/FLEXIY0/KinoTeka-watchlist/main/install.ps1 | iex
#
# Что делает:
#   1. Скачивает портативный Node.js LTS (если подходящего нет) — без прав администратора.
#   2. Скачивает или обновляет приложение.
#   3. Ставит плеер mpv через winget (для просмотра в ktw), если его нет.
#   4. Добавляет команду ktw: дальше достаточно набрать ktw в любом терминале.
#   5. Запускает КиноТеку и открывает её в браузере.
#
# Всё ставится в %LOCALAPPDATA%\KinoTeka. Ваши фильмы лежат в ...\KinoTeka\data
# и при обновлении не трогаются. Обновиться: ktw update (или эта же команда).
#
# Настройки через переменные окружения (для тестов и опытных пользователей):
#   KINOTEKA_HOME      — куда ставить (по умолчанию %LOCALAPPDATA%\KinoTeka)
#   KINOTEKA_REF       — ветка/тег/коммит (по умолчанию main)
#   KINOTEKA_NO_START  — 1: только установить, не запускать
#   KINOTEKA_SKIP_MPV  — 1: не ставить mpv

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # иначе Invoke-WebRequest в PowerShell 5.1 качает в разы медленнее

    $Repo = 'FLEXIY0/KinoTeka-watchlist'
    $Ref = if ($env:KINOTEKA_REF) { $env:KINOTEKA_REF } else { 'main' }
    $Home_ = if ($env:KINOTEKA_HOME) { $env:KINOTEKA_HOME } else { Join-Path $env:LOCALAPPDATA 'KinoTeka' }
    $NodeDir = Join-Path $Home_ 'node'
    $AppDir = Join-Path $Home_ 'app'
    $DataDir = Join-Path $Home_ 'data'
    $VersionFile = Join-Path $AppDir '.kinoteka-version'
    $MinNodeMajor = 20

    function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
    function Info($text) { Write-Host "    $text" -ForegroundColor DarkGray }

    # Старые Windows по умолчанию не включают TLS 1.2
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    function Download($url, $file) {
        Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -Headers @{ 'User-Agent' = 'KinoTeka-installer' }
    }

    function Expand-Zip($zip, $dest) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
    }

    # Временная папка внутри KinoTeka: тот же диск, поэтому папки можно перемещать
    function New-TempDir {
        $dir = Join-Path $Home_ ("tmp-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir | Out-Null
        return $dir
    }

    Write-Host ''
    Write-Host '  КИНОТЕКА — менеджер фильмов и сериалов' -ForegroundColor White
    Write-Host ''

    New-Item -ItemType Directory -Force -Path $Home_, $DataDir | Out-Null

    # ── 1. Node.js ──────────────────────────────────────────────────────────
    $NodeExe = $null
    $NpmCmd = $null
    $LocalNode = Join-Path $NodeDir 'node.exe'

    if (Test-Path $LocalNode) {
        $NodeExe = $LocalNode
        $NpmCmd = Join-Path $NodeDir 'npm.cmd'
    } else {
        $systemNode = Get-Command node -ErrorAction SilentlyContinue
        if ($systemNode) {
            $major = [int]((& $systemNode.Source --version) -replace '^v(\d+).*', '$1')
            if ($major -ge $MinNodeMajor) {
                $NodeExe = $systemNode.Source
                $NpmCmd = 'npm.cmd'
            }
        }
    }

    if ($NodeExe) {
        Step "Node.js $(& $NodeExe --version) уже есть"
    } else {
        $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
            'AMD64' { 'x64' }
            'ARM64' { 'arm64' }
            default { throw "Архитектура $($env:PROCESSOR_ARCHITECTURE) не поддерживается (нужна 64-битная Windows)" }
        }
        Step 'Скачиваю портативный Node.js LTS (один раз, ~30 МБ)...'
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $version = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
        $tmp = New-TempDir
        try {
            $zip = Join-Path $tmp 'node.zip'
            Download "https://nodejs.org/dist/$version/node-$version-win-$arch.zip" $zip
            Expand-Zip $zip $tmp
            if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
            Move-Item (Join-Path $tmp "node-$version-win-$arch") $NodeDir
        } finally {
            Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
        }
        $NodeExe = $LocalNode
        $NpmCmd = Join-Path $NodeDir 'npm.cmd'
        Info "Node.js $version установлен в $NodeDir"
    }

    # ── 2. Приложение ───────────────────────────────────────────────────────
    $installed = if (Test-Path $VersionFile) { (Get-Content $VersionFile -Raw).Trim() } else { $null }
    $latest = $null
    try {
        $latest = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -UseBasicParsing -Headers @{ 'User-Agent' = 'KinoTeka-installer' }).sha
    } catch {
        if (-not $installed) { $latest = $Ref }   # GitHub API недоступен, но ставить всё равно нужно
    }

    $appReady = (Test-Path (Join-Path $AppDir 'server.js')) -and (Test-Path (Join-Path $AppDir 'node_modules'))
    if ($latest -and ($latest -ne $installed -or -not $appReady)) {
        Step $(if ($installed) { 'Обновляю КиноТеку...' } else { 'Скачиваю КиноТеку...' })
        $tmp = New-TempDir
        try {
            $zip = Join-Path $tmp 'app.zip'
            Download "https://github.com/$Repo/archive/$latest.zip" $zip
            $extract = Join-Path $tmp 'x'
            Expand-Zip $zip $extract
            $newApp = (Get-ChildItem $extract -Directory | Select-Object -First 1).FullName

            # Меняем папки через переименование: если КиноТека сейчас запущена,
            # Windows не даст переименовать папку, и старая версия останется целой
            $backup = "$AppDir.old"
            if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
            $swapped = $true
            if (Test-Path $AppDir) {
                try { Rename-Item $AppDir (Split-Path $backup -Leaf) } catch { $swapped = $false }
            }
            if ($swapped) {
                Move-Item $newApp $AppDir
                # Уже скачанные модули переносим, чтобы npm только докачал разницу
                $oldModules = Join-Path $backup 'node_modules'
                if (Test-Path $oldModules) { Move-Item $oldModules (Join-Path $AppDir 'node_modules') }
                Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
            }
        } finally {
            Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
        }

        if (-not $swapped) {
            Write-Host '    КиноТека сейчас запущена — обновление пропущено.' -ForegroundColor Yellow
            Write-Host '    Закройте её окно (клавиша Q) и вставьте команду ещё раз.' -ForegroundColor Yellow
        } else {
            Step 'Устанавливаю зависимости...'
            Push-Location $AppDir
            $oldPath = $env:Path
            try {
                $env:Path = "$(Split-Path $NodeExe);$env:Path"
                & $NpmCmd install --omit=dev --no-audit --no-fund --loglevel=error
                if ($LASTEXITCODE -ne 0) { throw 'npm install завершился с ошибкой' }
            } finally {
                $env:Path = $oldPath
                Pop-Location
            }
            Set-Content -Path $VersionFile -Value $latest -Encoding ASCII
            Info "Версия $($latest.Substring(0, [Math]::Min(7, $latest.Length)))"
        }
    } elseif ($appReady) {
        Step $(if ($latest) { 'Установлена последняя версия' } else { 'Нет связи с GitHub — запускаю установленную версию' })
    } else {
        throw 'Не удалось скачать КиноТеку: нет связи с GitHub'
    }

    # ── 3. Плеер mpv (для просмотра в ktw) ─────────────────────────────────
    $mpvKnown = (Get-Command mpv -ErrorAction SilentlyContinue) -or
        (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\mpv.exe')) -or
        (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'shinchiro.mpv*' -Directory -ErrorAction SilentlyContinue)
    if (-not $mpvKnown -and $env:KINOTEKA_SKIP_MPV -ne '1') {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Step 'Ставлю видеоплеер mpv (нужен для просмотра в ktw)...'
            try {
                winget install --id shinchiro.mpv -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
            } catch {
                Info 'mpv поставить не вышло — коллекция работает и без него'
            }
        } else {
            Info 'Для просмотра в ktw нужен mpv: https://mpv.io/installation/ (коллекция работает и без него)'
        }
    }

    # ── 4. Команда ktw ──────────────────────────────────────────────────────
    # Внутри только пути относительно самой команды: cmd читает .cmd в
    # кодировке OEM, и абсолютный путь с кириллицей (C:\Users\Иван) сломался бы
    $BinDir = Join-Path $Home_ 'bin'
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $shim = @(
        '@echo off',
        'setlocal',
        'set "KT_HOME=%~dp0.."',
        'set "KINOTEKA_HOME=%KT_HOME%"',
        'set "KINOTEKA_DATA_DIR=%KT_HOME%\data"',
        'set "PATH=%KT_HOME%\node;%PATH%"',
        'node "%KT_HOME%\app\scripts\kinoteka.js" %*'
    ) -join "`r`n"
    Set-Content -Path (Join-Path $BinDir 'ktw.cmd') -Value $shim -Encoding ASCII

    # Добавляем папку в PATH пользователя первой — раньше старого ktw от
    # KinoTeka-Watch. Читаем PATH из реестра как есть, чтобы не раскрыть
    # переменные вроде %USERPROFILE% в уже существующих путях.
    $envKey = Get-Item 'HKCU:\Environment'
    $userPath = $envKey.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    $parts = @($userPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $BinDir.TrimEnd('\')) })
    $newPath = (@($BinDir) + $parts) -join ';'
    if ($newPath -ne $userPath) {
        Set-ItemProperty -Path 'HKCU:\Environment' -Name 'Path' -Value $newPath -Type ExpandString
        # Сообщаем Windows, что окружение изменилось (новые окна увидят ktw)
        [Environment]::SetEnvironmentVariable('KINOTEKA_ENV_REFRESH', '1', 'User')
        [Environment]::SetEnvironmentVariable('KINOTEKA_ENV_REFRESH', $null, 'User')
    }
    if (-not (($env:Path -split ';') -contains $BinDir)) { $env:Path = "$BinDir;$env:Path" }

    $oldKtw = Join-Path $env:USERPROFILE '.local\bin'
    if (Get-ChildItem $oldKtw -Filter 'ktw*' -ErrorAction SilentlyContinue) {
        Info "Старый ktw от KinoTeka-Watch лежит в $oldKtw — новый ktw теперь стоит в PATH раньше него"
    }

    # ── 5. Запуск ───────────────────────────────────────────────────────────
    Info "Ваши данные: $DataDir"
    Write-Host ''
    Write-Host '  Дальше просто наберите ktw в любом терминале:' -ForegroundColor Yellow
    Write-Host '    ktw            — коллекция (откроется в браузере)' -ForegroundColor Yellow
    Write-Host '    ktw матрица    — сразу смотреть в плеере ktw' -ForegroundColor Yellow
    Write-Host '    ktw update     — обновиться' -ForegroundColor Yellow
    Write-Host ''

    if ($env:KINOTEKA_NO_START -eq '1') { return }

    $oldData = $env:KINOTEKA_DATA_DIR
    try {
        $env:KINOTEKA_DATA_DIR = $DataDir
        & $NodeExe (Join-Path $AppDir 'scripts\app_launcher.js')
    } finally {
        $env:KINOTEKA_DATA_DIR = $oldData
    }
}
