// Штампы ИИ-прозы в авторском тексте: проверка кодом и замечание рассказчику.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClicheIssues } from '../src/contradictions.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState } from './helpers.js';

const kinds = (t) => findClicheIssues(t).map((i) => i.kind);

test('противопоставление «не X, а Y»: пара фраз ловится сразу, мягкое — со второго раза', () => {
  assert.deepEqual(kinds('Ты смотришь на него. Это был не страх. Это было узнавание. Он делает шаг назад.'), ['cliche-contrast']);
  assert.deepEqual(kinds('То была не злость — то была усталость.'), ['cliche-contrast']);
  assert.deepEqual(kinds('Она бросает на тебя не просто взгляд — обещание.'), [], 'одно мягкое — не повод');
  assert.deepEqual(kinds('Она бросает не просто взгляд — обещание. И голос не просто тихий, а ласковый.'), ['cliche-contrast']);
});

test('обычная речь с «не … а» — не штамп', () => {
  assert.deepEqual(kinds('Ключ лежит не здесь, а в подвале. Ты спускаешься по лестнице.'), []);
  assert.deepEqual(kinds('Он не ответил, а это было странно. Ты пожимаешь плечами.'), []);
  assert.deepEqual(kinds('В этом доме было тепло. Мара разливает похлёбку по мискам.'), []);
});

test('одна такая реплика — манера персонажа; у всех и из ответа в ответ — штамп', () => {
  const a = '— Это не страх. Это злость, — бросает Мара.\nОна отворачивается.';
  const b = 'Торин хмурится: «Это не просьба. Это приказ». Он уходит.';
  assert.deepEqual(kinds(a), [], 'одна реплика в одном ответе — можно');
  assert.deepEqual(findClicheIssues(b, [a]).map((i) => i.kind), ['cliche-speech']);
  assert.deepEqual(findClicheIssues('Мара кивает и садится.', [a, b]).map((i) => i.kind), [], 'в этом ответе штампа нет — не придираемся');
  assert.deepEqual(findClicheIssues(a, ['Ольт: «Не просто совет — предупреждение». Он смеётся.']).map((i) => i.kind), ['cliche-speech']);
});

test('авторский штамп и штамп в репликах — разные замечания', () => {
  assert.deepEqual(kinds('— Это был не страх. Это было узнавание, — шепчет Мара.\nОна отворачивается к окну.'), []);
  assert.deepEqual(kinds('Мара шепчет: «Это был не страх. Это было узнавание». Она отворачивается.'), []);
});

test('рассказчик объясняет смысл и кончает афоризмом', () => {
  assert.deepEqual(kinds('Он молча кладёт руку тебе на плечо. Этот жест говорил больше слов.'), ['cliche-meta']);
  assert.deepEqual(kinds('Что-то в её взгляде заставляет тебя насторожиться. Она уходит.'), ['cliche-meta']);
  assert.deepEqual(kinds('Вы сидите у огня до самой ночи. И в этой тишине была вся правда, которую вы искали.'), ['cliche-kicker']);
  assert.deepEqual(kinds('Дверь за ним закрывается. Всё только начиналось.'), ['cliche-kicker']);
  assert.ok(kinds('Ты гасишь лампу. Иногда молчание значит больше, чем слова.').includes('cliche-kicker'));
  assert.deepEqual(kinds('Иногда он оборачивается, будто проверяет, идёшь ли ты следом. Ты идёшь.'), []);
});

test('рассказчик знает правило про штампы', () => {
  const p = composeStorySystem(makeState());
  assert.match(p, /БЕЗ ШТАМПОВ/);
  assert.match(p, /не X, а Y/);
});
