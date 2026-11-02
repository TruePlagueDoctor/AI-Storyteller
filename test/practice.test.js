// Опыт за обучение и тренировки: инструмент учётчика practice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools.js';
import { completenessHints } from '../src/sync.js';
import { makeState, hero, block } from './helpers.js';

const run = (st, args) => executeTool('practice', args, st);
const withSkills = () => {
  const st = makeState();
  hero(st).blocks = [
    { id: 'a1', type: 'ability', name: 'Фехтование', value: 'ученик' },
    { id: 'a2', type: 'ability', name: 'Травничество', value: 'новичок' },
  ];
  return st;
};

test('тренировка даёт опыт умению, найденному по смыслу', () => {
  const st = withSkills();
  const r = run(st, { skill: 'владение мечом', reason: 'час упражнялся с деревянным мечом' });
  assert.match(r, /«Фехтование»: \+1 опыта/);
  assert.equal(hero(st).skillXp['фехтование'], 4, 'стартовый уровень ученика (3) засчитан');
});

test('урок у наставника — вдвое больше, рост уровня виден', () => {
  const st = withSkills();
  hero(st).skillXp = { 'травничество': 2 };
  const r = run(st, { skill: 'Травничество', kind: 'lesson', reason: 'старая знахарка показала, как сушить корни' });
  assert.match(r, /\+2 опыта/);
  assert.match(r, /новичок → ученик/);
  assert.equal(block(st, 'Травничество').value, 'ученик');
  assert.deepEqual(st._growth, ['Ян: «Травничество» выросло — новичок → ученик (урок)']);
});

test('раз в игровой день на умение', () => {
  const st = withSkills();
  run(st, { skill: 'Фехтование', reason: 'утренняя разминка' });
  assert.match(run(st, { skill: 'Фехтование', reason: 'ещё раз' }), /уже засчитана сегодня/);
  assert.equal(hero(st).skillXp['фехтование'], 4);
  // Другое умение в тот же день — можно.
  assert.match(run(st, { skill: 'Травничество', reason: 'собирал травы' }), /\+1/);
  st.scene.day = 2;
  assert.match(run(st, { skill: 'Фехтование', reason: 'новый день' }), /\+1/);
  assert.equal(hero(st).skillXp['фехтование'], 5);
});

test('нет умения, закреплённое, мастер', () => {
  const st = withSkills();
  assert.match(run(st, { skill: 'Плавание', reason: 'плавал' }), /^Ошибка: у героя «Ян» нет умения «Плавание».*block type:ability/);
  block(st, 'Фехтование').locked = true;
  assert.match(run(st, { skill: 'Фехтование', reason: 'x' }), /закреплено игроком/);
  block(st, 'Травничество').value = 'мастер';
  assert.match(run(st, { skill: 'Травничество', reason: 'x' }), /уже мастер/);
  assert.match(run(st, { reason: 'x' }), /^Ошибка: укажи skill/);
});

test('проверка полноты напоминает о тренировке героя', () => {
  const st = withSkills();
  const text = 'До заката ты отрабатываешь выпады у старого столба, пока руки не начинают дрожать.';
  assert.ok(completenessHints(st, text, []).some((h) => /practice/.test(h)));
  assert.ok(!completenessHints(st, text, [{ name: 'practice', args: { skill: 'Фехтование' } }]).some((h) => /practice/.test(h)));
  assert.ok(!completenessHints(st, 'Стражники тренируются во дворе казармы.', []).some((h) => /practice/.test(h)), 'тренируется не герой');
  const noSkills = withSkills(); hero(noSkills).blocks = [];
  assert.ok(!completenessHints(noSkills, text, []).some((h) => /practice/.test(h)), 'умений нет — напоминать не о чем');
});
