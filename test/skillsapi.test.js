// Характеристики и навыки через настоящий сервер: откат хода, ручные правки, список в настройках, бросок в ленте.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack, defaultHandlers } from './harness.js';
import { reply, call } from './fake-llm.js';

const handlers = defaultHandlers();
let stack; let api;
before(async () => { stack = await startStack({ handlers }); ({ api } = stack); });
after(() => stack?.stop());
const heroOf = (data) => data.characters.find((c) => c.id === data.activeCharacterId);

test('состояние отдаёт список навыков, заготовки и характеристики героя', async () => {
  const { data } = await api('GET', '/api/state');
  assert.ok(data.skillCatalog.length >= 16 && data.skillCatalog.some((s) => s.name === 'Скрытность' && s.attr === 'dex'));
  assert.deepEqual(data.attributes.map((a) => a.name), ['Сила', 'Ловкость', 'Ум', 'Воля', 'Обаяние']);
  assert.ok(data.skillPresets.some((p) => p.id === 'fantasy' && /Магия — Воля/.test(p.text)));
  assert.deepEqual(heroOf(data).attrs, { str: 3, dex: 3, int: 3, wil: 3, cha: 3 });
});

test('учётчик расставил характеристики и записал навык — переигровка хода это откатывает; заданное игроком остаётся', async () => {
  handlers.narrator = () => reply('Ты выходишь на тракт и до самого полудня шагаешь на север. Меч привычно оттягивает пояс, а за спиной остаётся застава, где ты прослужил десять лет.');
  handlers.sync = () => reply('', [
    call('update_hero', { attributes: { 'Сила': 5, 'Ловкость': 4, 'Обаяние': 2 } }),
    call('block', { type: 'ability', name: 'Фехтование', value: 'опытный' }),
  ]);
  let { data } = await api('POST', '/api/action', { text: 'Иду по тракту' });
  let h = heroOf(data);
  assert.equal(h.attrs.str, 5); assert.equal(h.attrsSet, true);
  assert.ok(h.blocks.some((b) => b.skill === 'melee' && b.name === 'Холодное оружие' && b.value === 'опытный'));

  handlers.sync = () => reply('', [call('nothing', {})]);
  ({ data } = await api('POST', '/api/regenerate'));
  h = heroOf(data);
  assert.equal(h.attrs.str, 3, 'характеристики, расставленные за отменённый ход, откатились');
  assert.ok(!h.attrsSet);
  assert.ok(!h.blocks.some((b) => b.skill === 'melee'));

  // Игрок задаёт сам — после переигровки остаётся, и учётчик больше не меняет.
  await api('PUT', `/api/characters/${h.id}`, { attrs: { 'Воля': 6 } });
  handlers.sync = () => reply('', [call('update_hero', { attributes: { 'Воля': 1 } })]);
  ({ data } = await api('POST', '/api/regenerate'));
  h = heroOf(data);
  assert.equal(h.attrs.wil, 6); assert.equal(h.attrsSet, true);
  handlers.sync = () => reply('', [call('nothing', {})]);
});

test('бросок: рассказчик берёт навык из списка, под ответом видна характеристика, опыт идёт навыку', async () => {
  let { data } = await api('GET', '/api/state');
  const hid = heroOf(data).id;
  await api('PUT', `/api/characters/${hid}`, { attrs: { 'Ловкость': 5 } });
  let seenTool = null; let n = 0;
  handlers.narrator = (body) => {
    seenTool = (body.tools || []).find((t) => t.function.name === 'roll_check') || seenTool;
    return n++ === 0 ? reply('', [call('roll_check', { skill: 'Скрытность', difficulty: 'легко' })]) : reply('Ты проскальзываешь мимо костра.');
  };
  const random = Math.random;
  ({ data } = await api('POST', '/api/action', { text: 'Крадусь мимо часовых' }));
  Math.random = random;
  assert.ok(seenTool.function.parameters.properties.skill.enum.includes('Скрытность'));
  const roll = data.log.at(-1).rolls[0];
  assert.equal(roll.skill, 'Скрытность'); assert.equal(roll.attr, 'Ловкость'); assert.equal(roll.attrMod, 2);
  assert.equal(roll.total, roll.roll + 2 + roll.bonus - (roll.penalty || 0) + (roll.traitMod || 0));
  if (roll.success) assert.ok(heroOf(data).blocks.some((b) => b.skill === 'stealth'), 'удача — навык появился на листе');
});

test('список навыков в настройках: переименование доходит до листа, мусорная строка — понятная ошибка', async () => {
  let { data } = await api('GET', '/api/state');
  const hid = heroOf(data).id;
  await api('POST', `/api/characters/${hid}/blocks`, { type: 'ability', name: 'Взлом замков', value: 'ученик' });
  const text = data.skillCatalogText;
  let r = await api('POST', '/api/settings', { skillCatalogText: text.replace('Взлом —', 'Вскрытие —') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(heroOf(r.data).blocks.some((b) => b.skill === 'lockpick' && b.name === 'Вскрытие' && b.value === 'ученик'));
  r = await api('POST', '/api/settings', { skillCatalogText: text + '\nпросто строка без характеристики' });
  assert.equal(r.status >= 400, true);
  assert.match(r.data.error, /не понял строку «просто строка без характеристики»/);
  // Второй навык с тем же смыслом игрок завести не может — вместо дубля подсказка.
  r = await api('POST', `/api/characters/${hid}/blocks`, { type: 'ability', name: 'Вскрытие', value: 'мастер' });
  assert.equal(r.status >= 400, true);
  assert.match(r.data.error, /уже есть на листе/);
});

test('отклонённая правка сохраняет исходные настройки и блоки', async () => {
  const { data } = await api('GET', '/api/state');
  const path = `/api/characters/${data.activeCharacterId}/blocks`;
  const added = await api('POST', path, { type: 'ability', name: 'Езда', value: 'ученик' });
  assert.equal(added.status, 200);
  const before = heroOf(added.data).blocks;
  const riding = before.find((b) => b.skill === 'riding');
  const target = before.find((b) => b.skill && b.id !== riding.id);
  const edit = await api('POST', path, { ...riding, name: target.name });
  assert.equal(edit.status, 400);
  const settings = await api('POST', '/api/settings', { worldPrompt: 'не сохранять', difficulty: 'brutal', skillCatalogText: 'ошибка' });
  assert.equal(settings.status, 400);
  const after = (await api('GET', '/api/state')).data;
  assert.deepEqual(heroOf(after).blocks, before);
  for (const k of ['worldPrompt', 'difficulty', 'skillCatalog']) assert.deepEqual(after[k], data[k]);
});

test('смена жанра, переигровка и восстановление копии сохраняют прогресс', async () => {
  const fresh = await api('POST', '/api/slots', { name: 'Проверка каталога' });
  const preset = (id) => fresh.data.skillPresets.find((p) => p.id === id).text;
  const set = async (text) => {
    const r = await api('POST', '/api/settings', { skillCatalogText: text });
    assert.equal(r.status, 200);
    return r.data;
  };
  const turn = async () => {
    const r = await api('POST', '/api/action', { text: 'Учусь у наставника' });
    assert.equal(r.status, 200);
    return r.data;
  };
  handlers.narrator = () => reply('Всю первую половину утра ты разучиваешь заклинание вместе с наставником.');
  const lesson = (skill) => () => reply('', [call('practice', { skill, kind: 'lesson' })]);
  await set(preset('fantasy'));
  handlers.sync = lesson('Магия');
  assert.deepEqual(heroOf(await turn()).skillXp, { 'магия': 2 });
  handlers.sync = () => reply('', [call('nothing', {})]);
  await turn();
  const renamed = preset('fantasy').replace('Магия —', 'Колдовство —');
  await set(renamed);
  handlers.sync = lesson('Колдовство');
  const replay = await api('POST', '/api/regenerate');
  assert.equal(replay.status, 200);
  const h = heroOf(replay.data);
  assert.equal(h.blocks.find((b) => b.skill === 'magic').name, 'Колдовство');
  assert.deepEqual(h.skillXp, { 'колдовство': 2 });
  assert.deepEqual(h.practiceDays, { 'колдовство': 1 });
  await set(renamed.replace('Колдовство —', 'Магия —'));
  const modern = await set(preset('modern'));
  const saved = heroOf(modern);
  assert.ok(saved.blocks.find((b) => b.name === 'Магия' && b.talent));
  assert.ok(!saved.blocks.some((b) => b.name === 'Техника'));
  assert.deepEqual(saved.skillXp, { 'магия': 2 });
  const backup = (await api('POST', '/api/backups')).data.backup;
  const slotId = (await api('GET', '/api/slots')).data.activeSlotId;
  const restored = await api('POST', `/api/backups/${backup.id}/restore`, { slotId });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data.skillCatalog, modern.skillCatalog);
  for (const k of ['attrs', 'blocks', 'skillXp', 'practiceDays']) assert.deepEqual(heroOf(restored.data)[k], saved[k]);
  const back = heroOf(await set(preset('fantasy')));
  assert.equal(back.blocks.find((b) => b.skill === 'magic').name, 'Магия');
  assert.deepEqual(back.skillXp, { 'магия': 2 });
});
