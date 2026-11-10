// Правила рассказчика про оформление и свободу игрока; проверка кодом разметки и меню вариантов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFormatIssues } from '../src/contradictions.js';
import { composeStorySystem, storyRequestParts } from '../src/narrator.js';
import { afterSync } from '../src/turn.js';
import { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPTS } from '../src/prompt.js';
import { makeState } from './helpers.js';

const kinds = (t) => findFormatIssues(t).map((i) => i.kind);

test('меню вариантов в конце ответа — замечание', () => {
  assert.deepEqual(kinds('Ольт ждёт ответа.\n\n1. Заплатить\n2. Уйти\n3. Напасть'), ['options']);
  assert.deepEqual(kinds('Ольт ждёт ответа.\n\nЧто ты будешь делать?'), ['options']);
  assert.deepEqual(kinds('Ольт ждёт.\n\nВарианты действий:\nа) заплатить\nб) уйти'), ['options']);
});

test('разметка — замечание; обычная проза, реплики и *действия* — нет', () => {
  assert.deepEqual(kinds('## Глава 2\nТы входишь в зал.'), ['markup']);
  assert.deepEqual(kinds('Ольт **очень** зол.'), ['markup']);
  assert.deepEqual(kinds('На столе:\n* нож\n* фляга'), ['markup']);
  assert.deepEqual(kinds('— Серебряный — и иди, — бросает Ольт. *Он косится на караульную.*\n\n— А если нет?\n— Тогда стой.'), []);
  assert.deepEqual(kinds('В списке три имени. 1. Он первым называет Риту, потом остальных.'), []);
  assert.deepEqual(kinds('— Что ты будешь делать, если он вернётся? — спрашивает Рита и отворачивается к огню.'), []);
});

test('замечание об оформлении доходит до рассказчика на следующий ход', () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Жду' }] });
  afterSync(st, 'Ольт молчит.\n\n1. Уйти\n2. Остаться');
  assert.match(st.correctionNote, /Не предлагай варианты/);
});

test('правила: имена стоят сразу за непротиворечивостью, есть свобода игрока и оформление', () => {
  const p = composeStorySystem(makeState());
  const at = (t) => { const i = p.indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at('НЕПРОТИВОРЕЧИВОСТЬ') < at('ИМЕНА — исключение из этой осторожности') && at('ИМЕНА — исключение') < at('ПОСЛЕДСТВИЯ ДЛЯ ЛИСТА'));
  assert.ok(!p.includes('это правило НЕ касается имён'));
  at('ГЕРОЙ ПРИНАДЛЕЖИТ ИГРОКУ'); at('ОФОРМЛЕНИЕ: только проза');
  // Всё это — в постоянной части запроса (кэш), а не в блоке состояния.
  const { system, late } = storyRequestParts(makeState());
  assert.ok(system.includes('ГЕРОЙ ПРИНАДЛЕЖИТ ИГРОКУ') && !late.includes('ГЕРОЙ ПРИНАДЛЕЖИТ ИГРОКУ'));
});

test('промт по умолчанию: без «создай блоки» вне раздела инструментов и без жёсткого «на ты»', () => {
  const narrative = DEFAULT_SYSTEM_PROMPT.split('Управление листами героев:')[0];
  assert.ok(!/блок/i.test(narrative));
  assert.ok(!/на «ты»/.test(DEFAULT_SYSTEM_PROMPT));
  assert.ok(/стартовые блоки/.test(DEFAULT_SYSTEM_PROMPT.split('Управление листами героев:')[1]));
  assert.ok(LEGACY_SYSTEM_PROMPTS.every((x) => x !== DEFAULT_SYSTEM_PROMPT && /на «ты»/.test(x)));
});
