// Отношения НПС — у каждого героя свои: подмена при смене героя, перенос старых партий, спутники.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchRelations, dropRelations, migrateRelations, reconcileRelations } from '../src/relations.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState } from './helpers.js';

const two = () => {
  const st = makeState({ turn: 20 });
  st.characters.push({ id: 'h2', name: 'Мира', persona: '', blocks: [], skillXp: {}, present: false, appearance: '', social: '' });
  st.npcs = [
    { id: 'n1', name: 'Ольт', description: 'Стражник', attitude: 'дружелюбен', history: 'Ян вернул ему долг', lastSeen: { turn: 19, day: 3, since: 18 }, locked: [] },
    { id: 'n2', name: 'Рита', description: 'Трактирщица', attitude: '', history: '', locked: [] },
  ];
  st.scene.present = ['Ольт'];
  return st;
};

test('смена героя: новому — чистый лист, при возврате прежнему всё возвращается', () => {
  const st = two();
  switchRelations(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.equal(st.npcs[0].attitude, '');
  assert.equal(st.npcs[0].history, '');
  assert.equal(st.npcs[0].lastSeen, undefined);
  assert.equal(st.npcs[1].perHero, undefined, 'пустое не храним');
  st.characters[0].scene = { location: 'Порт' }; st.scene.location = 'Ворота'; // Ян остался в другом месте
  st.npcs[0].attitude = 'подозрителен'; st.npcs[0].history = 'Мира нагрубила'; st.npcs[0].lastSeen = { turn: 21, day: 3, since: 21 };
  switchRelations(st, 'h2', 'h1'); st.activeCharacterId = 'h1';
  assert.equal(st.npcs[0].attitude, 'дружелюбен');
  assert.equal(st.npcs[0].history, 'Ян вернул ему долг');
  assert.deepEqual(st.npcs[0].lastSeen, { turn: 19, day: 3, since: 18 });
  assert.deepEqual(st.npcs[0].perHero, { h2: { attitude: 'подозрителен', history: 'Мира нагрубила', lastSeen: { turn: 21, day: 3, since: 21 } } });
});

test('спутник, который был рядом, знаком с теми, кто в сцене', () => {
  const st = two();
  st.characters[1].present = true; // Мира идёт вместе с Яном
  st.npcs.push({ id: 'n3', name: 'Герт', attitude: 'враждебен', history: 'Ян его ограбил', lastSeen: { turn: 3, day: 1 }, locked: [] }); // не в сцене
  switchRelations(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.equal(st.npcs[0].attitude, 'дружелюбен', 'Ольт рядом — видел обоих');
  assert.equal(st.npcs[2].attitude, '', 'Герта Мира не встречала');
});

test('рассказчик знает, что с этим героем персонаж не встречался', () => {
  const st = two();
  st.npcs[0].description = 'Стражник'; st.scene.present = [];
  switchRelations(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.match(composeStorySystem(st), /Ольт — с этим героем не встречался/);
  switchRelations(st, 'h2', 'h1'); st.activeCharacterId = 'h1';
  const p = composeStorySystem(st);
  assert.match(p, /Ольт — отношение: дружелюбен; последняя встреча с героем: день 3/);
  assert.ok(!/не встречался/.test(p.split('Рита')[0]));
});

test('один герой — ничего не меняется и ничего лишнего не хранится', () => {
  const st = makeState();
  st.npcs = [{ id: 'n1', name: 'Ольт', attitude: 'дружелюбен', history: 'x', locked: [] }];
  const before = JSON.stringify(st.npcs);
  migrateRelations(st);
  assert.equal(JSON.stringify(st.npcs), before);
  assert.ok(!/не встречался/.test(composeStorySystem(st)));
});

test('старая партия с двумя героями: прежнее отношение остаётся у обоих, потом расходится', () => {
  const st = two();
  migrateRelations(st);
  assert.deepEqual(Object.keys(st.npcs[0].perHero), ['h2']);
  migrateRelations(st); // повторно — без изменений
  switchRelations(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.equal(st.npcs[0].attitude, 'дружелюбен', 'никто не «забыл» знакомых');
  st.npcs[0].attitude = 'зол на Миру';
  switchRelations(st, 'h2', 'h1'); st.activeCharacterId = 'h1';
  assert.equal(st.npcs[0].attitude, 'дружелюбен');
});

test('снимок: отношения возвращаются тому герою, чьи они, даже если активен другой', () => {
  const st = two();
  st.relationsPerHero = true;
  const snapNpcs = JSON.parse(JSON.stringify(st.npcs)); // снимок сделан, когда играл Ян
  switchRelations(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  st.npcs = snapNpcs; // откат мира к снимку, активной осталась Мира
  reconcileRelations(st, { relFor: 'h1' });
  assert.equal(st.npcs[0].attitude, '', 'для Миры Ольт по-прежнему незнакомец');
  assert.equal(st.npcs[0].perHero.h1.attitude, 'дружелюбен');
  // Снимок старого образца (до правки): отношение было общим.
  st.npcs = JSON.parse(JSON.stringify(two().npcs));
  reconcileRelations(st, { activeCharacterId: 'h1' });
  assert.equal(st.npcs[0].attitude, 'дружелюбен');
  assert.equal(st.npcs[0].perHero.h1.attitude, 'дружелюбен');
});

test('удалённый герой не оставляет следов', () => {
  const st = two();
  switchRelations(st, 'h1', 'h2');
  dropRelations(st, 'h1');
  assert.equal(st.npcs[0].perHero, undefined);
});
