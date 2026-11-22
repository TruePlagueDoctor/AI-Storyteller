// Характеристики и постоянный список навыков.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCatalog, matchSkill, adoptSkills, parseCatalogText, catalogToText, attrMod, attrId, skillBlock, talentsOf, applyCatalogChange } from '../src/skillset.js';

const cat = defaultCatalog('fantasy');
const hero = (blocks, extra = {}) => ({ id: 'h', name: 'Мита', blocks: blocks.map((b) => ({ type: 'ability', ...b })), skillXp: {}, ...extra });

test('модификатор характеристики: 1 → −2, 3 → 0, 6 → +3', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(attrMod), [-2, -1, 0, 1, 2, 3]);
  assert.equal(attrId('Ловкость'), 'dex'); assert.equal(attrId('воля'), 'wil'); assert.equal(attrId('чепуха'), '');
});

test('навык находится по формулировке рассказчика; двусмысленное — никого', () => {
  const m = (t, o) => { const r = matchSkill(cat, t, o); return r.skill ? r.skill.name : null; };
  assert.equal(m('Скрытность'), 'Скрытность');
  assert.equal(m('вскрыть замок'), 'Взлом');
  assert.equal(m('Фехтование'), 'Холодное оружие');
  assert.equal(m('Уговоры'), 'Убеждение');
  assert.equal(m('игра на лютне'), null);
  // Строго: все слова должны относиться к навыку.
  assert.equal(m('Взлом замков', { strict: true }), 'Взлом');
  assert.equal(m('Магия крови', { strict: true }), null);
  assert.equal(m('Дар медиума', { strict: true }), null);
});

test('старые умения раскладываются по списку, особые остаются талантами', () => {
  const c = hero([
    { name: 'Взлом замков', value: 'опытный' },
    { name: 'Скрытность', value: 'ученик' },
    { name: 'Дар медиума', value: 'мастер' },
    { name: 'Магия крови', value: 'ученик' },
    { name: 'Фехтование', value: 'ученик', locked: true },
  ], { skillXp: { 'взлом замков': 9 } });
  assert.ok(adoptSkills(c, cat));
  assert.equal(skillBlock(c, 'lockpick').name, 'Взлом');
  assert.equal(skillBlock(c, 'lockpick').value, 'опытный');
  assert.equal(c.skillXp['взлом'], 9, 'опыт переехал вместе с названием');
  assert.equal(skillBlock(c, 'stealth').value, 'ученик');
  assert.deepEqual(talentsOf(c).map((b) => b.name).sort(), ['Дар медиума', 'Магия крови', 'Фехтование']);
  // Повторный вызов ничего не меняет.
  const before = JSON.stringify(c);
  assert.equal(adoptSkills(c, cat), false);
  assert.equal(JSON.stringify(c), before);
});

test('два умения об одном навыке сливаются в одно с большим уровнем', () => {
  const c = hero([{ name: 'Скрытность', value: 'ученик' }, { name: 'Слежка', value: 'мастер' }]);
  adoptSkills(c, cat);
  assert.equal(c.blocks.length, 1);
  assert.equal(skillBlock(c, 'stealth').value, 'мастер');
});

test('список в тексте: туда и обратно, переименование сохраняет навык на листе', () => {
  const text = catalogToText(cat);
  const same = parseCatalogText(text, cat);
  assert.deepEqual(same.catalog.map((s) => s.id), cat.map((s) => s.id));
  assert.equal(same.catalog.find((s) => s.id === 'melee').alt, 'dex');
  assert.equal(same.renamed.length, 0);

  const edited = parseCatalogText(text.replace('Магия —', 'Колдовство —'), cat);
  assert.deepEqual(edited.renamed, [{ id: 'magic', from: 'Магия', to: 'Колдовство' }]);
  const state = { skillCatalog: edited.catalog, characters: [hero([{ name: 'Магия', value: 'опытный', skill: 'magic' }], { skillXp: { 'магия': 8 } })] };
  applyCatalogChange(state, edited);
  assert.equal(skillBlock(state.characters[0], 'magic').name, 'Колдовство');
  assert.equal(state.characters[0].skillXp['колдовство'], 8);

  // Навык убран из списка — на листе он остаётся особым талантом.
  const cut = parseCatalogText(text.split('\n').filter((l) => !l.startsWith('Магия')).join('\n'), cat);
  assert.deepEqual(cut.removed, ['magic']);
  const st2 = { skillCatalog: cut.catalog, characters: [hero([{ name: 'Магия', value: 'опытный', skill: 'magic' }])] };
  applyCatalogChange(st2, cut);
  assert.equal(talentsOf(st2.characters[0])[0].name, 'Магия');

  assert.deepEqual(parseCatalogText('Просто строка\nПение — Обаяние — петь', []).errors, ['Просто строка']);
});

// ---- Учётчик и список навыков ----
import { executeTool } from '../src/tools.js';
import { composeSyncSystem } from '../src/sync.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState, hero as H } from './helpers.js';

test('учётчик: умение пишется навыком из списка; уровень записанного не меняет; вне списка — талант', () => {
  const st = makeState(); H(st).blocks = [];
  assert.match(executeTool('block', { type: 'ability', name: 'Фехтование', value: 'опытный' }, st), /создан блок "Холодное оружие".*по списку навыков/);
  const b = H(st).blocks[0];
  assert.equal(b.skill, 'melee'); assert.equal(b.value, 'опытный');
  // Повысить уровень записью нельзя — только practice и броски.
  const r = executeTool('block', { type: 'ability', name: 'Холодное оружие', value: 'мастер' }, st);
  assert.match(r, /^Ошибка: «Холодное оружие».*practice/); assert.equal(b.value, 'опытный');
  // Описание без смены уровня — можно.
  assert.doesNotMatch(executeTool('block', { type: 'ability', name: 'Холодное оружие', value: 'опытный', description: 'школа южных дуэлянтов' }, st), /^Ошибка/);
  assert.match(executeTool('block', { action: 'remove', type: 'ability', name: 'Холодное оружие' }, st), /не удаляется/);
  assert.match(executeTool('block', { type: 'ability', name: 'Дар медиума', value: 'ученик' }, st), /особый талант/);
  assert.equal(H(st).blocks.find((x) => x.name === 'Дар медиума').talent, true);
  assert.equal(H(st).blocks.length, 2);
});

test('учётчик: характеристики — один раз, в пределах и в бюджете', () => {
  const st = makeState();
  assert.match(executeTool('update_hero', { attributes: { 'Сила': 6, 'Ловкость': 6, 'Ум': 6, 'Воля': 3, 'Обаяние': 3 } }, st), /^Ошибка: сумма характеристик 24/);
  assert.match(executeTool('update_hero', { attributes: { 'Сила': 9 } }, st), /^Ошибка: характеристики/);
  assert.equal(H(st).attrsSet, undefined);
  assert.match(executeTool('update_hero', { attributes: { 'Сила': 4, 'Ловкость': 4, 'Обаяние': 2 } }, st), /характеристики: Сила 4, Ловкость 4, Ум 3, Воля 3, Обаяние 2/);
  assert.equal(H(st).attrsSet, true);
  assert.match(executeTool('update_hero', { attributes: { 'Сила': 6 } }, st), /уже заданы/);
  assert.equal(H(st).attrs.str, 4);
});

test('промты: учётчик видит список навыков и просит характеристики, пока их нет; рассказчик видит характеристики героя', () => {
  const st = makeState();
  const sync = composeSyncSystem(st, 'Ты идёшь по дороге.');
  assert.match(sync, /НАВЫКИ ИСТОРИИ[^\n]*Скрытность[^\n]*Убеждение/);
  if (H(st).blocks.length) assert.match(sync, /ХАРАКТЕРИСТИКИ НЕ ЗАДАНЫ/);
  H(st).attrsSet = true;
  assert.doesNotMatch(composeSyncSystem(st, 'Ты идёшь по дороге.'), /ХАРАКТЕРИСТИКИ НЕ ЗАДАНЫ/);
  H(st).attrs = { str: 5, dex: 3, int: 3, wil: 2, cha: 3 };
  assert.match(composeStorySystem(st), /Характеристики \(1–6, 3 — обычный человек\): Сила 5, Ловкость 3, Ум 3, Воля 2, Обаяние 3/);
});

test('миграция дублей хранит закреплённую запись, опыт и день тренировки в обоих порядках', () => {
  for (const reverse of [false, true]) {
    const blocks = [
      { id: 'auto', name: 'Слежка', value: 'мастер' },
      { id: 'manual', name: 'Скрытность', value: 'ученик', description: 'Моя запись', locked: true },
    ];
    const c = hero(reverse ? blocks.reverse() : blocks, { skillXp: { 'слежка': 5 }, practiceDays: { 'слежка': 6, 'скрытность': 4 } });
    adoptSkills(c, cat);
    assert.equal(c.blocks.length, 1);
    assert.deepEqual(c.blocks[0], { ...blocks.find((b) => b.locked), type: 'ability', skill: 'stealth' });
    assert.deepEqual(c.skillXp, { 'скрытность': 5 });
    assert.deepEqual(c.practiceDays, { 'скрытность': 6 });
    assert.equal(adoptSkills(c, cat), false);
  }
});
