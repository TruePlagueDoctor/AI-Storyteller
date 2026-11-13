// Отдельная модель для составления описания картинки (тегов): портрет, сцена, статья кодекса.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply } from './fake-llm.js';
import { artModelOf } from '../src/llm.js';
import { portraitTags, sceneTags, codexTags } from '../src/art.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

test('модель для картинок: своя, иначе модель учёта, иначе модель рассказа', () => {
  assert.equal(artModelOf({ model: 'a/story', toolModel: 'b/tools', artModel: ' c/art ' }), 'c/art');
  assert.equal(artModelOf({ model: 'a/story', toolModel: 'b/tools', artModel: '' }), 'b/tools');
  assert.equal(artModelOf({ model: 'a/story', toolModel: '' }), 'a/story');
});

test('все три вида тегов составляет выбранная модель; при отказе из-за содержания — запасная', async () => {
  const st = makeState({ model: 'a/story', toolModel: 'b/tools', artModel: 'c/art', fallbackModel: 'd/backup' });
  const seen = [];
  const answer = (text) => (body) => { seen.push(body.model); return reply(text); };
  fake = installFakeFetch([
    answer('1girl, adult, red hair'),
    answer('{"moment": "у ворот", "characters": [], "tags": "gate, night"}'),
    answer('ghoul, graveyard, full body'),
  ]);
  await portraitTags({ state: st, apiKey: 'k', subject: { name: 'Мара', kind: 'npc', appearance: 'рыжая, взрослая' } });
  await sceneTags({ state: st, apiKey: 'k', ctx: { text: 'Ты стоишь у ворот ночью.', before: [], present: [] } });
  await codexTags({ state: st, apiKey: 'k', entry: { title: 'Гуль', kind: 'creature', brief: 'Трупоед.', fields: {} } });
  assert.deepEqual(seen, ['c/art', 'c/art', 'c/art']);
  fake.restore();
  fake = installFakeFetch([
    { status: 400, text: '{"error":{"message":"PROHIBITED_CONTENT"}}' },
    (body) => { assert.equal(body.model, 'd/backup'); return reply('1girl, adult'); },
  ]);
  await portraitTags({ state: st, apiKey: 'k', subject: { name: 'Мара', kind: 'npc', appearance: 'рыжая, взрослая' } });
});
