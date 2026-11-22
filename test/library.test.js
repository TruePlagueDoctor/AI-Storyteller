// Библиотека персонажей: общая для всех историй; из неё берут копию героем или НПС, в неё сохраняют понравившихся.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, PNG } from './harness.js';

let stack; let api;
before(async () => { stack = await startStack(); ({ api } = stack); });
after(() => stack?.stop());
const png = 'data:image/png;base64,' + PNG.toString('base64');

test('НПС сохраняется в библиотеку без привязанного к истории и берётся в другую историю копией', async () => {
  let { data } = await api('POST', '/api/npcs', { name: 'Лилит', description: 'Суккуб, хозяйка купален', appearance: 'рыжая, взрослая', personality: 'насмешлива',
    wants: 'власти', secret: 'служит культу', race: 'суккуб', traits: ['хитрый'], competence: 'мастер', skills: ['обольщение'], voiceStyle: 'тянет слова',
    voiceSamples: ['Ну-ну, милый.'], attitude: 'заигрывает', history: 'поила героя вином', status: 'в купальнях', mood: 'довольна', self: true });
  const lilith = data.npcs.find((n) => n.name === 'Лилит');
  await api('POST', `/api/npcs/${lilith.id}/avatar`, { dataUrl: png });
  let r = await api('POST', '/api/library', { kind: 'npc', id: lilith.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const item = r.data.items.find((x) => x.name === 'Лилит');
  assert.equal(item.from, 'npc');
  assert.equal(item.card.secret, 'служит культу');
  assert.equal(item.card.self, true);
  assert.deepEqual(item.card.voiceSamples, ['Ну-ну, милый.']);
  for (const k of ['attitude', 'history', 'status', 'mood', 'lastSeen', 'perHero']) assert.equal(item.card[k], undefined, `${k} — из истории, в библиотеку не идёт`);
  assert.ok(item.avatar && item.avatar !== (await api('GET', '/api/state')).data.npcs.find((n) => n.id === lilith.id).avatar, 'портрет — своя копия файла');
  assert.equal((await fetch(`${stack.base}/avatars/${item.avatar}`)).status, 200);

  // Повторное сохранение обновляет запись, а не плодит вторую.
  await api('PUT', `/api/npcs/${lilith.id}`, { wants: 'свободы' });
  r = await api('POST', '/api/library', { kind: 'npc', id: lilith.id });
  assert.equal(r.data.items.filter((x) => x.name === 'Лилит').length, 1);
  assert.equal(r.data.items.find((x) => x.name === 'Лилит').card.wants, 'свободы');
  assert.equal(r.data.updated, true);
  const fresh = r.data.items.find((x) => x.name === 'Лилит'); // при обновлении портрет библиотеки пересоздаётся
  assert.equal((await fetch(`${stack.base}/avatars/${item.avatar}`)).status, 404, 'прежняя копия портрета убрана');

  // Другая история: библиотека та же, персонаж берётся копией.
  await api('POST', '/api/slots', { name: 'Вторая история' });
  assert.equal((await api('GET', '/api/state')).data.npcs.length, 0);
  assert.equal((await api('GET', '/api/library')).data.items.length, 1);
  r = await api('POST', `/api/library/${fresh.id}/import`, { as: 'npc' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const copy = r.data.npcs.find((n) => n.name === 'Лилит');
  assert.equal(copy.secret, 'служит культу');
  assert.equal(copy.wants, 'свободы');
  assert.equal(copy.self, true);
  assert.equal(copy.attitude, '');
  assert.equal(copy.history, '');
  assert.ok(copy.avatar && copy.avatar !== fresh.avatar, 'в историю идёт своя копия портрета');
  // Удалили портрет в истории — портрет в библиотеке цел.
  await api('DELETE', `/api/npcs/${copy.id}/avatar`);
  assert.equal((await fetch(`${stack.base}/avatars/${fresh.avatar}`)).status, 200);

  // Второй раз с тем же именем — спрашивает.
  r = await api('POST', `/api/library/${fresh.id}/import`, { as: 'npc' });
  assert.equal(r.status, 409);
  assert.equal(r.data.duplicate, true);
  r = await api('POST', `/api/library/${fresh.id}/import`, { as: 'npc', force: true });
  assert.equal(r.data.npcs.filter((n) => n.name === 'Лилит').length, 2);
});

test('НПС из библиотеки можно взять героем; герой сохраняется с умениями, но без предметов и показателей', async () => {
  const lib = (await api('GET', '/api/library')).data.items;
  // В этой истории Лилит уже есть как НПС — берём героем явно, «всё равно добавить».
  assert.equal((await api('POST', `/api/library/${lib[0].id}/import`, { as: 'hero', separate: true })).status, 409);
  let r = await api('POST', `/api/library/${lib[0].id}/import`, { as: 'hero', separate: true, force: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const hero = r.data.characters.find((c) => c.name === 'Лилит');
  assert.equal(r.data.activeCharacterId, hero.id);
  assert.match(hero.persona, /Суккуб, хозяйка купален/);
  assert.match(hero.persona, /насмешлива/);
  assert.equal(hero.race, 'суккуб');
  assert.equal(hero.appearance, 'рыжая, взрослая');
  assert.ok(r.data.soloHeroes.includes(hero.id), '«своя отдельная история» учитывается');
  assert.ok(hero.blocks.some((b) => b.type === 'ability' && b.name === 'обольщение'), 'умения НПС становятся умениями героя');

  await api('POST', `/api/characters/${hero.id}/blocks`, { type: 'ability', name: 'Фехтование', value: 'опытный' });
  await api('POST', `/api/characters/${hero.id}/blocks`, { type: 'item', name: 'Кинжал' });
  await api('POST', `/api/characters/${hero.id}/blocks`, { type: 'stat', name: 'Здоровье', value: '5', max: 10 });
  await api('PUT', `/api/characters/${hero.id}`, { name: 'Лилит Алая', social: 'беглая жрица', attrs: { 'Обаяние': 5, 'Сила': 2 } });
  r = await api('POST', '/api/library', { kind: 'hero', id: hero.id });
  const saved = r.data.items.find((x) => x.name === 'Лилит Алая');
  assert.equal(saved.from, 'hero');
  assert.equal(saved.card.social, 'беглая жрица');
  assert.deepEqual(saved.abilities.map((a) => `${a.name}:${a.value}`).sort(), ['Холодное оружие:опытный', 'обольщение:'], 'умение легло на навык из списка, особое осталось талантом');
  assert.deepEqual(saved.attrs, { str: 2, dex: 3, int: 3, wil: 3, cha: 5 }, 'характеристики сохраняются вместе с героем');
  assert.ok(!JSON.stringify(saved).includes('Кинжал') && !JSON.stringify(saved).includes('Здоровье'));

  // Бывшего героя — в историю как НПС.
  r = await api('POST', `/api/library/${saved.id}/import`, { as: 'npc', force: true }); // герой с этим именем тут уже есть
  const asNpc = r.data.npcs.find((n) => n.name === 'Лилит Алая');
  assert.match(asNpc.description, /Суккуб, хозяйка купален/);
  assert.deepEqual(asNpc.skills.sort(), ['Холодное оружие', 'обольщение']);
});

test('файл: персонаж выгружается с портретом и загружается обратно; мусор не принимается; удаление убирает и портрет', async () => {
  const lib = (await api('GET', '/api/library')).data.items;
  const first = lib.find((x) => x.name === 'Лилит');
  const file = await fetch(`${stack.base}/api/library/${first.id}/export`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') || '', /attachment/);
  const doc = await file.json();
  assert.equal(doc.format, 'chronicle-character');
  assert.match(doc.avatarData, /^data:image\/png;base64,/);

  let r = await api('DELETE', `/api/library/${first.id}`);
  assert.ok(!r.data.items.some((x) => x.id === first.id));
  assert.equal((await fetch(`${stack.base}/avatars/${first.avatar}`)).status, 404);

  r = await api('POST', '/api/library/upload', { file: doc });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const back = r.data.items.find((x) => x.name === 'Лилит');
  assert.equal(back.card.secret, 'служит культу');
  assert.equal((await fetch(`${stack.base}/avatars/${back.avatar}`)).status, 200);

  assert.equal((await api('POST', '/api/library/upload', { file: { hello: 'world' } })).status, 400);
  assert.equal((await api('POST', '/api/library/upload', { file: { format: 'chronicle-character', name: '', card: {} } })).status, 400);
  assert.equal((await api('POST', '/api/library/x/import', { as: 'npc' })).status, 404);
});
