'use strict';

// Замер реального потребления оперативной памяти (RAM в МБ) KTW + mpv + терминала (Bun / Node.js).

var fs = require('fs');
var child_process = require('child_process');

var cachedMpvMb = null;

var isBun = typeof Bun !== 'undefined' || !!process.isBun;
var runtimeName = isBun ? ('Bun ' + (typeof Bun !== 'undefined' ? ('v' + Bun.version) : '')) : ('Node.js ' + process.version);

// Чтение RSS памяти процесса в мегабайтах
function getProcessRssMb(pid) {
    if (!pid || pid <= 0) return 0;

    // 1. Linux /proc filesystem (мгновенно, 0ms overhead)
    try {
        if (fs.existsSync('/proc/' + pid + '/status')) {
            var status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
            var match = status.match(/VmRSS:\s+(\d+)\s+kB/i);
            if (match) {
                return +(parseInt(match[1], 10) / 1024).toFixed(1);
            }
        }
    } catch (e) {}

    // 2. Linux/macOS ps
    try {
        var psOut = child_process.execSync('ps -o rss= -p ' + pid, { timeout: 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        var kb = parseInt(psOut.trim(), 10);
        if (!isNaN(kb) && kb > 0) {
            return +(kb / 1024).toFixed(1);
        }
    } catch (e) {}

    // 3. Windows tasklist
    try {
        var winOut = child_process.execSync('tasklist /fi "PID eq ' + pid + '" /fo csv /nh', { timeout: 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        var parts = winOut.split(',');
        if (parts.length >= 5) {
            var memStr = parts[4].replace(/[^0-9]/g, '');
            var winKb = parseInt(memStr, 10);
            if (!isNaN(winKb) && winKb > 0) {
                return +(winKb / 1024).toFixed(1);
            }
        }
    } catch (e) {}

    return 0;
}

// Замер памяти родительского терминала/оболочки
function getTerminalRssMb() {
    var ppid = process.ppid;
    if (!ppid) return 0;

    var termMb = getProcessRssMb(ppid);

    // Проверяем родителя шелла (терминальный эмулятор, например gnome-terminal/alacritty/kitty/pty)
    try {
        if (fs.existsSync('/proc/' + ppid + '/stat')) {
            var stat = fs.readFileSync('/proc/' + ppid + '/stat', 'utf8');
            var pppidMatch = stat.match(/\d+\s+\([^)]+\)\s+\S+\s+(\d+)/);
            if (pppidMatch && pppidMatch[1]) {
                var pppid = parseInt(pppidMatch[1], 10);
                if (pppid > 1) {
                    var parentTermMb = getProcessRssMb(pppid);
                    if (parentTermMb > 0) {
                        termMb += parentTermMb;
                    }
                }
            }
        }
    } catch (e) {}

    return termMb > 0 ? +termMb.toFixed(1) : 0;
}

// Замер памяти mpv (живой или калибровочный запуск)
function probeMpvRssMb() {
    if (cachedMpvMb !== null) return cachedMpvMb;

    try {
        var child = child_process.spawn('mpv', [
            '--idle=yes',
            '--vo=null',
            '--ao=null',
            '--no-config'
        ], { stdio: 'ignore' });

        child.on('error', function () {});

        if (child.pid) {
            var start = Date.now();
            while (Date.now() - start < 150) {
                // wait
            }

            var memMb = getProcessRssMb(child.pid);
            try {
                child.kill('SIGKILL');
            } catch (e) {}

            if (memMb > 10) {
                cachedMpvMb = memMb;
                return memMb;
            }
        }
    } catch (e) {}

    cachedMpvMb = 82.0;
    return cachedMpvMb;
}

// Мгновенный отчет о памяти
function getMemoryStats(activeMpvPid) {
    var nodeMem = process.memoryUsage();
    var nodeRssMb = +(nodeMem.rss / (1024 * 1024)).toFixed(1);
    var nodeHeapMb = +(nodeMem.heapUsed / (1024 * 1024)).toFixed(1);

    var mpvRssMb = 0;
    var mpvIsActive = false;

    if (activeMpvPid) {
        mpvRssMb = getProcessRssMb(activeMpvPid);
        if (mpvRssMb > 0) {
            mpvIsActive = true;
            cachedMpvMb = mpvRssMb;
        }
    }

    if (mpvRssMb === 0) {
        mpvRssMb = cachedMpvMb || probeMpvRssMb();
    }

    var termRssMb = getTerminalRssMb();
    var totalMb = +(nodeRssMb + mpvRssMb + (termRssMb > 0 ? termRssMb : 0)).toFixed(1);

    return {
        runtime: runtimeName,
        isBun: isBun,
        ktw: nodeRssMb,
        heap: nodeHeapMb,
        mpv: mpvRssMb,
        mpvActive: mpvIsActive,
        terminal: termRssMb,
        total: totalMb
    };
}

module.exports = {
    runtimeName: runtimeName,
    isBun: isBun,
    getMemoryStats: getMemoryStats,
    probeMpvRssMb: probeMpvRssMb,
    getProcessRssMb: getProcessRssMb,
    getTerminalRssMb: getTerminalRssMb
};
