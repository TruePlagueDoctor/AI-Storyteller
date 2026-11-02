import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAbility, skillStems, skillMatches } from '../src/skills.js';
import { recordRoll, progressInfo } from '../src/progress.js';
import { rollCheck, describeRoll } from '../src/dice.js';

const abil = (name, value = 'ученик') => ({ type: 'ability', name, value });

test('умение находится по смыслу, а не только дословно', () => {
  const blocks = [abil('Взлом замков'), abil('Скрытность'), abil('Фехтование'), { type: 'item', name: 'Отмычки' }];
  assert.equal(matchAbility(blocks, 'Взлом замков').name, 'Взлом замков');
  assert.equal(matchAbility(blocks, 'взлом').name, 'Взлом замков');
  assert.equal(matchAbility(blocks, 'Вскрыть замок').name, 'Взлом замков');
  assert.equal(matchAbility(blocks, 'Скрытности').name, 'Скрытность');
  assert.equal(matchAbility(blocks, 'Владение мечом').name, 'Фехтование');
  assert.equal(matchAbility(blocks, 'Кулинария'), null);
  assert.equal(matchAbility(blocks, ''), null);
  assert.equal(matchAbility([], 'Взлом'), null);
});

test('skillStems отбрасывает предлоги и короткие слова', () => {
  assert.deepEqual(skillStems('Стрельба из лука'), ['стрел', 'лука']);
  assert.deepEqual(skillStems('Бег и прыжки'), ['прыжк']);
  assert.deepEqual(skillStems(''), []);
});

test('skillMatches: убеждение = убедить, запугивание = угроза', () => {
  assert.ok(skillMatches('убеждение', 'Убедить стражника'));
  assert.ok(skillMatches('убеждение', 'Убеждение'));
  assert.ok(skillMatches('запугивание', 'Угрозы'));
  assert.ok(skillMatches('обман', 'Обмануть'));
  assert.ok(!skillMatches('убеждение', 'Скрытность'));
  assert.ok(!skillMatches('', 'Скрытность'));
});

test('бросок: бонус по уровню, исход по порогу, умение по смыслу', () => {
  const character = { name: 'Ян', blocks: [abil('Взлом замков', 'мастер')] };
  for (let i = 0; i < 200; i++) {
    const r = rollCheck({ character, skill: 'взлом', difficulty: 'сложно' });
    assert.equal(r.skill, 'Взлом замков');
    assert.equal(r.asked, 'взлом');
    assert.equal(r.bonus, 6);
    assert.equal(r.target, 14);
    assert.equal(r.total, r.roll + 6);
    if (r.roll === 20) assert.equal(r.outcome, 'критический успех');
    else if (r.roll === 1) assert.equal(r.outcome, 'критический провал');
    else if (r.total >= 19) assert.equal(r.outcome, 'уверенный успех');
    else if (r.total >= 14) assert.equal(r.outcome, 'успех');
    else if (r.total >= 11) assert.equal(r.outcome, 'провал с зацепкой');
    else assert.equal(r.outcome, 'провал');
    assert.equal(r.success, r.outcome.includes('успех'));
  }
});

test('бросок без умения и с неизвестной сложностью', () => {
  const r = rollCheck({ character: { name: 'Ян', blocks: [] }, skill: 'Плавание', difficulty: 'адски' });
  assert.equal(r.bonus, 0);
  assert.equal(r.level, 'без подготовки');
  assert.equal(r.target, 11);
  assert.equal(r.skill, 'Плавание');
  assert.match(describeRoll(r), /ИСХОД: /);
});

test('штраф за раны: здоровье, рассудок и сила — да, кошелёк — нет', () => {
  const stat = (name, value, max) => ({ type: 'stat', name, value: String(value), max });
  const pen = (blocks) => rollCheck({ character: { name: 'Ян', blocks }, skill: 'x' }).penalty;
  assert.equal(pen([stat('Здоровье', 20, 100)]), 2);
  assert.equal(pen([stat('Здоровье', 40, 100)]), 1);
  assert.equal(pen([stat('Здоровье', 90, 100)]), 0);
  assert.equal(pen([stat('Рассудок', 2, 10)]), 2);
  assert.equal(pen([stat('Сила', 2, 10)]), 2);
  assert.equal(pen([stat('Силы', 4, 10)]), 1);
  assert.equal(pen([stat('Золото', 1, 100)]), 0);
  assert.equal(pen([stat('Силуэт', 1, 100)]), 0);
});

test('опыт: копится у существующего умения, стартовый уровень засчитан', () => {
  const ch = { name: 'Ян', blocks: [abil('Скрытность', 'ученик')], skillXp: {} };
  const ok = (outcome = 'успех') => ({ skill: 'Скрытность', outcome, success: outcome.includes('успех') });
  assert.equal(recordRoll(ch, ok()), null);
  assert.equal(ch.skillXp['скрытность'], 4); // 3 (порог ученика) + 1
  recordRoll(ch, ok());
  const grew = recordRoll(ch, ok('критический успех'));
  assert.equal(ch.skillXp['скрытность'], 7); // 4 → 5 → 7 (крит даёт 2)
  assert.match(grew, /ученик → опытный/);
  assert.equal(ch.blocks[0].value, 'опытный');
  assert.equal(recordRoll(ch, { skill: 'Скрытность', outcome: 'провал', success: false }), null);
  assert.equal(recordRoll(ch, { ...ok(), skill: 'Кулинария' }), null, 'нет умения — нет опыта');
  ch.blocks[0].locked = true;
  assert.equal(recordRoll(ch, ok()), null, 'закреплённое не растёт');
  assert.deepEqual(progressInfo(ch, 'Скрытность').next, { level: 'мастер', need: 14 });
});
