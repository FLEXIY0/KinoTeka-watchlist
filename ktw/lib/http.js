'use strict';

// Общий HTTP-слой для экстракторов и доктора.
//
// Балансеры отвечают только на запросы, похожие на браузерные: без User-Agent
// и Referer прилетает 403, а при отказе по региону — 404/410 с человеческим
// текстом внутри HTML. Раньше такие ответы молча превращались в null, и
// пользователь видел «поток не найден» вместо «недоступно в твоём регионе».

var USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

var DEFAULT_TIMEOUT = 15000;

// Текст, которым балансеры сообщают об отказе по региону
var GEO_RE = /(в\s+вашем\s+регионе|вашего\s+региона|в\s+вашей\s+стране|not\s+available\s+in\s+your\s+(region|country)|geo[\s-]?block)/i;

function BalancerError(message, code, extra) {
    var err = new Error(message);
    err.name = 'BalancerError';
    err.code = code || 'failed';

    if (extra) {
        Object.keys(extra).forEach(function (key) { err[key] = extra[key]; });
    }

    return err;
}

// Человеческое описание сетевой ошибки: причина прячется в err.cause
function describeNetworkError(err) {
    var cause = (err && err.cause) || null;
    var code = (cause && cause.code) || (err && err.code) || '';

    switch (code) {
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return 'не разрешается имя хоста — нет интернета, не работает DNS или домен режет провайдер';
        case 'ECONNREFUSED':
            return 'соединение отклонено';
        case 'ECONNRESET':
            return 'соединение сброшено — обычно так рвёт DPI провайдера';
        case 'ETIMEDOUT':
        case 'UND_ERR_CONNECT_TIMEOUT':
        case 'UND_ERR_HEADERS_TIMEOUT':
            return 'хост не отвечает';
        case 'CERT_HAS_EXPIRED':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
            return 'проблема с сертификатом — возможно, трафик идёт через прокси';
        default:
            return (cause && cause.message) || (err && err.message) || 'неизвестная ошибка';
    }
}

// Отказ по региону виден и по коду, и по тексту страницы
function detectRefusal(status, body) {
    if (GEO_RE.test(body || '')) return 'geo';
    if (status === 451) return 'geo';
    if (status === 410) return 'gone';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'notfound';
    if (status >= 500) return 'server';
    if (status >= 400) return 'http';

    return null;
}

function refusalMessage(code, status, host) {
    switch (code) {
        case 'geo':      return host + ': контент недоступен в твоём регионе';
        case 'gone':     return host + ': балансер удалил эту раздачу (HTTP 410)';
        case 'forbidden':return host + ': балансер не пустил запрос (HTTP 403) — обычно чужой Referer или регион';
        case 'notfound': return host + ': ссылка на плеер протухла (HTTP 404)';
        case 'server':   return host + ': ошибка на стороне балансера (HTTP ' + status + ')';
        default:         return host + ': HTTP ' + status;
    }
}

// GET с таймаутом; тело отдаётся всегда, даже при ошибочном коде —
// именно в нём балансер объясняет причину отказа
async function request(url, options) {
    options = options || {};

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, options.timeout || DEFAULT_TIMEOUT);

    var headers = Object.assign({
        'User-Agent': options.userAgent || USER_AGENT,
        'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
    }, options.headers || {});

    if (options.referer) headers['Referer'] = options.referer;
    if (options.origin) headers['Origin'] = options.origin;

    var res;

    try {
        res = await fetch(url, {
            method: options.method || 'GET',
            headers: headers,
            body: options.body,
            redirect: 'follow',
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw BalancerError(hostOf(url) + ': не ответил за ' +
                Math.round((options.timeout || DEFAULT_TIMEOUT) / 1000) + ' с', 'timeout');
        }

        throw BalancerError(hostOf(url) + ': ' + describeNetworkError(err), 'network');
    } finally {
        clearTimeout(timer);
    }

    var text = '';
    try { text = await res.text(); } catch (err) { text = ''; }

    return {
        ok: res.ok,
        status: res.status,
        url: res.url || url,
        headers: res.headers,
        body: text
    };
}

// GET, который сам превращает отказ балансера в понятную ошибку
async function requestOk(url, options) {
    var res = await request(url, options);

    if (!res.ok) {
        var code = detectRefusal(res.status, res.body) || 'http';
        throw BalancerError(refusalMessage(code, res.status, hostOf(url)), code, { status: res.status });
    }

    // Ответ 200, но внутри страница «недоступно в вашем регионе»
    if (res.status === 200 && GEO_RE.test(res.body)) {
        var hasContent = /fileList\s*=|makePlayer|ENV_BASE_URL|player-venom|videoInfo|urlParams|#EXTM3U/i.test(res.body);
        if (!hasContent && res.body.length < 5000) {
            throw BalancerError(refusalMessage('geo', 200, hostOf(url)), 'geo', { status: 200 });
        }
    }

    return res;
}

function hostOf(url) {
    try {
        return new URL(url).hostname;
    } catch (err) {
        return String(url).slice(0, 40);
    }
}

module.exports = {
    USER_AGENT: USER_AGENT,
    BalancerError: BalancerError,
    describeNetworkError: describeNetworkError,
    detectRefusal: detectRefusal,
    refusalMessage: refusalMessage,
    request: request,
    requestOk: requestOk,
    hostOf: hostOf
};
