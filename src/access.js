// Кто может открыть игру. По умолчанию — только этот компьютер: сервер слушает лишь локальный адрес.
// Из локальной сети (телефон, второй компьютер) — только если в .env явно включено LAN_ACCESS=1
// и задан пароль LAN_PASSWORD: иначе любой в той же сети мог бы читать партии и тратить ключ OpenRouter.
// Плюс защита от чужих сайтов в браузере игрока: запрос с чужой страницы (Origin) и запрос под чужим
// именем узла (подмена адреса, DNS rebinding) отклоняются.

import { createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export function accessConfig(env = process.env) {
  const wanted = env.LAN_ACCESS === '1';
  const password = String(env.LAN_PASSWORD || '');
  return { wanted, password, lan: wanted && password.length > 0 };
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
const hostOnly = (h) => { const s = String(h || '').trim().toLowerCase(); return s.startsWith('[') ? s.slice(0, s.indexOf(']') + 1) : s.split(':')[0]; };
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h);
const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));

const MAX_FAILS = 10; const FAIL_WINDOW_MS = 60000;

export function accessGuard({ lan, password }) {
  const fails = new Map(); // адрес → [время неудачных попыток]
  return (req, res, next) => {
    // Имя узла: свой компьютер, адрес цифрами или имя в домашней сети. Чужое имя — подмена адреса.
    const host = hostOnly(req.headers.host);
    const hostOk = host === 'localhost' || isIp(host) || (lan && host.endsWith('.local'));
    if (!hostOk) return res.status(403).type('text/plain; charset=utf-8').send('Запрос под чужим именем узла отклонён.');
    // Запрос со страницы другого сайта: браузер честно называет её в Origin.
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let from = '';
      try { from = new URL(origin).host.toLowerCase(); } catch { /* кривой Origin — чужой */ }
      if (from !== String(req.headers.host || '').toLowerCase()) return res.status(403).json({ error: 'Запрос с чужой страницы отклонён.' });
    } else if (origin === 'null' && req.method !== 'GET') {
      return res.status(403).json({ error: 'Запрос с чужой страницы отклонён.' });
    }
    if (isLoopback(req.socket.remoteAddress)) return next();
    if (!lan) return res.status(403).type('text/plain; charset=utf-8').send('Доступ из сети выключен.');
    // Из сети — по паролю (обычное окно входа браузера; имя пользователя любое).
    const addr = req.socket.remoteAddress || '?';
    const now = Date.now();
    const recent = (fails.get(addr) || []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (recent.length >= MAX_FAILS) return res.status(429).type('text/plain; charset=utf-8').send('Слишком много неверных попыток. Подожди минуту.');
    const m = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
    let given = null;
    if (m) { const raw = Buffer.from(m[1], 'base64').toString('utf8'); given = raw.slice(raw.indexOf(':') + 1); }
    if (given !== null && same(given, password)) { fails.delete(addr); return next(); }
    if (given !== null) { recent.push(now); fails.set(addr, recent); }
    res.setHeader('WWW-Authenticate', 'Basic realm="Chronicle", charset="UTF-8"');
    res.status(401).type('text/plain; charset=utf-8').send('Нужен пароль (LAN_PASSWORD из файла .env на компьютере с игрой).');
  };
}

// Адреса этого компьютера в локальной сети — чтобы подсказать, что открыть на телефоне.
export function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}
