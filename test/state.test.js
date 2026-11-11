// Сохранения на диске: миграция, атомарная запись, партии, снимки ходов, обрезка и ветки.
// Данные — во временной папке (test/setup.js). Тесты идут по порядку и делят одно состояние.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../src/paths.js';
import * as S from '../src/state.js';

const narratorTurn = async (playerText, narration, mutate = () => {}) => {
  const st = S.getState();
  st.messages.push({ role: 'user', content: playerText });
  st.log.push({ role: 'player', text: playerText });
  S.captureTurnSnapshot();
  st.turn += 1;
  mutate(st);
  st.messages.push({ role: 'assistant', content: narration });
  st.log.push({ role: 'narrator', text: narration });
  await S.recordTurnOutcome();
  await S.saveState();
};
const hero = () => S.getState().characters[0];

test('первый запуск: старый save.json переносится в партию', async () => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, 'save.json'), JSON.stringify({ blocks: [{ type: 'item', name: 'Старый меч' }], model: 'x/y', difficulty: 'zzz', historyKeep: 3 }));
  const st = await S.loadState();
  assert.equal(st.characters.length, 1);
  assert.equal(st.characters[0].blocks[0].name, 'Старый меч');
  assert.ok(st.characters[0].blocks[0].id);
  assert.equal(st.difficulty, 'normal');
  assert.equal(st.historyKeep, 6);
  assert.equal(S.listSlots().slots[0].name, 'Моя история');
  const settings = JSON.parse(await readFile(join(DATA_DIR, 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'x/y', 'модель — общая настройка, не партии');
});

test('запись атомарная: временных файлов не остаётся, данные перечитываются', async () => {
  await S.updateSettings({ worldPrompt: 'Туманный порт', temperature: 5, model: '  m/new  ' });
  assert.equal(S.getState().temperature, 2);
  assert.equal(S.getState().model, 'm/new');
  const files = await readdir(join(DATA_DIR, 'slots'));
  assert.ok(files.every((f) => !f.endsWith('.tmp')), files.join(','));
  const again = await S.loadState();
  assert.equal(again.worldPrompt, 'Туманный порт');
});

test('повреждённый файл партии не теряется молча', async () => {
  const id = S.listSlots().activeSlotId;
  const path = join(DATA_DIR, 'slots', `${id}.json`);
  const good = await readFile(path, 'utf8');
  await writeFile(path, good.slice(0, 50));
  const warn = console.warn; const warned = [];
  console.warn = (m) => warned.push(m);
  try { await S.loadState(); } finally { console.warn = warn; }
  assert.ok(warned.some((m) => /повреждён/.test(m)));
  const copies = (await readdir(join(DATA_DIR, 'slots'))).filter((f) => f.includes('.broken-'));
  assert.equal(copies.length, 1);
  await writeFile(path, good);
  await S.loadState();
  assert.equal(S.getState().worldPrompt, 'Туманный порт');
});

test('ходы: снимки, свайп вариантов, регенерация, обрезка', async () => {
  await S.resetGame();
  await narratorTurn('Иду в таверну', 'Ты в таверне.', (st) => { st.npcs.push({ id: 'n1', name: 'Ольт', locked: [] }); });
  await narratorTurn('Заказываю эль', 'Эль кислый.', (st) => { hero().blocks.push({ id: 'b1', type: 'item', name: 'Кружка' }); });
  const st = S.getState();
  assert.equal(st.log.length, 4);
  assert.ok(S.canRegenerate());

  // Регенерация: мир откатывается к «до хода», реплика игрока остаётся.
  S.rewindLastTurn();
  assert.equal(hero().blocks.length, 0);
  assert.equal(st.log.length, 3);
  assert.equal(st.messages.at(-1).content, 'Заказываю эль');
  st.turn += 1;
  hero().blocks.push({ id: 'b2', type: 'item', name: 'Кубок' });
  st.messages.push({ role: 'assistant', content: 'Вино сладкое.' });
  st.log.push({ role: 'narrator', text: 'Вино сладкое.' });
  await S.recordTurnOutcome();
  assert.equal(st.log[3].variants, 2);

  // Свайп назад — прежний вариант вместе с его миром.
  await S.switchVariant(3, -1);
  assert.equal(st.log[3].text, 'Эль кислый.');
  assert.equal(hero().blocks[0].name, 'Кружка');
  await S.switchVariant(3, 1);
  assert.equal(hero().blocks[0].name, 'Кубок');
  await assert.rejects(S.switchVariant(1, 1), /только у последней/);

  // Обрезка до первого ответа: мир как после него, дальше — пусто.
  const { restored } = await S.truncateLog(1);
  assert.equal(restored, true);
  assert.equal(st.log.length, 2);
  assert.equal(hero().blocks.length, 0);
  assert.equal(st.npcs.length, 1);
  assert.equal(st.messages.length, 2);

  // Обрезка до реплики игрока с самого начала — к исходной точке, реплика ждёт ответа.
  await S.truncateLog(0);
  assert.equal(st.npcs.length, 0);
  assert.equal(st.log.length, 1);
  assert.equal(st.log[0].failed, true);
  assert.ok(S.hasPendingTurn());
  assert.deepEqual(st.messages.map((m) => m.content), ['Иду в таверну']);
});

test('ветка: копия истории до реплики становится активной, оригинал цел', async () => {
  await S.resetGame();
  await narratorTurn('Раз', 'Один.');
  await narratorTurn('Два', 'Два.');
  const original = S.listSlots().activeSlotId;
  await S.branchAt(1);
  const slots = S.listSlots();
  assert.notEqual(slots.activeSlotId, original);
  assert.equal(S.getState().log.length, 2);
  assert.match(slots.slots.find((x) => x.active).name, /⑂ 1$/);
  await S.switchSlot(original);
  assert.equal(S.getState().log.length, 4);
});

test('партии: создать, переименовать, копия, удалить', async () => {
  const before = S.listSlots().slots.length;
  await S.createSlot('  ');
  assert.equal(S.listSlots().slots.find((x) => x.active).name, 'Новая история');
  assert.equal(S.getState().log.length, 0);
  assert.equal(S.getState().model, 'm/new', 'общие настройки переходят в новую партию');
  const id = S.listSlots().activeSlotId;
  await S.renameSlot(id, 'Север');
  await S.duplicateSlot(id);
  assert.equal(S.listSlots().slots.length, before + 2);
  await S.deleteSlot(id);
  assert.equal(S.listSlots().slots.length, before + 1);
  await assert.rejects(S.renameSlot('нет', 'x'), /не найдена/);
});

test('правка реплики попадает в нужное сообщение среди одинаковых', async () => {
  await S.resetGame();
  await narratorTurn('Жду', 'Ничего.');
  await narratorTurn('Жду', 'Ничего.');
  await S.editMessage(2, 'Жду у двери');
  const users = S.getState().messages.filter((m) => m.role === 'user').map((m) => m.content);
  assert.deepEqual(users, ['Жду', 'Жду у двери']);
});

test('ручные правки: блоки, сцена, хроника, переключение героев', async () => {
  await S.resetGame();
  const h = hero();
  const b = await S.upsertBlock(h.id, { type: 'stat', name: 'Здоровье', value: '', max: '10' });
  assert.equal(b.value, '0');
  assert.equal(b.max, 10);
  await S.upsertBlock(h.id, { id: b.id, type: 'stat', name: 'Здоровье', value: '7', locked: true, descLocked: true });
  assert.equal(b.locked, true);
  assert.equal(b.descLocked, undefined, 'закреплено целиком — отдельное закрепление описания не нужно');
  await assert.rejects(S.upsertBlock(h.id, { name: '' }), /нужно название/);

  const sc = await S.updateSceneManual({ location: 'Порт', present: 'Ольт, Марта', clock: '21:15', day: 3, locked: ['location', 'чушь'] });
  assert.deepEqual(sc.present, ['Ольт', 'Марта']);
  assert.equal(sc.minute, 21 * 60 + 15);
  assert.deepEqual(sc.locked, ['location']);

  const e = await S.upsertEvent({ text: 'Встреча с капитаном', type: 'plan', when: 'в полночь', status: 'open' });
  assert.deepEqual(e.at, { day: 3, minute: 21 * 60 + 15 });
  await S.upsertEvent({ id: e.id, status: 'broken' });
  assert.equal(e.status, 'done');
  assert.equal(e.outcome, 'broken');
  await assert.rejects(S.upsertEvent({}), /нужен текст/);

  // У каждого героя своя сцена, часы общие.
  const rita = await S.addCharacter({ name: 'Рита' });
  assert.equal(S.getState().activeCharacterId, rita.id);
  await S.updateSceneManual({ location: 'Лес', clock: '23:00' });
  await S.setActiveCharacter(h.id);
  assert.equal(S.getState().scene.location, 'Порт');
  assert.equal(S.getState().scene.minute, 23 * 60);
  await S.deleteCharacter(rita.id);
  await assert.rejects(S.deleteCharacter(h.id), /последнего героя/);
});

test('отношения НПС — у каждого героя свои; старая партия с двумя героями никого не «забывает»', async () => {
  await S.resetGame();
  const h = hero();
  const olt = await S.addNpc({ name: 'Ольт', attitude: 'дружелюбен', history: 'вместе пили' });
  const mira = await S.addCharacter({ name: 'Мира' });
  assert.equal(olt.attitude, '', 'новая героиня с Ольтом не знакома');
  await S.updateNpcManual(olt.id, { attitude: 'насторожен' });
  await S.setActiveCharacter(h.id);
  assert.equal(olt.attitude, 'дружелюбен');
  assert.equal(olt.history, 'вместе пили');
  assert.equal(olt.perHero[mira.id].attitude, 'насторожен');
  // Сохранение и загрузка ничего не путают.
  await S.saveState();
  let st = await S.loadState();
  assert.equal(st.npcs[0].attitude, 'дружелюбен');
  assert.equal(st.npcs[0].perHero[mira.id].attitude, 'насторожен');

  // Файл партии «до обновления»: отношение одно на всех, отметки нет.
  const id = S.listSlots().activeSlotId;
  const path = join(DATA_DIR, 'slots', `${id}.json`);
  const raw = JSON.parse(await readFile(path, 'utf8'));
  delete raw.relationsPerHero; delete raw.npcs[0].perHero;
  await writeFile(path, JSON.stringify(raw));
  st = await S.loadState();
  assert.equal(st.npcs[0].attitude, 'дружелюбен');
  assert.equal(st.npcs[0].perHero[mira.id].attitude, 'дружелюбен', 'прежнее отношение осталось и у второй героини');
  await S.setActiveCharacter(mira.id);
  assert.equal(S.getState().npcs[0].attitude, 'дружелюбен');
  await S.setActiveCharacter(h.id);
  await S.deleteCharacter(mira.id);
  assert.equal(S.getState().npcs[0].perHero, undefined);
  assert.equal(S.getState().npcs[0].attitude, 'дружелюбен');
});

test('промт рассказчика: нетронутый прежний обновляется, свой — остаётся', async () => {
  const { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPTS } = await import('../src/prompt.js');
  const settings = join(DATA_DIR, 'settings.json');
  const raw = JSON.parse(await readFile(settings, 'utf8'));
  await writeFile(settings, JSON.stringify({ ...raw, systemPrompt: LEGACY_SYSTEM_PROMPTS[0] }));
  assert.equal((await S.loadState()).systemPrompt, DEFAULT_SYSTEM_PROMPT);
  await writeFile(settings, JSON.stringify({ ...raw, systemPrompt: LEGACY_SYSTEM_PROMPTS[0] + '\nМоё правило.' }));
  assert.match((await S.loadState()).systemPrompt, /Моё правило\.$/);
  await writeFile(settings, JSON.stringify(raw));
  await S.loadState();
});

test('кодекс: переименовали общую статью группы — разновидности остались в группе', async () => {
  await S.resetGame();
  const parent = await S.addLoreEntry({ title: 'Виды лоно-рун', kind: 'magic' });
  const kid = await S.addLoreEntry({ title: 'Руна голода', kind: 'magic', fields: { group: 'виды лоно-рун', effect: 'слабость' } });
  const other = await S.addLoreEntry({ title: 'Чёрная хворь', kind: 'magic', fields: { group: 'Болезни', effect: 'жар' } });
  await S.updateLoreEntry(parent.id, { title: 'Лоно-руны' });
  const book = S.getState().lorebook;
  assert.equal(book.find((e) => e.id === kid.id).fields.group, 'Лоно-руны');
  assert.equal(book.find((e) => e.id === other.id).fields.group, 'Болезни', 'чужие группы не тронуты');
});

test('список заезженных оборотов: по умолчанию есть, правится, очищается и переживает перезагрузку', async () => {
  const { DEFAULT_CLICHE_PHRASES } = await import('../src/contradictions.js');
  let st = await S.loadState();
  assert.deepEqual(st.clichePhrases, DEFAULT_CLICHE_PHRASES);
  await S.updateSettings({ clichePhrases: 'бархатный голос\n\n  хищная улыбка  \nбархатный голос' });
  assert.deepEqual(S.getState().clichePhrases, ['бархатный голос', 'хищная улыбка']);
  st = await S.loadState();
  assert.deepEqual(st.clichePhrases, ['бархатный голос', 'хищная улыбка']);
  await S.updateSettings({ clichePhrases: '' });
  assert.deepEqual((await S.loadState()).clichePhrases, [], 'пустой список — выбор игрока, а не повод вернуть умолчания');
  await S.updateSettings({ clichePhrases: DEFAULT_CLICHE_PHRASES });
});
