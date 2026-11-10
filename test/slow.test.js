// Зависший запрос «играющего сам» персонажа не должен держать ход: у него свой короткий предел ожидания.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reply, call } from './fake-llm.js';
import { startStack, defaultHandlers } from './harness.js';

test('персонаж «играет сам» завис — ход идёт дальше без него', async () => {
  const handlers = defaultHandlers();
  const stack = await startStack({ handlers, env: { VOICE_TIMEOUT_MS: '300' } });
  try {
    const { api } = stack;
    handlers.narrator = () => reply('Ты стоишь у ворот. Ольт смотрит на тебя.');
    handlers.sync = () => reply('', [call('nothing', {})]);
    await api('POST', '/api/action', { text: 'Иду к воротам' });
    await api('POST', '/api/npcs', { name: 'Ольт', description: 'Стражник', self: true });
    await api('PUT', '/api/scene', { location: 'Ворота', present: 'Ольт' });
    handlers.voice = () => new Promise(() => {}); // не отвечает никогда
    handlers.narrator = () => reply('Ольт молчит и смотрит мимо тебя.');
    const t0 = Date.now();
    const res = await api('POST', '/api/action', { text: 'Ольт, пропусти' });
    assert.equal(res.status, 200);
    assert.ok(Date.now() - t0 < 5000, `ход занял ${Date.now() - t0} мс`);
    const last = res.data.log.at(-1);
    assert.match(last.text, /Ольт молчит/);
    assert.equal(last.voices, undefined);
    assert.match(last.voiceNote || '', /Ольт/, 'под ответом сказано, что персонаж не успел ответить');
  } finally { stack.stop(); }
});
