import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScene, dayPart, clockLabel, advanceClock, parseTimeHint, sceneBlock, sceneForSync, emptyScene } from '../src/scene.js';

test('normalizeScene чинит мусор', () => {
  const s = normalizeScene({ present: [' Ольт ', '', 5], minute: 5000, day: -2, locked: 'x' });
  assert.deepEqual(s.present, ['Ольт', '5']);
  assert.equal(s.minute, 1439);
  assert.equal(s.day, 1);
  assert.deepEqual(s.locked, []);
  assert.equal(normalizeScene(null).minute, 540);
  assert.equal(normalizeScene({ minute: 'мусор' }).minute, 540, 'непонятное время — стартовое, а не полночь');
  assert.equal(normalizeScene({ minute: 0 }).minute, 0);
});

test('часы: перевал через полночь и подписи', () => {
  const s = emptyScene();
  s.minute = 22 * 60;
  assert.equal(advanceClock(s, 180), 1);
  assert.equal(s.day, 2);
  assert.equal(s.minute, 60);
  assert.equal(clockLabel(s), 'день 2, 01:00 (глубокая ночь)');
  assert.equal(advanceClock(s, -5), 0);
  assert.equal(dayPart(12 * 60), 'день');
  assert.equal(dayPart(20 * 60), 'вечер');
});

test('parseTimeHint: часы и слова', () => {
  assert.deepEqual(parseTimeHint('ровно в 18:30'), { minute: 18 * 60 + 30, exact: true });
  assert.deepEqual(parseTimeHint('на рассвете'), { minute: 360 });
  assert.deepEqual(parseTimeHint('в полдень'), { minute: 720 });
  assert.deepEqual(parseTimeHint('поздним вечером'), { minute: 19 * 60 });
  assert.deepEqual(parseTimeHint('днём'), { minute: 14 * 60 });
  assert.equal(parseTimeHint('когда-нибудь'), null);
});

test('блоки сцены для промтов', () => {
  const s = normalizeScene({ location: 'Таверна', present: ['Ольт'], note: 'дождь', locked: ['location'] });
  const st = { npcs: [{ name: 'Голос', bound: true }] };
  const b = sceneBlock(s, st);
  assert.match(b, /Место: Таверна/);
  assert.match(b, /Рядом с героем: Ольт/);
  assert.match(b, /Всегда с героем.*Голос/);
  assert.match(sceneForSync(s), /закреплено игроком: location/);
  assert.equal(sceneBlock(null), '');
});
