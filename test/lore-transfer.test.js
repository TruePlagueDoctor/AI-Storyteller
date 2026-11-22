import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, PNG } from './harness.js';

test('импорт лорбука: проверка всего файла, дубли, связи, иллюстрации и независимость историй', async () => {
  const s = await startStack();
  try {
    const req = async (method, path, data) => {
      const r = await s.api(method, path, data);
      assert.equal(r.status, 200, JSON.stringify(r.data.error));
      return r.data;
    };
    const entries = [
      { title: 'Речной народ', kind: 'people', fields: { customs: 'Ходят под парусом' }, relations: [{ to: 'Лесной народ', text: 'Союзники' }], always: true, enabled: false, content: 'Старинный текст.', keys: ['река'], brief: 'Лодочники' },
      { id: 'second', title: 'Лесной народ', kind: 'people', content: 'Жители леса', locked: true, author: 'narrator', imageData: 'data:image/png;base64,' + PNG.toString('base64') },
    ];
    await req('POST', '/api/action', { text: 'Начинаю в порту.' });
    const bad = await s.api('POST', '/api/lore/import', [...entries, { title: 'Ошибка', relations: 'не массив' }]);
    assert.equal(bad.status, 400);
    assert.equal((await req('GET', '/api/state')).lorebook.length, 0);
    const first = await req('POST', '/api/lore/import', entries);
    assert.equal(first.imported, 2);
    assert.deepEqual(first.skipped, []);
    assert.equal(first.lorebook[0].enabled, false);
    assert.deepEqual(first.lorebook[0].relations, entries[0].relations);
    const replay = await req('POST', '/api/regenerate');
    assert.deepEqual(replay.lorebook, first.lorebook);
    await req('PUT', '/api/lore/second', { content: 'Местная редакция' });
    const again = await req('POST', '/api/lore/import', entries);
    assert.equal(again.imported, 0);
    assert.deepEqual(again.skipped, entries.map((e) => e.title));
    const book = await req('GET', '/api/lore/export');
    assert.equal(book.entries[1].content, 'Местная редакция');
    assert.equal(book.entries[1].imageData, entries[1].imageData);
    await req('POST', '/api/slots', { name: 'Другая история' });
    assert.equal((await s.api('POST', '/api/lore/import?slot=' + first.activeSlotId, book)).status, 409);
    assert.equal((await req('GET', '/api/state')).lorebook.length, 0);
    const copied = await req('POST', '/api/lore/import', book);
    assert.notEqual(copied.lorebook[1].image, first.lorebook[1].image);
    assert.deepEqual(await req('GET', '/api/lore/export'), book);
    await req('POST', '/api/slots/' + first.activeSlotId + '/activate');
    assert.deepEqual(await req('GET', '/api/lore/export'), book);
  } finally { s.stop(); }
});
