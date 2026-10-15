#!/bin/sh
# КиноТека — установка и запуск одной командой (Linux, macOS, Termux).
#
#   curl -fsSL https://raw.githubusercontent.com/FLEXIY0/KinoTeka-watchlist/main/install.sh | sh
#
# Что делает (то же, что install.ps1 на Windows):
#   1. Берёт Node.js 20+ из системы, а если его нет — качает портативный Node LTS
#      в папку КиноТеки (без root).
#   2. Скачивает или обновляет приложение.
#   3. Ставит плеер mpv (для просмотра в ktw), если его нет.
#   4. Добавляет команду ktw: дальше достаточно набрать ktw в любом терминале.
#   5. Запускает КиноТеку и открывает её в браузере.
#
# Всё ставится в ~/.local/share/kinoteka. Ваши фильмы лежат в .../kinoteka/data
# и при обновлении не трогаются. Обновиться: ktw update (или эта же команда).
#
# Чистый POSIX sh: на Debian/Ubuntu /bin/sh — это dash, на Alpine — busybox ash.
#
# Настройки через переменные окружения (для тестов и опытных пользователей):
#   KINOTEKA_HOME           — куда ставить (по умолчанию ~/.local/share/kinoteka)
#   KINOTEKA_BIN            — куда положить команду ktw (по умолчанию ~/.local/bin)
#   KINOTEKA_REF            — ветка/тег/коммит (по умолчанию main)
#   KINOTEKA_NO_START       — 1: только установить, не запускать
#   KINOTEKA_SKIP_MPV       — 1: не ставить mpv
#   KINOTEKA_PORTABLE_NODE  — 1: не брать системный Node, качать свой

# Весь скрипт — внутри функции, а вызов в самом конце: при `curl | sh`
# оборванная загрузка не выполнится наполовину
main() {
    set -eu

    REPO='FLEXIY0/KinoTeka-watchlist'
    REF="${KINOTEKA_REF:-main}"
    MIN_NODE_MAJOR=20

    IS_TERMUX=0
    if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then IS_TERMUX=1; fi

    KT_HOME="${KINOTEKA_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/kinoteka}"
    if [ "$IS_TERMUX" = 1 ]; then
        BIN_DIR="${KINOTEKA_BIN:-${PREFIX:-/data/data/com.termux/files/usr}/bin}"
    else
        BIN_DIR="${KINOTEKA_BIN:-$HOME/.local/bin}"
    fi

    say ''
    say "  ${C_BOLD}КИНОТЕКА — менеджер фильмов и сериалов${C_RESET}"
    say ''

    ensure_dir "$KT_HOME" || die "не удалось создать $KT_HOME"
    # Полный путь без ../ — команда ktw передаёт путь вида .../app/..
    KT_HOME=$(cd "$KT_HOME" && pwd -P)
    NODE_DIR="$KT_HOME/node"
    APP_DIR="$KT_HOME/app"
    DATA_DIR="$KT_HOME/data"
    VERSION_FILE="$APP_DIR/.kinoteka-version"
    ensure_dir "$DATA_DIR" || die "не удалось создать $DATA_DIR"

    has curl || has wget || die 'нужен curl или wget'
    has tar || die 'нужен tar'

    setup_node
    setup_app
    setup_mpv
    setup_command
    start_app
}

# ─── Оформление ─────────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RESET=$(printf '\033[0m'); C_BOLD=$(printf '\033[1m'); C_DIM=$(printf '\033[2m')
    C_STEP=$(printf '\033[36m'); C_WARN=$(printf '\033[33m'); C_BAD=$(printf '\033[31m')
else
    C_RESET=''; C_BOLD=''; C_DIM=''; C_STEP=''; C_WARN=''; C_BAD=''
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s==> %s%s\n' "$C_STEP" "$*" "$C_RESET"; }
info() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
warn() { printf '    %s%s%s\n' "$C_WARN" "$*" "$C_RESET"; }
die()  { printf '%sОшибка: %s%s\n' "$C_BAD" "$*" "$C_RESET" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Скрипт пришёл по конвейеру из curl — stdin занят им самим. Спрашивать
# пароль и запускать интерфейс можно только через /dev/tty, если он открывается.
has_tty() { (exec < /dev/tty) 2>/dev/null; }

# Каталог, который точно каталог (на его месте бывает файл или битая ссылка)
ensure_dir() {
    [ -d "$1" ] && return 0
    if [ -e "$1" ] || [ -L "$1" ]; then rm -f "$1" 2>/dev/null || true; fi
    mkdir -p "$1" 2>/dev/null || true
    [ -d "$1" ]
}

# curl есть не везде (минимальные Debian/Alpine приходят с wget)
fetch() {
    if has curl; then
        curl -fsSL --retry 2 --connect-timeout 15 -A KinoTeka-installer -o "$2" "$1" < /dev/null
    else
        wget -q -T 15 -U KinoTeka-installer -O "$2" "$1" < /dev/null
    fi
}

# Временная папка внутри КиноТеки: тот же диск, поэтому mv мгновенный
new_tmp() {
    _tmp="$KT_HOME/tmp-$$-$(date +%s)"
    rm -rf "$_tmp"
    mkdir -p "$_tmp"
    printf '%s' "$_tmp"
}

# ─── Пакеты (mpv, а на Alpine/Termux и Node) ────────────────────────────────

pkg_install() {
    _pkg="$1"
    if [ "$IS_TERMUX" = 1 ]; then pkg install -y "$_pkg" < /dev/null; return $?; fi
    if has brew; then brew install "$_pkg" < /dev/null; return $?; fi

    if has apt-get; then _cmd="DEBIAN_FRONTEND=noninteractive apt-get install -y $_pkg"
    elif has dnf; then _cmd="dnf install -y $_pkg"
    elif has pacman; then _cmd="pacman -S --noconfirm --needed $_pkg"
    elif has zypper; then _cmd="zypper install -y $_pkg"
    elif has apk; then _cmd="apk add --no-cache $_pkg"
    elif has xbps-install; then _cmd="xbps-install -Sy $_pkg"
    else return 1
    fi

    # root нужен для системных пакетов. Пароль sudo спрашиваем с терминала;
    # без терминала — только если sudo пускает без пароля
    if [ "$(id -u)" = 0 ]; then
        sh -c "$_cmd" < /dev/null
    elif has sudo && sudo -n true 2>/dev/null; then
        sudo sh -c "$_cmd" < /dev/null
    elif has sudo && has_tty; then
        info "нужен пароль sudo, чтобы поставить $_pkg"
        sudo -v < /dev/tty && sudo sh -c "$_cmd" < /dev/null
    elif has doas && has_tty; then
        doas sh -c "$_cmd" < /dev/tty
    else
        return 1
    fi
}

pkg_hint() {
    if has apt-get; then printf 'sudo apt install %s' "$1"
    elif has dnf; then printf 'sudo dnf install %s' "$1"
    elif has pacman; then printf 'sudo pacman -S %s' "$1"
    elif has zypper; then printf 'sudo zypper install %s' "$1"
    elif has apk; then printf 'sudo apk add %s' "$1"
    else printf 'https://mpv.io/installation/'
    fi
}

# ─── 1. Node.js ─────────────────────────────────────────────────────────────

node_major() {
    "$1" -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null < /dev/null
}

# Подходит ли node: версия 20+ и рядом есть npm (в Debian npm — отдельный пакет)
node_ok() {
    [ -x "$1" ] || return 1
    _major=$(node_major "$1") || return 1
    [ "${_major:-0}" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null || return 1
    [ -x "$(dirname "$1")/npm" ] || has npm
}

use_node() {
    NODE_BIN="$1"
    NODE_BIN_DIR=$(dirname "$1")
    PATH="$NODE_BIN_DIR:$PATH"
    export PATH
}

node_platform() {
    case "$(uname -s)" in
        Linux) _os=linux ;;
        Darwin) _os=darwin ;;
        *) return 1 ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) _arch=x64 ;;
        aarch64|arm64) _arch=arm64 ;;
        armv7l) _arch=armv7l ;;
        *) return 1 ;;
    esac
    # Сборки с nodejs.org собраны под glibc: на Android (Termux) и Alpine (musl)
    # они не запустятся — там Node ставится из пакетов
    [ "$IS_TERMUX" = 1 ] && return 1
    if [ "$_os" = linux ] && (ldd --version 2>&1 || true) | grep -qi musl; then return 1; fi
    printf '%s-%s' "$_os" "$_arch"
}

download_node() {
    _platform=$(node_platform) || return 1
    _tmp=$(new_tmp)
    # Свежий LTS: первая строка index.json с "lts":"<имя>" (а не false)
    if ! fetch https://nodejs.org/dist/index.json "$_tmp/index.json"; then rm -rf "$_tmp"; return 1; fi
    _version=$(grep -v '"lts":false' "$_tmp/index.json" | grep -o '"version":"v[0-9.]*"' | head -n 1 | cut -d'"' -f4)
    if [ -z "$_version" ]; then rm -rf "$_tmp"; return 1; fi

    step "Скачиваю портативный Node.js $_version (один раз, ~50 МБ)..."
    if ! fetch "https://nodejs.org/dist/$_version/node-$_version-$_platform.tar.gz" "$_tmp/node.tar.gz" ||
       ! tar -xzf "$_tmp/node.tar.gz" -C "$_tmp"; then
        rm -rf "$_tmp"
        return 1
    fi
    rm -rf "$NODE_DIR"
    mv "$_tmp/node-$_version-$_platform" "$NODE_DIR"
    rm -rf "$_tmp"
    info "Node.js $_version установлен в $NODE_DIR"
}

setup_node() {
    if node_ok "$NODE_DIR/bin/node"; then
        use_node "$NODE_DIR/bin/node"
    elif [ "${KINOTEKA_PORTABLE_NODE:-}" != 1 ] && has node && node_ok "$(command -v node)"; then
        use_node "$(command -v node)"
    fi

    if [ -n "${NODE_BIN:-}" ]; then
        step "Node.js $("$NODE_BIN" --version) уже есть"
        return
    fi

    if download_node && node_ok "$NODE_DIR/bin/node"; then
        use_node "$NODE_DIR/bin/node"
        return
    fi
    # Неподходящую сборку не оставляем: команда ktw взяла бы её первой
    rm -rf "$NODE_DIR"

    # Alpine, Termux, редкие архитектуры — Node из пакетов системы
    step 'Ставлю Node.js из пакетов системы...'
    if [ "$IS_TERMUX" = 1 ]; then
        pkg install -y nodejs-lts < /dev/null >/dev/null 2>&1 || pkg install -y nodejs < /dev/null >/dev/null 2>&1 || true
    else
        pkg_install nodejs >/dev/null 2>&1 || true
        pkg_install npm >/dev/null 2>&1 || true
    fi
    if has node && node_ok "$(command -v node)"; then
        use_node "$(command -v node)"
        return
    fi
    die "нужен Node.js $MIN_NODE_MAJOR или новее с npm: https://nodejs.org/"
}

# ─── 2. Приложение ──────────────────────────────────────────────────────────

setup_app() {
    _installed=''
    [ -f "$VERSION_FILE" ] && _installed=$(tr -d ' \r\n' < "$VERSION_FILE")

    # Версия из GitHub API. Не ответил (чаще всего лимит: 60 запросов в час
    # с одного IP) — версию не узнать, просто качаем свежий архив, он маленький
    _api="${KINOTEKA_GITHUB_API:-https://api.github.com}"
    _latest=''
    _api_failed=0
    _tmp=$(new_tmp)
    if fetch "$_api/repos/$REPO/commits/$REF" "$_tmp/commit.json" 2>/dev/null; then
        _latest=$(grep -o '"sha": *"[0-9a-f]\{40\}"' "$_tmp/commit.json" | head -n 1 | grep -o '[0-9a-f]\{40\}' || true)
    fi
    rm -rf "$_tmp"
    if [ -z "$_latest" ]; then _latest="$REF"; _api_failed=1; fi

    _ready=0
    [ -f "$APP_DIR/server.js" ] && [ -d "$APP_DIR/node_modules" ] && _ready=1

    if [ "$_latest" = "$_installed" ] && [ "$_ready" = 1 ]; then
        step 'Установлена последняя версия'
        return
    fi

    if [ -n "$_installed" ]; then step 'Обновляю КиноТеку...'; else step 'Скачиваю КиноТеку...'; fi
    [ "$_api_failed" = 1 ] && info 'GitHub API не ответил — скачиваю свежую версию напрямую'

    # 1) Скачать и распаковать. Нет сети, но КиноТека уже стоит — запускаем её
    _tmp=$(new_tmp)
    if ! fetch "https://github.com/$REPO/archive/$_latest.tar.gz" "$_tmp/app.tar.gz" ||
       ! mkdir -p "$_tmp/x" || ! tar -xzf "$_tmp/app.tar.gz" -C "$_tmp/x"; then
        rm -rf "$_tmp"
        [ "$_ready" = 1 ] || die 'не удалось скачать КиноТеку с GitHub'
        info 'Нет связи с GitHub — запускаю установленную версию'
        return
    fi
    _new=$(find "$_tmp/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    [ -n "$_new" ] && [ -f "$_new/server.js" ] || { rm -rf "$_tmp"; die 'архив КиноТеки повреждён'; }

    # 2) Подменить папку приложения. Уже скачанные модули переносим,
    #    чтобы npm только докачал разницу
    rm -rf "$APP_DIR.old"
    [ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
    mv "$_new" "$APP_DIR"
    [ -d "$APP_DIR.old/node_modules" ] && mv "$APP_DIR.old/node_modules" "$APP_DIR/node_modules"
    rm -rf "$APP_DIR.old" "$_tmp"

    # 3) Зависимости (без рекламы новых версий npm)
    step 'Устанавливаю зависимости...'
    NPM_CONFIG_UPDATE_NOTIFIER=false
    export NPM_CONFIG_UPDATE_NOTIFIER
    (cd "$APP_DIR" && "$NODE_BIN_DIR/npm" install --omit=dev --no-audit --no-fund --loglevel=error < /dev/null) ||
        (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error < /dev/null) ||
        die 'npm install завершился с ошибкой'
    printf '%s\n' "$_latest" > "$VERSION_FILE"
    info "Версия $(printf '%s' "$_latest" | cut -c1-7)"
}

# ─── 3. Плеер mpv (для просмотра в ktw) ────────────────────────────────────

setup_mpv() {
    has mpv && return
    [ "${KINOTEKA_SKIP_MPV:-}" = 1 ] && return

    # На Android видео без графической оболочки mpv не покажет: ktw отдаёт
    # поток плееру Android (VLC, MX Player, mpv-android)
    if [ "$IS_TERMUX" = 1 ]; then
        info 'ktw будет открывать видео в плеере Android — поставьте VLC или MX Player'
        return
    fi

    step 'Ставлю видеоплеер mpv (нужен для просмотра в ktw)...'
    if pkg_install mpv >/dev/null 2>&1 && has mpv; then
        info "mpv: $(command -v mpv)"
    else
        info "Не получилось поставить mpv сам. Команда: $(pkg_hint mpv)"
        info 'Коллекция и просмотр в браузере работают и без него'
    fi
}

# ─── 4. Команда ktw ─────────────────────────────────────────────────────────

# Строка в одинарных кавычках для sh (путь может содержать пробелы)
quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

setup_command() {
    if ! ensure_dir "$BIN_DIR"; then
        BIN_DIR="$KT_HOME/bin"
        ensure_dir "$BIN_DIR" || die "не удалось создать $BIN_DIR"
    fi

    _ktw="$BIN_DIR/ktw"
    if [ -f "$_ktw" ] && ! grep -q 'KINOTEKA_DATA_DIR' "$_ktw" 2>/dev/null; then
        info "Старая команда ktw от KinoTeka-Watch заменена новой (копия: $_ktw.old)"
        mv -f "$_ktw" "$_ktw.old"
    fi

    # Свой Node — в папке КиноТеки; системный запоминаем полным путём,
    # а если его потом обновят или удалят — берём node из PATH
    # В Termux нет /bin/sh — оболочка лежит в $PREFIX/bin
    _sh=/bin/sh
    [ "$IS_TERMUX" = 1 ] && [ -x "${PREFIX:-}/bin/sh" ] && _sh="$PREFIX/bin/sh"

    rm -f "$_ktw"
    {
        say "#!$_sh"
        say '# КиноТека: команда ktw (создана install.sh)'
        say "KT_HOME=$(quote "$KT_HOME")"
        say "KT_NODE=$(quote "$NODE_BIN")"
        say 'KINOTEKA_HOME="$KT_HOME"; KINOTEKA_DATA_DIR="$KT_HOME/data"'
        say 'export KINOTEKA_HOME KINOTEKA_DATA_DIR'
        say 'if [ -x "$KT_HOME/node/bin/node" ]; then KT_NODE="$KT_HOME/node/bin/node"; fi'
        say 'if [ ! -x "$KT_NODE" ]; then KT_NODE=node; fi'
        say 'PATH="$(dirname "$(command -v "$KT_NODE")"):$PATH"; export PATH'
        say 'exec "$KT_NODE" "$KT_HOME/app/scripts/kinoteka.js" "$@"'
    } > "$_ktw"
    chmod +x "$_ktw"

    case ":$PATH:" in
        *":$BIN_DIR:"*) return ;;
    esac

    # Папки нет в PATH — дописываем в настройки оболочек (один раз)
    _line="export PATH=\"$BIN_DIR:\$PATH\""
    # (zsh — оболочка macOS по умолчанию — не читает ~/.profile)
    for _rc in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
        case "$_rc" in
            *.profile) ;;
            *.zshrc) [ -f "$_rc" ] || case "${SHELL:-}" in *zsh) ;; *) continue ;; esac ;;
            *) [ -f "$_rc" ] || continue ;;
        esac
        grep -qs "# КиноТека: команда ktw" "$_rc" && continue
        printf '\n# КиноТека: команда ktw\n%s\n' "$_line" >> "$_rc"
    done
    if [ -d "$HOME/.config/fish" ]; then
        mkdir -p "$HOME/.config/fish/conf.d"
        printf 'fish_add_path -g %s\n' "$(quote "$BIN_DIR")" > "$HOME/.config/fish/conf.d/kinoteka.fish"
    fi
    NEED_NEW_SHELL=1
}

# ─── 5. Запуск ──────────────────────────────────────────────────────────────

start_app() {
    info "Ваши данные: $DATA_DIR"
    say ''
    say "  ${C_WARN}Дальше просто наберите ktw в терминале:${C_RESET}"
    say "  ${C_WARN}  ktw            — коллекция (откроется в браузере)${C_RESET}"
    say "  ${C_WARN}  ktw матрица    — сразу смотреть в плеере ktw${C_RESET}"
    say "  ${C_WARN}  ktw update     — обновиться${C_RESET}"
    if [ "${NEED_NEW_SHELL:-0}" = 1 ]; then
        say "  ${C_DIM}  (в этом окне команда появится после: exec \$SHELL -l — или откройте новый терминал)${C_RESET}"
    fi
    say ''

    [ "${KINOTEKA_NO_START:-}" = 1 ] && return

    KINOTEKA_HOME="$KT_HOME"
    KINOTEKA_DATA_DIR="$DATA_DIR"
    export KINOTEKA_HOME KINOTEKA_DATA_DIR
    # Интерфейс в терминале читает клавиши — даём ему терминал, а не конвейер
    if has_tty; then
        exec "$NODE_BIN" "$APP_DIR/scripts/app_launcher.js" < /dev/tty
    fi
    exec "$NODE_BIN" "$APP_DIR/scripts/app_launcher.js" < /dev/null
}

main "$@"
