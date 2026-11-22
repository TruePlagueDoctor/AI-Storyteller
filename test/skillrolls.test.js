// Бросок: кубик + характеристика + навык из списка; особый талант; опыт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollCheck, describeRoll } from '../src/dice.js';
import { recordRoll } from '../src/progress.js';
import { defaultCatalog, skillBlock } from '../src/skillset.js';

const catalog = defaultCatalog('fantasy');
const hero = (attrs = {}, blocks = []) => ({ id: 'h', name: 'Мита', attrs: { str: 3, dex: 3, int: 3, wil: 3, cha: 3, ...attrs }, blocks: blocks.map((b) => ({ type: 'ability', ...b })), skillXp: {} });
const fixed = (n, fn) => { const r = Math.random; Math.random = () => (n - 1) / 20; try { return fn(); } finally { Math.random = r; } };

test('характеристика и уровень навыка складываются', () => {
  const c = hero({ dex: 5 }, [{ name: 'Скрытность', value: 'опытный', skill: 'stealth' }]);
  const r = fixed(10, () => rollCheck({ character: c, skill: 'Скрытность', catalog, difficulty: 'сложно' }));
  assert.equal(r.attr, 'Ловкость'); assert.equal(r.attrMod, 2); assert.equal(r.bonus, 4);
  assert.equal(r.total, 16); assert.equal(r.success, true);
  assert.match(describeRoll(r), /Бросок 10 \+ 2 \(Ловкость\) \+ 4 = 16 против 14/);
});

test('навык без записи на листе — новичок, но характеристика работает; слабая — мешает', () => {
  const r = fixed(10, () => rollCheck({ character: hero({ cha: 1 }), skill: 'Убеждение', catalog, difficulty: 'обычно' }));
  assert.equal(r.level, 'новичок'); assert.equal(r.attrMod, -2); assert.equal(r.total, 8); assert.equal(r.success, false);
  assert.match(describeRoll(r), /Бросок 10 − 2 \(Обаяние\) \+ 0/);
});

test('у навыка две характеристики — берётся лучшая', () => {
  const r = fixed(10, () => rollCheck({ character: hero({ str: 2, wil: 5 }), skill: 'Запугивание', catalog, difficulty: 'обычно' }));
  assert.equal(r.attr, 'Воля'); assert.equal(r.attrMod, 2);
  const r2 = fixed(10, () => rollCheck({ character: hero({ str: 6, wil: 2 }), skill: 'Запугивание', catalog, difficulty: 'обычно' }));
  assert.equal(r2.attr, 'Сила'); assert.equal(r2.attrMod, 3);
});

test('формулировка рассказчика приводится к навыку из списка', () => {
  const r = fixed(10, () => rollCheck({ character: hero({}, [{ name: 'Взлом', value: 'ученик', skill: 'lockpick' }]), skill: 'вскрыть замок', catalog, difficulty: 'обычно' }));
  assert.equal(r.skill, 'Взлом'); assert.equal(r.skillId, 'lockpick'); assert.equal(r.asked, 'вскрыть замок'); assert.equal(r.bonus, 2);
});

test('особый талант даёт свой уровень, когда его применяют; опыт идёт ему', () => {
  const c = hero({ wil: 4 }, [{ name: 'Дар медиума', value: 'опытный', talent: true }]);
  const r = fixed(12, () => rollCheck({ character: c, skill: 'Магия', talent: 'Дар медиума', catalog, difficulty: 'обычно' }));
  assert.equal(r.talent, 'Дар медиума'); assert.equal(r.bonus, 4); assert.equal(r.attrMod, 1); assert.equal(r.total, 17);
  assert.match(describeRoll(r), /с талантом «Дар медиума»/);
  recordRoll(c, r);
  assert.equal(c.skillXp['дар медиума'], 8, 'опыт таланту (со стартового уровня)');
  assert.equal(skillBlock(c, 'magic'), null, 'навык «Магия» при этом не заводится');
  // Талант назван вместо навыка — тоже находится, без характеристики.
  const r2 = fixed(12, () => rollCheck({ character: c, skill: 'Дар медиума', catalog, difficulty: 'обычно' }));
  assert.equal(r2.talent, 'Дар медиума'); assert.equal(r2.attrMod, 0);
});

test('удачный бросок по навыку без записи заводит его новичком и копит опыт; три удачи — ученик', () => {
  const c = hero();
  for (let i = 0; i < 3; i++) recordRoll(c, fixed(15, () => rollCheck({ character: c, skill: 'Езда', catalog, difficulty: 'обычно' })));
  assert.equal(skillBlock(c, 'riding').value, 'ученик');
  assert.equal(c.blocks.filter((b) => b.type === 'ability').length, 1, 'дублей нет');
});

test('навыка нет в списке и среди талантов — бросок без подготовки, опыта нет, модели подсказка', () => {
  const c = hero({ cha: 6 });
  const r = fixed(15, () => rollCheck({ character: c, skill: 'Игра на лютне', catalog, difficulty: 'обычно' }));
  assert.equal(r.unlisted, true); assert.equal(r.attrMod, 0); assert.equal(r.total, 15);
  assert.match(describeRoll(r), /в списке нет/);
  assert.equal(recordRoll(c, r), null); assert.equal(c.blocks.length, 0);
});
