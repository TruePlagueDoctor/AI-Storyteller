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

// Дополнения по no-ai-slop: рубленые фрагменты, перечисление отрицаний, «пустой хвост» фразы, чёрный список оборотов.
test('рубленые фрагменты в авторском тексте: три обрубка подряд — замечание; в репликах и по одному — нет', () => {
  assert.deepEqual(kinds('Ты входишь в зал. Тишина. Долгая. Тяжёлая. Мара поднимает голову.'), ['cliche-fragments']);
  assert.deepEqual(kinds('Ты входишь в зал. Тишина. Мара поднимает голову и кивает тебе.'), []);
  assert.deepEqual(kinds('— Нет. Не выход. Ловушка, — шепчет Мара.\nТы отступаешь к стене.'), [], 'реплики проверяет другое правило');
});

test('перечисление отрицаний «Не X. Не Y. Z.» — тот же штамп, что «не X, а Y»', () => {
  assert.deepEqual(kinds('Ты смотришь ей в глаза. Не страх. Не злость. Что-то третье, чему нет имени.'), ['cliche-contrast']);
  assert.deepEqual(kinds('Не спеши. Мара придержала дверь и ждёт.'), []);
});

test('«пустой хвост»: деепричастие с эффектом в конце фразы — со второго раза за ответ', () => {
  const one = 'Она наклоняется ближе, заставляя твоё сердце биться чаще. Ты молчишь.';
  assert.deepEqual(kinds(one), []);
  assert.deepEqual(kinds(one + ' Свечи горят ровно, наполняя комнату запахом воска.'), ['cliche-tail']);
  assert.deepEqual(kinds('Ольт уходит, оставляя дверь открытой. Ты входишь, подбирая с пола ключ.'), [], 'обычные деепричастия действия — не штамп');
});

test('чёрный список оборотов: находит в любом падеже и порядке слов, называет найденное', () => {
  const phrases = ['по спине пробежали мурашки', 'сердце пропустило удар', 'время словно остановилось'];
  const found = findClicheIssues('Мурашки пробежали у тебя по спине. А сердце на миг пропустило удар.', [], { phrases });
  assert.deepEqual(found.map((i) => i.kind), ['cliche-list']);
  assert.match(found[0].text, /«по спине пробежали мурашки», «сердце пропустило удар»/);
  assert.deepEqual(findClicheIssues('Ты бежишь по спине каменного моста, и сердце колотится.', [], { phrases }), []);
  assert.deepEqual(findClicheIssues('Мурашки пробежали по спине.', [], { phrases: [] }), [], 'пустой список — проверки нет');
});

test('правила рассказчика: новые пункты и список оборотов игрока — в постоянной части запроса', async () => {
  const { storyRequestParts } = await import('../src/narrator.js');
  const st = makeState({ clichePhrases: ['по спине пробежали мурашки', 'бархатный голос'] });
  const { system, late } = storyRequestParts(st);
  assert.match(system, /Без рубленых обрубков/);
  assert.match(system, /Не X\. Не Y\. Z\./);
  assert.match(system, /зови по имени или местоимением/);
  assert.match(system, /заставляя сердце биться чаще/);
  assert.match(system, /Не используй заезженные обороты: «по спине пробежали мурашки», «бархатный голос»/);
  assert.ok(!late.includes('бархатный голос'));
  assert.ok(!/Не используй заезженные обороты/.test(storyRequestParts(makeState({ clichePhrases: [] })).system));
});
