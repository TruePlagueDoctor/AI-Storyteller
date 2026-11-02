import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, sameName, isUnnamedName, isDescriptiveName, toolsFor } from '../src/tools.js';
import { makeState, hero, block } from './helpers.js';

const run = (st, name, args) => executeTool(name, args, st);

test('неизвестный инструмент и nothing', () => {
  const st = makeState();
  assert.match(run(st, 'fly', {}), /^Ошибка: инструмента «fly» нет/);
  assert.equal(run(st, 'nothing', {}), 'Принято: без изменений.');
});

test('block: завести, обновить, удалить; падеж прощается', () => {
  const st = makeState();
  assert.match(run(st, 'block', { type: 'stat', name: 'Здоровье', value: '80', max: 100 }), /создан блок "Здоровье"/);
  assert.match(run(st, 'block', { type: 'stat', name: 'Здоровья', value: '70' }), /совпало с «Здоровье»/);
  assert.equal(block(st, 'Здоровье').value, '70');
  run(st, 'block', { type: 'item', name: 'Ржавый меч' });
  assert.match(run(st, 'block', { action: 'remove', type: 'status', name: 'Ржавый меч' }), /нашёлся как item/);
  assert.equal(block(st, 'Ржавый меч'), undefined);
  assert.match(run(st, 'block', { action: 'remove', type: 'item', name: 'Фляга' }), /не найден/);
  assert.match(run(st, 'block', { type: 'weird', name: 'X' }), /^Ошибка: неизвестный тип/);
  assert.match(run(st, 'block', { type: 'item', name: ' ' }), /^Ошибка: не указано название/);
});

test('block stat: число, границы шкалы, предупреждение о скачке', () => {
  const st = makeState();
  run(st, 'block', { type: 'stat', name: 'Здоровье', value: '10', max: 10 });
  assert.match(run(st, 'block', { type: 'stat', name: 'Здоровье', value: '15' }), /вне шкалы 0\.\.10 — записано 10/);
  assert.equal(block(st, 'Здоровье').value, '10');
  assert.match(run(st, 'block', { type: 'stat', name: 'Здоровье', value: '1' }), /ВНИМАНИЕ: «Здоровье» изменилось сразу на -9/);
  assert.match(run(st, 'block', { type: 'stat', name: 'Здоровье', value: 'много' }), /^Ошибка: .*должно быть числом/);
  assert.equal(block(st, 'Здоровье').value, '1');
  run(st, 'block', { type: 'stat', name: 'Здоровье', value: '-3' });
  assert.equal(block(st, 'Здоровье').value, '0');
});

test('block: статус по каталогу, закрепления', () => {
  const st = makeState();
  assert.match(run(st, 'block', { type: 'status', name: 'Отравление' }), /по каталогу как «Отравлен»/);
  assert.equal(block(st, 'Отравлен').sinceTurn, 1);
  assert.match(run(st, 'block', { action: 'remove', type: 'status', name: 'Отравлена' }), /Удалён блок "Отравлен"/);
  hero(st).blocks.push({ id: 'x', type: 'item', name: 'Медальон', locked: true });
  assert.match(run(st, 'block', { action: 'remove', type: 'item', name: 'Медальон' }), /закреплён игроком/);
  hero(st).blocks.push({ id: 'y', type: 'item', name: 'Кошель', value: '10', description: 'кожаный', descLocked: true });
  assert.match(run(st, 'block', { type: 'item', name: 'Кошель', value: '5', description: 'другой' }), /Описание закреплено/);
  assert.equal(block(st, 'Кошель').value, '5');
  assert.equal(block(st, 'Кошель').description, 'кожаный');
  assert.match(run(st, 'block', { action: 'remove', type: 'item', name: 'Кошель' }), /удалять его нельзя/);
});

test('block: другой герой по имени и подсказка, у кого блок', () => {
  const st = makeState();
  st.characters.push({ id: 'h2', name: 'Рита', blocks: [{ type: 'item', name: 'Лютня' }] });
  assert.match(run(st, 'block', { action: 'remove', type: 'item', name: 'Лютня' }), /Такой блок есть у: Рита/);
  assert.match(run(st, 'block', { action: 'remove', type: 'item', name: 'Лютня', character: 'рита' }), /Удалён/);
});

test('npc: завести, обновить, история дописывается, закреплённое не трогается', () => {
  const st = makeState();
  assert.match(run(st, 'npc', { name: 'Ольт', attitude: 'насторожен', history: 'встретил героя', traits: ['Упрямый', 'Выдуманная'] }), /Занесён НПС «Ольт»/);
  const n = st.npcs[0];
  assert.deepEqual(n.traits, ['Упрямый']);
  run(st, 'npc', { name: 'Ольта', history: 'дал флягу', voice_sample: '«Пей, пока я добрый.»' });
  assert.equal(n.history, 'встретил героя; дал флягу');
  assert.deepEqual(n.voiceSamples, ['Пей, пока я добрый.']);
  n.locked = ['attitude'];
  assert.match(run(st, 'npc', { name: 'Ольт', attitude: 'враг' }), /закреплены игроком.*attitude/);
  assert.equal(n.attitude, 'насторожен');
  assert.match(run(st, 'npc', { name: 'Ян' }), /герой игрока/);
  assert.equal(st.npcs.length, 1);
});

test('npc: короткие имена не путаются, падеж узнаётся', () => {
  const st = makeState();
  run(st, 'npc', { name: 'Дорн' });
  run(st, 'npc', { name: 'Дора' });
  assert.equal(st.npcs.length, 2);
  run(st, 'npc', { name: 'Лира' });
  run(st, 'npc', { name: 'Лиру', status: 'в таверне' });
  assert.equal(st.npcs.find((x) => x.name === 'Лира').status, 'в таверне');
  assert.equal(st.npcs.length, 3);
});

test('npc: безымянный получает имя, архив убирает из сцены', () => {
  const st = makeState();
  run(st, 'npc', { name: 'Девушка в красном плаще', appearance: 'рыжая, в красном плаще' });
  st.scene.present = ['Девушка в красном плаще'];
  run(st, 'npc', { name: 'Девушка в красном плаще', new_name: 'Лира' });
  assert.equal(st.npcs[0].name, 'Лира');
  assert.deepEqual(st.npcs[0].aliases, ['Девушка в красном плаще']);
  st.scene.present = ['Лира'];
  assert.match(run(st, 'npc', { action: 'archive', name: 'Лира' }), /в архив.*Убран и из списка «рядом»/);
  assert.deepEqual(st.scene.present, []);
  assert.match(run(st, 'npc', { action: 'archive', name: 'Лира' }), /уже в архиве/);
  run(st, 'npc', { name: 'Лира', status: 'вернулась' });
  assert.equal(st.npcs[0].archived, undefined);
});

test('npc: новое имя при похожей безымянной записи — предупреждение', () => {
  const st = makeState();
  run(st, 'npc', { name: 'Человек в сером', appearance: 'высокий худой мужчина в сером плаще со шрамом на щеке' });
  const r = run(st, 'npc', { name: 'Корвин', appearance: 'высокий худой, серый плащ, шрамом через щеку' });
  assert.match(r, /ВНИМАНИЕ: похоже на безымянную запись «Человек в сером»/);
});

test('npc: переименование в уже существующего сливает записи', () => {
  const st = makeState();
  run(st, 'npc', { name: 'Старик', history: 'продал карту', secret: 'вор' });
  run(st, 'npc', { name: 'Эрвин', history: 'хозяин лавки' });
  assert.match(run(st, 'npc', { name: 'Старик', new_name: 'Эрвин' }), /объединены/);
  assert.equal(st.npcs.length, 1);
  assert.equal(st.npcs[0].secret, 'вор');
  assert.match(st.npcs[0].history, /хозяин лавки.*продал карту/);
});

test('имена: sameName, безымянные', () => {
  assert.ok(sameName('Барон Кейн', 'Барона Кейн'));
  assert.ok(sameName('Здоровье', 'Здоровья'));
  assert.ok(!sameName('Кейн', 'Кейна'), 'короткие слова — только точно');
  assert.ok(!sameName('Дорн', 'Дора'));
  assert.ok(isDescriptiveName('Девочка с хвостиком'));
  assert.ok(!isDescriptiveName('Барон Кейн'));
  assert.ok(isUnnamedName('Стражник'));
  assert.ok(isUnnamedName('Паренёк'));
  assert.ok(!isUnnamedName('Ольт'));
});

test('scene: место, время, присутствующие, закрепления', () => {
  const st = makeState();
  st.npcs = [{ name: 'Ольт' }];
  const r = run(st, 'scene', { location: 'Таверна', elapsed_minutes: 90, present: ['Ольт', 'Бармен'] });
  assert.match(r, /Таверна; день 1, 10:30/);
  assert.match(r, /Нет среди НПС: Бармен/);
  st.scene.locked = ['location'];
  assert.match(run(st, 'scene', { location: 'Улица' }), /не изменено: место/);
  assert.equal(st.scene.location, 'Таверна');
});

test('scene: время словами не перескакивает через сутки внутри того же времени суток', () => {
  const st = makeState();
  st.scene.minute = 19 * 60 + 30;
  run(st, 'scene', { time: 'вечер' });
  assert.equal(st.scene.day, 1, '«вечер», сказанный вечером, — тот же вечер');
  assert.equal(st.scene.minute, 19 * 60 + 30, 'часы не отматываются назад');
  run(st, 'scene', { time: 'утро' });
  assert.equal(st.scene.day, 2);
  assert.equal(st.scene.minute, 9 * 60);
  run(st, 'scene', { time: '08:50' });
  assert.equal(st.scene.day, 2, 'явные часы чуть раньше текущих — поправка, а не новые сутки');
  assert.equal(st.scene.minute, 8 * 60 + 50);
  run(st, 'scene', { time: '07:00' });
  assert.equal(st.scene.day, 3);
});

test('event: добавить, дубль, закрыть по номеру, поправить', () => {
  const st = makeState();
  st.scene.minute = 600;
  assert.match(run(st, 'event', { type: 'debt', text: 'Ян должен Ольту двадцать золотых', participants: ['Ян', 'Ольт'] }), /В хронику #1/);
  assert.match(run(st, 'event', { text: 'Ян должен Ольту двадцать золотых монет', known_by: ['Марта'] }), /дубль не создан/);
  assert.deepEqual(st.events[0].knownBy, ['Ян', 'Ольт', 'Марта']);
  assert.match(run(st, 'event', { action: 'close', id: '#1', outcome: 'done' }), /Закрыто \(исполнено\)/);
  assert.match(run(st, 'event', { action: 'close', id: '#1' }), /Уже закрыто/);
  assert.match(run(st, 'event', { action: 'close', id: '#9' }), /^Ошибка: записи #9/);
  assert.match(run(st, 'event', { action: 'update', id: '#1', when: 'завтра' }), /Поправлено/);
  assert.equal(st.events[0].status, 'open', 'перенос снова открывает запись');
  assert.match(run(st, 'event', { action: 'close' }), /^Ошибка: укажи id/);
  assert.match(run(st, 'event', {}), /^Ошибка: у записи нужен текст/);
});

test('event: id в виде uuid не принимается за номер', () => {
  const st = makeState();
  run(st, 'event', { text: 'Первая запись про старый маяк' });
  run(st, 'event', { text: 'Вторая запись про сгоревшую мельницу' });
  const id = st.events[1].id = '1f2a9c1e-0000-4000-8000-000000000001';
  run(st, 'event', { action: 'close', id });
  assert.equal(st.events[1].status, 'done');
  assert.equal(st.events[0].status, 'open');
});

test('event: закреплённое не меняется', () => {
  const st = makeState();
  run(st, 'event', { text: 'Король умер этой весной' });
  st.events[0].locked = true;
  assert.match(run(st, 'event', { action: 'close', id: '#1' }), /закреплена игроком/);
});

test('thread: нити ищутся по смыслу, закрытые не переоткрываются молча', () => {
  const st = makeState();
  run(st, 'thread', { action: 'open', title: 'Найти сестру Анну' });
  assert.match(run(st, 'thread', { action: 'update', title: 'Поиски сестры Анны', progress: 'она на севере' }), /дубль не создан/);
  assert.equal(st.threads.length, 1);
  run(st, 'thread', { action: 'open', title: 'Найти убийцу' });
  assert.equal(st.threads.length, 2);
  assert.match(run(st, 'thread', { action: 'done', title: 'Найти сестру Анну' }), /закрыта/);
  assert.match(run(st, 'thread', { action: 'update', title: 'Найти сестру Анну', notes: 'x' }), /уже закрыта/);
  assert.match(run(st, 'thread', { action: 'done', title: 'Чего нет' }), /закрывать нечего/);
});

test('update_hero: деталь дописывается, потеря описания отклоняется', () => {
  const st = makeState();
  const h = hero(st);
  h.appearance = 'Высокий худой мужчина лет сорока, седые волосы до плеч, серые глаза, потёртый дорожный плащ.';
  assert.match(run(st, 'update_hero', { appearance_change: 'на щеке свежий шрам' }), /обновлено: внешность/);
  assert.match(h.appearance, /плащ\. На щеке свежий шрам\.$/);
  assert.match(run(st, 'update_hero', { appearance: 'Шрам' }), /^ВНИМАНИЕ/);
  h.locked = ['social'];
  assert.match(run(st, 'update_hero', { social: 'барон' }), /закреплено/);
});

test('record_lore только с разрешения игрока', () => {
  const st = makeState();
  assert.match(run(st, 'record_lore', { title: 'Порядки', content: 'x' }), /игрок ведёт его сам/);
  st.loreAutoWrite = true;
  run(st, 'record_lore', { title: 'Порядки', content: 'Отбой в девять' });
  run(st, 'record_lore', { title: 'порядки', content: 'Подъём в шесть', keys: 'приют' });
  assert.equal(st.lorebook.length, 1);
  assert.equal(st.lorebook[0].content, 'Отбой в девять; Подъём в шесть');
  assert.ok(toolsFor(st).some((t) => t.function.name === 'record_lore'));
  st.loreAutoWrite = false;
  assert.ok(!toolsFor(st).some((t) => t.function.name === 'record_lore'));
});
