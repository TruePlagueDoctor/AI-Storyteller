// Сквозной тест: настоящий server.js в отдельном процессе, вместо OpenRouter и
// Automatic1111 — поддельный сервер в этом процессе. Проверяем путь хода целиком.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reply, call } from './fake-llm.js';
import { startStack, defaultHandlers } from './harness.js';

const handlers = defaultHandlers();
let stack; let seen; let api;
before(async () => {
  stack = await startStack({ handlers });
  ({ seen, api } = stack);
});
after(() => stack?.stop());
const base = () => stack.base;

const lastNarr = (st) => [...st.log].reverse().find((e) => e.role === 'narrator');

test('страница и состояние отдаются', async () => {
  const page = await fetch(base() + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script src="js\/core.js/);
  const { data } = await api('GET', '/api/state');
  assert.equal(data.hasKey, true);
  assert.equal(data.characters.length, 1);
  assert.equal(data.slots.length, 1);
});

test('начало игры: рассказ и учёт заводят лист героя', async () => {
  handlers.sync = () => reply('', [
    call('block', { type: 'stat', name: 'Здоровье', value: '10', max: 10 }),
    call('npc', { name: 'Ольт', attitude: 'насторожен', description: 'Стражник у ворот', wants: 'спокойной смены' }),
    call('scene', { location: 'Городские ворота', present: ['Ольт'], elapsed_minutes: 5 }),
  ]);
  const { status, data } = await api('POST', '/api/action', { text: '' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.match(data.narration, /Ольт/);
  assert.equal(data.log.length, 1, 'вступление без реплики игрока');
  const n = lastNarr(data);
  assert.equal(n.sync.status, 'done');
  assert.equal(n.variants, 1);
  assert.equal(data.characters[0].blocks[0].name, 'Здоровье');
  assert.equal(data.npcs[0].name, 'Ольт');
  assert.equal(data.scene.location, 'Городские ворота');
  assert.equal(data.turn, 1);
  assert.equal(data.canResync, true);
});

test('ход игрока, регенерация и свайп между вариантами', async () => {
  handlers.narrator = () => reply('Ольт пропускает тебя внутрь. «Проходи», — бурчит он.');
  handlers.sync = () => reply('', [call('block', { type: 'item', name: 'Пропуск' })]);
  let { data } = await api('POST', '/api/action', { text: 'Показываю бумаги' });
  assert.equal(data.log.length, 3);
  assert.ok(data.characters[0].blocks.some((b) => b.name === 'Пропуск'));

  handlers.narrator = () => reply('Ольт качает головой. «Не пущу», — говорит он.');
  handlers.sync = () => reply('', [call('npc', { name: 'Ольт', attitude: 'враждебен' })]);
  ({ data } = await api('POST', '/api/regenerate'));
  assert.equal(data.log.length, 3);
  assert.equal(lastNarr(data).variants, 2);
  assert.ok(!data.characters[0].blocks.some((b) => b.name === 'Пропуск'), 'мир прежнего варианта откатился');
  assert.equal(data.npcs[0].attitude, 'враждебен');
  assert.equal(data.turn, 2, 'регенерация не двигает номер хода дальше');

  ({ data } = await api('POST', '/api/log/2/swipe', { dir: -1 }));
  assert.match(lastNarr(data).text, /пропускает/);
  assert.ok(data.characters[0].blocks.some((b) => b.name === 'Пропуск'));
  assert.equal(data.npcs[0].attitude, 'насторожен');
});

test('сбой модели: реплика ждёт повтора, мир не испорчен', async () => {
  const before = (await api('GET', '/api/state')).data;
  handlers.narrator = () => ({ status: 503, text: 'overloaded' });
  let r = await api('POST', '/api/action', { text: 'Иду в город' });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /Сбой на стороне провайдера/);
  assert.equal(r.data.pendingTurn, true);
  const mid = (await api('GET', '/api/state')).data;
  assert.equal(mid.turn, before.turn);
  assert.equal(mid.log.at(-1).failed, true);

  handlers.narrator = () => reply('Улицы пусты. Где-то лает собака, и ветер гонит листья по мостовой.');
  handlers.sync = () => reply('', [call('nothing', {})]);
  r = await api('POST', '/api/retry');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.log.at(-2).text, 'Иду в город');
  assert.equal(r.data.log.at(-2).failed, undefined);
  assert.equal(r.data.turn, before.turn + 1);
  assert.equal((await api('POST', '/api/retry')).status, 400);
});

test('вне истории: без учёта и без броска', async () => {
  const count = seen.length;
  handlers.narrator = () => reply('Понял, буду короче.');
  const { data } = await api('POST', '/api/ooc', { text: 'Пиши короче' });
  assert.equal(data.log.at(-2).role, 'ooc');
  assert.equal(seen.slice(count).filter((x) => x.kind === 'sync').length, 0);
  assert.equal(seen.slice(count).filter((x) => x.kind === 'narrator')[0].body.tools, undefined);
  assert.equal((await api('POST', '/api/ooc', { text: ' ' })).status, 400);
});

test('договорить и переучесть другой моделью', async () => {
  handlers.narrator = () => reply('Ты идёшь к рынку, где торговцы раскладывают товар, и вдруг замечаешь');
  handlers.sync = () => reply('', [call('nothing', {})]);
  await api('POST', '/api/action', { text: 'Иду на рынок' });
  handlers.narrator = () => reply('кошель, лежащий в пыли у прилавка.');
  handlers.sync = () => reply('', [call('block', { type: 'item', name: 'Чужой кошель' })]);
  let { data } = await api('POST', '/api/continue');
  assert.match(lastNarr(data).text, /замечаешь кошель/);
  assert.ok(data.characters[0].blocks.some((b) => b.name === 'Чужой кошель'));

  handlers.sync = (body) => { assert.equal(body.model, 'other/model'); return reply('', [call('block', { type: 'item', name: 'Кошель с медью' })]); };
  ({ data } = await api('POST', '/api/resync', { model: 'other/model' }));
  const n = lastNarr(data);
  assert.equal(n.sync.model, 'other/model');
  assert.equal(n.syncHistory.length, 1);
  assert.ok(data.characters[0].blocks.some((b) => b.name === 'Кошель с медью'));
});

test('два хода одновременно — второй получает отказ', async () => {
  let release;
  handlers.narrator = () => new Promise((r) => { release = () => r(reply('Долгий ответ закончился, и наступила тишина над площадью.')); });
  const first = api('POST', '/api/action', { text: 'Жду' });
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 20));
  const second = await api('POST', '/api/regenerate');
  assert.equal(second.status, 409);
  assert.equal((await api('POST', '/api/log/0/truncate')).status, 409);
  assert.equal((await api('POST', '/api/slots', { name: 'x' })).status, 409, 'партию во время хода не сменить');
  assert.equal((await api('POST', '/api/reset')).status, 409);
  release();
  assert.equal((await first).status, 200);
});

test('сжатие истории идёт в фоне и сворачивает старые ходы', async () => {
  await api('POST', '/api/settings', { historyKeep: 6 });
  handlers.narrator = () => reply('Время идёт, и в городе ничего не меняется, кроме погоды над крышами.');
  handlers.sync = () => reply('', [call('nothing', {})]);
  handlers.summary = () => reply('Ян пришёл в город и бродил по рынку.');
  for (let i = 0; i < 3; i++) await api('POST', '/api/action', { text: `Жду ${i}` });
  let st;
  for (let i = 0; i < 50; i++) {
    st = (await api('GET', '/api/state')).data;
    if (st.summary && !st.compressing) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(st.summary, 'Ян пришёл в город и бродил по рынку.', stack.output.slice(-2000) + JSON.stringify(seen.filter((x) => x.kind === 'summary').length));
  const prompt = (await api('GET', '/api/prompt')).data;
  assert.match(prompt, /=== ПРЕДЫСТОРИЯ[\s\S]*бродил по рынку/);
});

test('обрезка и ветка через API', async () => {
  let { data } = await api('GET', '/api/state');
  const len = data.log.length;
  ({ data } = await api('POST', '/api/log/2/branch'));
  assert.equal(data.log.length, 3);
  assert.equal(data.slots.length, 2);
  const original = data.slots.find((x) => !x.active).id;
  ({ data } = await api('POST', `/api/slots/${original}/activate`));
  assert.equal(data.log.length, len);
  ({ data } = await api('POST', '/api/log/0/truncate'));
  assert.equal(data.log.length, 1);
  assert.equal(data.restored, true);
  assert.equal(data.npcs[0].name, 'Ольт', 'мир — как после вступления');
  assert.equal((await api('POST', '/api/log/99/truncate')).status, 400);
});

test('картинки: портрет и иллюстрация через Automatic1111', async () => {
  let { data } = await api('GET', '/api/state');
  const npc = data.npcs[0];
  handlers.other = () => reply('1boy, mature male, adult, guard, helmet');
  let r = await api('POST', `/api/npcs/${npc.id}/portrait`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.portrait.filename, /\.png$/);
  const img = await fetch(`${base()}/avatars/${r.data.portrait.filename}`);
  assert.equal(img.status, 200);

  handlers.other = () => reply('{"moment": "Ольт у ворот", "characters": ["Ольт"], "tags": "1boy, gate, night"}');
  r = await api('POST', '/api/log/0/scene-prompt');
  assert.equal(r.data.tags, '1boy, gate, night');
  r = await api('POST', '/api/log/0/illustrate', { tags: r.data.tags, moment: 'Ольт у ворот' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.image.seed, 42);
  ({ data } = await api('GET', '/api/state'));
  assert.equal(data.log[0].images.length, 1);
  r = await api('DELETE', '/api/log/0/images/0');
  assert.equal(r.data.log[0].images.length, 0);
  assert.equal((await api('POST', '/api/characters/x/avatar', { dataUrl: 'data:text/plain;base64,AAAA' })).status, 400);
});

test('✨ заполнить поле и диагностика запросов', async () => {
  const { data } = await api('GET', '/api/state');
  handlers.other = () => reply('Внешность: Коренастый стражник лет сорока.');
  let r = await api('POST', '/api/fill', { kind: 'npc', id: data.npcs[0].id, field: 'appearance', mode: 'text', card: { name: 'Ольт' } });
  assert.equal(r.data.value, 'Коренастый стражник лет сорока.');
  r = await api('POST', '/api/fill', { kind: 'npc', field: 'нет-такого' });
  assert.equal(r.status, 502);

  r = await api('GET', '/api/diag');
  assert.ok(r.data.items.length > 5);
  assert.ok(r.data.items.some((x) => x.status === 'error' && x.httpStatus === 503));
  const one = await api('GET', `/api/diag/${r.data.items[0].id}`);
  assert.ok(one.data.full.request.messages);
  handlers.other = () => reply('повтор');
  handlers.narrator = () => reply('повтор');
  handlers.sync = () => reply('повтор');
  const rep = await api('POST', `/api/diag/${r.data.items[0].id}/replay`, { model: 'm/other' });
  assert.equal(rep.data.summary.model, 'm/other');
});

test('ручные правки через API', async () => {
  let { data } = await api('GET', '/api/state');
  const hid = data.characters[0].id;
  ({ data } = await api('POST', `/api/characters/${hid}/blocks`, { type: 'item', name: 'Фонарь' }));
  const b = data.characters[0].blocks.find((x) => x.name === 'Фонарь');
  ({ data } = await api('DELETE', `/api/characters/${hid}/blocks/${b.id}`));
  assert.ok(!data.characters[0].blocks.some((x) => x.name === 'Фонарь'));
  ({ data } = await api('POST', '/api/lore', { title: 'Порт', keys: 'порт, гавань', content: 'Шумно' }));
  assert.deepEqual(data.lorebook[0].keys, ['порт', 'гавань']);
  ({ data } = await api('POST', '/api/threads', { title: 'Найти брата' }));
  assert.equal(data.threads[0].status, 'open');
  ({ data } = await api('PUT', '/api/scene', { location: 'Порт', locked: ['location'] }));
  assert.deepEqual(data.scene.locked, ['location']);
  ({ data } = await api('POST', '/api/traits/merge'));
  assert.ok(data.traitPool.length > 10);
  assert.equal((await api('PUT', '/api/characters/nope', { name: 'x' })).status, 400);
});

test('тренировка: опыт и рост уровня в ленте, регенерация откатывает', async () => {
  let { data } = await api('GET', '/api/state');
  const hid = data.characters[0].id;
  await api('POST', `/api/characters/${hid}/blocks`, { type: 'ability', name: 'Фехтование', value: 'новичок' });
  handlers.narrator = () => reply('Весь день мастер Горан гоняет тебя по двору: «Плечо ниже! Ещё раз!» К вечеру выпады выходят чище.');
  handlers.sync = () => reply('', [call('practice', { skill: 'Фехтование', kind: 'lesson', reason: 'урок у Горана' })]);
  ({ data } = await api('POST', '/api/action', { text: 'Учусь у Горана' }));
  const n = lastNarr(data);
  assert.ok(n.sync.calls.some((c) => c.name === 'practice' && /\+2 опыта/.test(c.result)), JSON.stringify(n.sync.calls));
  assert.equal(data.characters[0].skillXp['фехтование'], 2);
  handlers.sync = () => reply('', [call('nothing', {})]);
  handlers.narrator = () => reply('Ты весь день просидел в таверне, глядя, как дождь заливает двор.');
  ({ data } = await api('POST', '/api/regenerate'));
  assert.equal(data.characters[0].skillXp['фехтование'], undefined, 'опыт откатился вместе с ходом');
  assert.deepEqual(data.characters[0].practiceDays, {});
});

test('состав промта: разделы, история и счётчики', async () => {
  const { data } = await api('GET', '/api/prompt/breakdown');
  assert.ok(data.total > 0);
  const labels = data.sections.map((s) => s.label);
  assert.ok(labels.includes('Правила хода'));
  assert.ok(labels.includes('Герои'));
  assert.ok(labels.some((l) => l.startsWith('История дословно')));
  assert.equal(data.sections.reduce((a, s) => a + s.tokens, 0), data.total);
  assert.equal(typeof data.counts.npcs, 'number');
});

test('резервные копии: при запуске, по кнопке и восстановление новой историей', async () => {
  let r = await api('GET', '/api/backups');
  assert.ok(r.data.items.some((b) => b.reason === 'при запуске'), 'копия при запуске сервера');
  r = await api('POST', '/api/backups');
  const b = r.data.backup;
  const before = (await api('GET', '/api/state')).data;
  const slot = b.slots.find((x) => x.id === before.activeSlotId);
  r = await api('POST', `/api/backups/${b.id}/restore`, { slotId: slot.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slots.length, before.slots.length + 1);
  assert.match(r.data.slots.find((x) => x.active).name, /\(копия от /);
  assert.equal(r.data.log.length, before.log.length);
  assert.ok(r.data.log.every((e) => e.variants === undefined));
  assert.equal((await api('POST', `/api/backups/${b.id}/restore`, { slotId: 'нет' })).status, 400);
});

test('кодекс: статья с разделом и полями, ✨ выжимка одной и всем', async () => {
  let r = await api('POST', '/api/lore', { title: 'Упыри', kind: 'creature', content: 'Ночные трупоеды. Боятся огня.', fields: { danger: 3, weaknesses: 'огонь' } });
  const upyr = r.data.lorebook.find((e) => e.title === 'Упыри');
  assert.equal(upyr.kind, 'creature');
  assert.equal(upyr.fields.danger, 3);
  assert.ok(r.data.codexKinds.fields.creature.length > 3);
  handlers.other = (body) => { assert.match(body.messages[1].content, /Ночные трупоеды/); return reply('Ночные трупоеды, боятся огня.'); };
  r = await api('POST', '/api/lore/brief', { entry: upyr });
  assert.equal(r.data.brief, 'Ночные трупоеды, боятся огня.');
  r = await api('POST', '/api/lore', { title: 'Гномы', kind: 'people', content: 'Подгорный народ.', relations: [{ to: 'Эльфы', text: 'презирают' }] });
  handlers.other = () => reply('Коротко о статье.');
  r = await api('POST', '/api/lore/briefs');
  assert.ok(r.data.briefs.done >= 2, JSON.stringify(r.data.briefs));
  const g = r.data.lorebook.find((e) => e.title === 'Гномы');
  assert.equal(g.brief, 'Коротко о статье.');
  assert.equal(g.briefAuto, true);
  assert.deepEqual(g.relations, [{ to: 'Эльфы', text: 'презирают' }]);
  // Правка вручную снимает пометку ✨.
  r = await api('PUT', `/api/lore/${g.id}`, { brief: 'Своими словами.' });
  assert.equal(r.data.lorebook.find((e) => e.id === g.id).briefAuto, undefined);
});

test('ссылки «народ → статья кодекса» для досье', async () => {
  let r = await api('POST', '/api/lore', { title: 'Орки', kind: 'people', brief: 'Степные кланы.' });
  const orcs = r.data.lorebook.find((e) => e.title === 'Орки');
  r = await api('POST', '/api/npcs', { name: 'Грок', race: 'степной орк' });
  const grok = r.data.npcs.find((n) => n.name === 'Грок');
  assert.equal(grok.race, 'степной орк');
  assert.equal(r.data.codexLinks[grok.id], orcs.id);
  r = await api('POST', '/api/npcs', { name: 'Безродный', race: 'дух' });
  assert.equal(r.data.codexLinks[r.data.npcs.find((n) => n.name === 'Безродный').id], undefined);
});

test('иллюстрация статьи кодекса: теги от модели, своя картинка, удаление', async () => {
  let r = await api('POST', '/api/lore', { title: 'Виверна', kind: 'creature', brief: 'Летучий ящер с ядовитым хвостом.', fields: { danger: 4 } });
  const id = r.data.lorebook.find((e) => e.title === 'Виверна').id;
  handlers.other = (body) => { assert.match(body.messages[0].content, /существо целиком/); return reply('wyvern, dragon, flying, mountains, storm'); };
  r = await api('POST', `/api/lore/${id}/illustrate`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let e = r.data.lorebook.find((x) => x.id === id);
  assert.equal(e.imageTags, 'wyvern, dragon, flying, mountains, storm');
  assert.ok(!/upper body|looking at viewer/.test(r.data.illustration.prompt), 'портретные теги стиля убраны');
  assert.match(r.data.illustration.prompt, /full body/);
  assert.equal((await fetch(`${base()}/avatars/${e.image}`)).status, 200);
  const first = e.image;
  // Перерисовка по своим тегам — без запроса к модели, прежний файл удаляется.
  handlers.other = () => { throw new Error('модель не должна вызываться'); };
  r = await api('POST', `/api/lore/${id}/illustrate`, { tags: 'wyvern, night' });
  e = r.data.lorebook.find((x) => x.id === id);
  assert.notEqual(e.image, first);
  assert.equal((await fetch(`${base()}/avatars/${first}`)).status, 404);
  r = await api('DELETE', `/api/lore/${id}/image`);
  assert.equal(r.data.lorebook.find((x) => x.id === id).image, undefined);
});

test('настройки качества картинок сохраняются', async () => {
  let r = await api('GET', '/api/state');
  assert.equal(r.data.handFix, true);
  assert.equal(r.data.portraitHires, true);
  assert.equal(r.data.imageScheduler, 'Karras');
  r = await api('POST', '/api/settings', { handFix: false, portraitHires: false, imageScheduler: '' });
  assert.equal(r.data.handFix, false);
  assert.equal(r.data.portraitHires, false);
  assert.equal(r.data.imageScheduler, '');
  await api('POST', '/api/settings', { handFix: true, portraitHires: true, imageScheduler: 'Karras' });
});

test('перегенерация через API не откатывает ручные правки кодекса и НПС', async () => {
  handlers.narrator = () => reply('Ты стоишь посреди площади, вокруг шумит ярмарка, торговцы зазывают покупателей.');
  handlers.sync = () => reply('', [call('npc', { name: 'Ярмарочный зазывала', attitude: 'весел' })]);
  let { data } = await api('POST', '/api/action', { text: 'Иду на ярмарку' });
  const lore = (await api('POST', '/api/lore', { title: 'Ярмарка', kind: 'place', content: 'было' })).data.lorebook.find((e) => e.title === 'Ярмарка');
  await api('PUT', `/api/lore/${lore.id}`, { brief: 'Шумная ярмарка на площади.', content: 'стало' });
  const npc = data.npcs.find((n) => n.name === 'Ярмарочный зазывала');
  await api('PUT', `/api/npcs/${npc.id}`, { ...npc, description: 'Рыжий парень с трещоткой' });
  handlers.sync = () => reply('', [call('nothing', {})]);
  ({ data } = await api('POST', '/api/regenerate'));
  const l2 = data.lorebook.find((e) => e.id === lore.id);
  assert.ok(l2, 'статья, созданная после хода, не пропала');
  assert.equal(l2.brief, 'Шумная ярмарка на площади.');
  assert.equal(l2.content, 'стало');
  assert.equal(data.npcs.find((n) => n.id === npc.id), undefined, 'НПС, которого завёл учётчик за отменённый ход, откатился');
});
