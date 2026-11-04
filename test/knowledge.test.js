// Кто что знает о герое: последняя встреча НПС с героем и кто видел перемены внешности.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools.js';
import { markSeen } from '../src/turn.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState, hero } from './helpers.js';

const world = () => {
  const st = makeState({ turn: 40 });
  hero(st).name = 'Эйра';
  hero(st).appearance = 'Стройная девушка, тёмные волосы до лопаток, серые глаза.';
  st.npcs = [
    { id: 'p', name: 'Принц Аларик', locked: [], lastSeen: { turn: 12, day: 2 } },
    { id: 'l', name: 'Лира', locked: [] },
  ];
  st.scene.present = ['Лира'];
  st.scene.day = 9;
  return st;
};

test('после хода присутствующие НПС отмечаются как видевшие героя', () => {
  const st = world();
  markSeen(st);
  assert.deepEqual(st.npcs[1].lastSeen, { turn: 40, day: 9 });
  assert.deepEqual(st.npcs[0].lastSeen, { turn: 12, day: 2 }, 'отсутствующий — без изменений');
});

test('перемена внешности помнит, кто её видел, и узнаётся новыми свидетелями', () => {
  const st = world();
  executeTool('update_hero', { appearance_change: 'уши заострились, как у эльфов' }, st);
  const log = hero(st).appearanceLog;
  assert.equal(log.length, 1);
  assert.equal(log[0].turn, 40);
  assert.deepEqual(log[0].seenBy, ['Лира']);
  st.turn = 41; st.scene.present = ['Принц Аларик'];
  markSeen(st);
  assert.deepEqual(hero(st).appearanceLog[0].seenBy, ['Лира', 'Принц Аларик']);
});

test('рассказчик видит, кто не знает о переменах и когда НПС последний раз встречал героя', () => {
  const st = world();
  executeTool('update_hero', { appearance_change: 'уши заострились, как у эльфов' }, st);
  markSeen(st);
  const p = composeStorySystem(st);
  assert.match(p, /Недавние перемены во внешности[^\n]*уши заострились[^\n]*ход 40[^\n]*видели: Лира/);
  assert.match(p, /Принц Аларик[^\n]*последняя встреча с героем: день 2/);
  assert.ok(!/Лира[^\n]*последняя встреча/.test(p), 'тот, кто рядом, — без пометки');
  assert.match(p, /ЗНАНИЕ ПЕРСОНАЖЕЙ/);
});

test('темы сценария — не «в каждой сцене устами персонажей»', () => {
  const st = makeState({ scenarioPrompt: 'Темы: превращение, сны, ночь' });
  const p = composeStorySystem(st);
  assert.match(p, /Темы: превращение, сны, ночь/);
  assert.ok(!/в каждой сцене/.test(p));
  assert.ok(!/держи в каждом ходу/.test(p));
});
