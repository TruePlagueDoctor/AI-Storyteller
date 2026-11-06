// Ответы не заканчиваются вечными вопросами и не переспрашивают решённое.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuestionIssues } from '../src/contradictions.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState } from './helpers.js';

const withHistory = (...narr) => makeState({ messages: narr.flatMap((t) => [{ role: 'user', content: 'ход' }, { role: 'assistant', content: t }]) });

test('переспрашивание решённого — замечание', () => {
  for (const t of ['Ольт хмурится: «Уверен? Обратной дороги не будет».', 'Марта прищуривается. — Ты точно этого хочешь?', '— Не передумал? — спрашивает капитан.', '«Согласен?» — уточняет он ещё раз.']) {
    const st = withHistory(t);
    assert.ok(findQuestionIssues(st, t).some((i) => i.kind === 'reconfirm'), t);
  }
  for (const t of ['— Сколько стоит переправа? — спрашиваешь ты. — Две монеты, — отвечает лодочник.', 'Он уверен, что ты вернёшься. Дверь закрывается.']) {
    assert.ok(!findQuestionIssues(withHistory(t), t).some((i) => i.kind === 'reconfirm'), t);
  }
});

test('три ответа подряд заканчиваются вопросом — замечание, два — ещё нет', () => {
  const q = (s) => `Ольт смотрит на тебя. — ${s}?`;
  let st = withHistory(q('Куда пойдём'), q('А деньги есть'), q('Ну так что'));
  assert.ok(findQuestionIssues(st, q('Ну так что')).some((i) => i.kind === 'question-endings'));
  st = withHistory('Дверь хлопает.', q('А деньги есть'), q('Ну так что'));
  assert.ok(!findQuestionIssues(st, q('Ну так что')).some((i) => i.kind === 'question-endings'));
  // Вопрос в конце с закрывающей кавычкой тоже считается.
  st = withHistory('— Куда? —', '«Кто там?»', '«Зачем?»');
  assert.ok(findQuestionIssues(st, '«Зачем?»').some((i) => i.kind === 'question-endings'));
});

test('правило концовки в промте: не обязательно вопрос, решённое не переспрашивать', () => {
  const p = composeStorySystem(makeState());
  assert.ok(!/Заканчивай ход не настроением, а точкой, где игроку есть что решить или на что ответить\.\n/.test(p));
  assert.match(p, /не переспрашивай/i);
  assert.match(p, /не обязательно вопрос/i);
});
