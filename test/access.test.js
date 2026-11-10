// Доступ к игре: по умолчанию только с этого компьютера; из сети — по явной настройке и с паролем;
// чужой сайт в браузере игрока не может дёргать сервер.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { startStack } from './harness.js';

const lanIp = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
const viaLan = (stack, path, init) => fetch(stack.base.replace('127.0.0.1', lanIp) + path, init);
const basic = (pass) => ({ Authorization: 'Basic ' + Buffer.from('player:' + pass).toString('base64') });

test('по умолчанию сервер слушает только этот компьютер', { skip: !lanIp && 'нет сетевого адреса' }, async () => {
  const stack = await startStack();
  try {
    assert.equal((await stack.api('GET', '/api/state')).status, 200);
    await assert.rejects(viaLan(stack, '/api/state'), 'по сетевому адресу соединение не принимается');
  } finally { stack.stop(); }
});

test('доступ из сети: только с паролем; с этого компьютера — без него', { skip: !lanIp && 'нет сетевого адреса' }, async () => {
  const stack = await startStack({ env: { LAN_ACCESS: '1', LAN_PASSWORD: 'сова-и-ключ' } });
  try {
    assert.equal((await stack.api('GET', '/api/state')).status, 200, 'свой компьютер пароля не спрашивает');
    const none = await viaLan(stack, '/api/state');
    assert.equal(none.status, 401);
    assert.match(none.headers.get('www-authenticate') || '', /Basic/);
    assert.equal((await viaLan(stack, '/', { headers: basic('не тот') })).status, 401, 'и страница, и API закрыты');
    assert.equal((await viaLan(stack, '/api/state', { headers: basic('сова-и-ключ') })).status, 200);
    assert.match(stack.output, /Открыт доступ из локальной сети/);
  } finally { stack.stop(); }
});

test('доступ из сети без пароля не открывается', { skip: !lanIp && 'нет сетевого адреса' }, async () => {
  const stack = await startStack({ env: { LAN_ACCESS: '1' } });
  try {
    await assert.rejects(viaLan(stack, '/api/state'));
    assert.match(stack.output, /LAN_PASSWORD/);
  } finally { stack.stop(); }
});

test('чужой сайт в браузере не может менять игру, а чужое имя узла не принимается', async () => {
  const stack = await startStack();
  try {
    await stack.api('POST', '/api/settings', { worldPrompt: 'Мир на месте' });
    const evil = await fetch(stack.base + '/api/reset', { method: 'POST', headers: { Origin: 'http://evil.example' } });
    assert.equal(evil.status, 403);
    const own = await fetch(stack.base + '/api/settings', { method: 'POST', headers: { Origin: stack.base, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(own.status, 200, 'запросы самой страницы игры проходят');
    // Подмена адреса (DNS rebinding): запрос пришёл на этот компьютер, но под чужим именем узла.
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const u = new URL(stack.base);
      const r = request({ host: u.hostname, port: u.port, path: '/api/state', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject); r.end();
    });
    assert.equal(status, 403);
    assert.equal((await stack.api('GET', '/api/state')).data.worldPrompt, 'Мир на месте');
  } finally { stack.stop(); }
});
