// Темп истории: «спокойный» — мир живёт сам, ход не обязан кончаться выбором; «событийный» — как было раньше.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeStorySystem } from '../src/narrator.js';
import { makeState } from './helpers.js';

test('по умолчанию темп спокойный: нет требования события и выбора каждый ход', () => {
  const p = composeStorySystem(makeState());
  assert.match(p, /Мир живёт сам/);
  assert.match(p, /Спокойное занятие остаётся спокойным/);
  assert.match(p, /что делать дальше, игрок скажет сам/);
  assert.ok(!/точкой, где игроку есть что решить/.test(p));
  assert.ok(!/два тихих хода подряд допустимы, три — нет/.test(p));
  assert.ok(!/событие или наблюдение, меняющее положение героя, — всё равно нужно/.test(p));
});

test('событийный темп — прежние правила', () => {
  const p = composeStorySystem(makeState({ pace: 'driven' }));
  assert.match(p, /точкой, где игроку есть что решить/);
  assert.match(p, /два тихих хода подряд допустимы, три — нет/);
  assert.ok(!/Мир живёт сам/.test(p));
});

test('нити: в спокойном темпе о них не напоминают каждый ход', () => {
  const threads = [{ id: 't1', title: 'Долг трактирщику', status: 'open' }];
  assert.ok(!/Не давай нитям провисать/.test(composeStorySystem(makeState({ threads }))));
  assert.match(composeStorySystem(makeState({ threads, pace: 'driven' })), /Не давай нитям провисать/);
});

test('вопрос в конце запрещён в любом темпе', () => {
  for (const pace of ['calm', 'driven']) assert.match(composeStorySystem(makeState({ pace })), /Вопрос персонажа к герою в самом конце — редкость/);
});
