import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceStatuses, statusRollMod, describeStatus, normalizeStatusCatalog, findStatusDef } from '../src/statuses.js';
import { traitModifier } from '../src/traits.js';
import { makeState, hero } from './helpers.js';

test('статусы: яд тикает, длительность считается со следующего хода', () => {
  const st = makeState({ turn: 5 });
  hero(st).blocks = [
    { type: 'stat', name: 'Здоровье', value: '10', max: 20 },
    { type: 'status', name: 'Отравлен', sinceTurn: 4 },
  ];
  const r1 = advanceStatuses(st);
  assert.equal(hero(st).blocks[0].value, '7');
  assert.match(r1[0], /Здоровье -3 \(7\/20\)/);
  assert.equal(hero(st).blocks[1].duration, 3, 'свежий статус не теряет ход');
  st.turn = 6; advanceStatuses(st);
  st.turn = 7; advanceStatuses(st);
  st.turn = 8; const last = advanceStatuses(st);
  assert.ok(last.some((x) => /прошёл/.test(x)));
  assert.equal(hero(st).blocks.length, 1);
  assert.equal(hero(st).blocks[0].value, '0', 'не ниже нуля');
});

test('статусы отсутствующего героя не тикают', () => {
  const st = makeState();
  st.characters.push({ id: 'h2', name: 'Рита', present: false, blocks: [{ type: 'status', name: 'Измотан', duration: 1 }] });
  advanceStatuses(st);
  assert.equal(st.characters[1].blocks.length, 1);
});

test('модификатор бросков от статусов и описание', () => {
  const cat = normalizeStatusCatalog(null);
  const ch = { blocks: [{ type: 'status', name: 'Отравлен' }, { type: 'status', name: 'вдохновлён' }, { type: 'status', name: 'Своё', rollMod: -1 }] };
  assert.deepEqual(statusRollMod(cat, ch).mod, -1);
  assert.equal(describeStatus(cat, { name: 'Отравлен', duration: 2 }), 'Отравлен (-2 к броскам, Здоровье -3/ход, 2 хода)');
  assert.equal(describeStatus(cat, { name: 'Ярлык' }), 'Ярлык');
  assert.ok(findStatusDef(cat, 'отравлен'));
});

test('normalizeStatusCatalog чистит ввод', () => {
  const c = normalizeStatusCatalog([{ name: ' Боль ', rollMod: '-2', tick: { stat: 'Здоровье', delta: '-1' }, duration: '' }, { name: '' }]);
  assert.deepEqual(c, [{ name: 'Боль', rollMod: -2, tick: { stat: 'Здоровье', delta: -1 }, duration: null }]);
  assert.equal(normalizeStatusCatalog(null).length > 10, true);
});

test('черты цели влияют на бросок, даже если навык назван иначе', () => {
  const pool = [
    { label: 'Упрямый', effect: { skill: 'убеждение', mod: -3, note: 'туго' } },
    { label: 'Трусливый', effect: { skill: 'запугивание', mod: 3 } },
  ];
  assert.equal(traitModifier(pool, ['Упрямый'], 'Убеждение').mod, -3);
  assert.equal(traitModifier(pool, ['упрямый'], 'Убедить стражника').mod, -3);
  assert.equal(traitModifier(pool, ['Трусливый'], 'Угрозы').mod, 3);
  assert.equal(traitModifier(pool, ['Упрямый'], 'Скрытность').mod, 0);
  assert.equal(traitModifier(pool, ['Нет такой'], 'Убеждение').mod, 0);
});
