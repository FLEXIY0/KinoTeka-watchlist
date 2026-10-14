'use strict';

// Модуль интеграции с Donatty API (топ донатеров и последние донаты)
var https = require('https');

var STATS_WIDGET_REF = '1915b994-f3c4-4819-825a-db5eb13aa712';
var STATS_WIDGET_TOKEN = 'zsJlvYkzdS4sDQOAjy9eC05GlBS95z';

var cachedDonators = null;
var lastFetchTime = 0;
var isFetching = false;

function fetchTopDonators(ref, token) {
    ref = ref || STATS_WIDGET_REF;
    token = token || STATS_WIDGET_TOKEN;

    return new Promise(function (resolve) {
        var tokenUrl = 'https://api.donatty.com/auth/tokens/' + token;
        var tokenReq = https.get(tokenUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Origin': 'https://widgets.donatty.com',
                'Referer': 'https://widgets.donatty.com/'
            },
            timeout: 4000
        }, function (r) {
            var chunks = [];
            r.on('data', function (d) { chunks.push(d); });
            r.on('end', function () {
                try {
                    var parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    var jwt = parsed.response ? parsed.response.accessToken : (parsed.accessToken || null);
                    if (!jwt) return resolve([]);

                    var sseUrl = 'https://api.donatty.com/widgets/' + ref + '/sse?jwt=' + encodeURIComponent(jwt) + '&zoneOffset=' + (new Date().getTimezoneOffset());
                    var sseReq = https.get(sseUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Origin': 'https://widgets.donatty.com',
                            'Referer': 'https://widgets.donatty.com/'
                        },
                        timeout: 5000
                    }, function (sseRes) {
                        var buffer = '';
                        var resolved = false;

                        var timer = setTimeout(function () {
                            if (!resolved) {
                                resolved = true;
                                try { sseReq.destroy(); } catch (e) {}
                                resolve([]);
                            }
                        }, 4000);

                        sseRes.on('data', function (chunk) {
                            buffer += chunk.toString('utf8');
                            var lines = buffer.split('\n');
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i].trim();
                                if (line.indexOf('data:') === 0) {
                                    try {
                                        var eventData = JSON.parse(line.slice(5).trim());
                                        if (eventData.action === 'DATA' && eventData.data && Array.isArray(eventData.data.list)) {
                                            if (!resolved) {
                                                resolved = true;
                                                clearTimeout(timer);
                                                try { sseReq.destroy(); } catch (e) {}
                                                resolve(eventData.data.list);
                                                return;
                                            }
                                        }
                                    } catch (e) {}
                                }
                            }
                        });

                        sseRes.on('error', function () {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timer);
                                resolve([]);
                            }
                        });
                    });

                    sseReq.on('error', function () { resolve([]); });
                    sseReq.on('timeout', function () {
                        try { sseReq.destroy(); } catch (e) {}
                        resolve([]);
                    });
                } catch (e) {
                    resolve([]);
                }
            });
        });

        tokenReq.on('error', function () { resolve([]); });
        tokenReq.on('timeout', function () {
            try { tokenReq.destroy(); } catch (e) {}
            resolve([]);
        });
    });
}

function updateCacheInBackground() {
    if (isFetching) return;
    var now = Date.now();
    if (cachedDonators && (now - lastFetchTime < 300000)) return; // 5 минут кеш

    isFetching = true;
    fetchTopDonators().then(function (list) {
        isFetching = false;
        if (list && list.length > 0) {
            cachedDonators = list;
            lastFetchTime = Date.now();
        }
    }).catch(function () {
        isFetching = false;
    });
}

function getCachedDonators() {
    updateCacheInBackground();
    return cachedDonators || [];
}

function formatDonatorsBanner(donators, maxWidth) {
    maxWidth = maxWidth || 80;
    if (!donators || donators.length === 0) {
        return 'Поддержать проект: donatty.com/nedoedal';
    }

    var medals = ['1.', '2.', '3.'];
    var parts = donators.slice(0, 3).map(function (d, idx) {
        var rank = medals[idx] || '•';
        var valStr = d.value ? (d.value + ' ₽') : '';
        return rank + ' ' + d.name + (valStr ? (' (' + valStr + ')') : '');
    });

    var text = 'Топ поддержки: ' + parts.join('  ') + '  ·  donatty.com/nedoedal';
    return text;
}

module.exports = {
    fetchTopDonators: fetchTopDonators,
    getCachedDonators: getCachedDonators,
    formatDonatorsBanner: formatDonatorsBanner
};
