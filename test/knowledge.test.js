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
  assert.deepEqual(st.npcs[1].lastSeen, { turn: 40, day: 9, since: 40 });
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
  assert.match(p, /Недавние перемены[^\n]*уши заострились[^\n]*ход 40[^\n]*видели: Лира/);
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

test('смена расы при превращении: в листе, в журнале перемен, со свидетелями', () => {
  const st = world();
  hero(st).race = 'человек';
  hero(st).portraitTags = '1girl, human';
  const r = executeTool('update_hero', { race: 'заражённая' }, st);
  assert.match(r, /раса/);
  assert.equal(hero(st).race, 'заражённая');
  assert.equal(hero(st).portraitTags, undefined, 'портрет больше не похож');
  assert.match(hero(st).appearanceLog.at(-1).text, /человек → заражённая/);
  assert.deepEqual(hero(st).appearanceLog.at(-1).seenBy, ['Лира']);
});

test('смена имени: прежнее — «известен также как», герой находится по любому', () => {
  const st = world();
  const r = executeTool('update_hero', { name: 'Сестра Пепел' }, st);
  assert.match(r, /прежнее «Эйра»/);
  assert.equal(hero(st).name, 'Сестра Пепел');
  assert.deepEqual(hero(st).aliases, ['Эйра']);
  executeTool('update_hero', { character: 'Эйра', social: 'послушница ордена' }, st);
  assert.equal(hero(st).social, 'послушница ордена', 'по прежнему имени — тот же герой');
  assert.match(executeTool('npc', { name: 'Эйра', attitude: 'тепло' }, st), /герой игрока/);
  const p = composeStorySystem(st);
  assert.match(p, /прежде звался: Эйра/);
  assert.match(p, /теперь зовётся «Сестра Пепел»/);
});

test('имя и раса: замки игрока, занятое имя — отказ', () => {
  const st = world();
  hero(st).locked = ['name', 'race'];
  hero(st).race = 'человек';
  const r = executeTool('update_hero', { name: 'Пепел', race: 'нежить' }, st);
  assert.match(r, /имя закреплено/);
  assert.match(r, /раса закреплена/);
  assert.equal(hero(st).name, 'Эйра');
  assert.equal(hero(st).race, 'человек');
  hero(st).locked = [];
  assert.match(executeTool('update_hero', { name: 'Лира' }, st), /уже занято/);
  assert.equal(hero(st).name, 'Эйра');
});

test('обе инструкции учётчика знают про смену расы и имени героя', async () => {
  const { composeSyncSystem } = await import('../src/sync.js');
  for (const style of ['technical', 'legacy']) {
    const p = composeSyncSystem(makeState({ syncPromptStyle: style }));
    assert.match(p, /race/, style);
    assert.match(p, /навсегда сменил имя → name|навсегда сменил имя — name/, style);
  }
});

test('положение героя — коротко: длинное не записывается и просит второй раунд', async () => {
  const { FIX_SIGNAL } = await import('../src/journal.js');
  const st = world();
  hero(st).social = 'странница';
  const r = executeTool('update_hero', { social: 'бывшая послушница ордена, сбежавшая после пожара в храме и теперь скрывающаяся от инквизиции' }, st);
  assert.match(r, /2–5 слов/);
  assert.ok(FIX_SIGNAL.test(r), 'учётчик получит второй раунд');
  assert.equal(hero(st).social, 'странница');
  assert.match(executeTool('update_hero', { social: 'беглая послушница' }, st), /положение/);
  assert.equal(hero(st).social, 'беглая послушница');
});
