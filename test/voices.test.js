// Персонаж «играет сам»: отдельный запрос с его карточкой и знаниями, решение уходит рассказчику.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { runTurn, markSeen } from '../src/turn.js';
import { voiceCandidates, voiceMessages, parseVoice, MAX_VOICES } from '../src/voices.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState, hero } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const npc = (name, over = {}) => ({ id: name, name, description: `${name} — человек`, secret: '', locked: [], ...over });
const world = (over = {}) => {
  const st = makeState({ diceEnabled: false, turn: 5, messages: [
    { role: 'user', content: 'Подхожу к воротам', hero: 'h1' },
    { role: 'assistant', content: 'Ольт поднимает алебарду.', hero: 'h1' },
    { role: 'user', content: 'Ольт, пропусти меня', hero: 'h1' },
  ], ...over });
  st.npcs = [
    npc('Ольт', { self: true, secret: 'берёт взятки от контрабандистов', wants: 'спокойной смены', history: 'пустил героя вчера', lastSeen: { turn: 4, day: 1, since: 4 } }),
    npc('Рита', { secret: 'беглая баронесса' }),
  ];
  st.scene.location = 'Городские ворота'; st.scene.present = ['Ольт', 'Рита'];
  hero(st).blocks = [{ id: 'b1', type: 'item', name: 'Краденый перстень' }];
  st.events = [
    { id: 'e1', type: 'promise', text: 'Ольт обещал пропустить за серебряный', participants: ['Ян', 'Ольт'], knownBy: [], status: 'open' },
    { id: 'e2', type: 'secret', text: 'Ян украл перстень у ювелира', participants: ['Ян'], knownBy: [], status: 'open' },
  ];
  return st;
};

test('без отметки никого не спрашиваем; отсутствующих и архивных — тоже', () => {
  const st = world();
  st.npcs[0].self = false;
  assert.deepEqual(voiceCandidates(st), []);
  st.npcs[0].self = true; st.scene.present = ['Рита'];
  assert.deepEqual(voiceCandidates(st), []);
  st.scene.present = ['Ольт']; st.npcs[0].archived = true;
  assert.deepEqual(voiceCandidates(st), []);
});

test('не больше двух за ход; первым — тот, к кому обращается игрок', () => {
  const st = world();
  st.npcs = ['Анна', 'Борис', 'Ольт'].map((n) => npc(n, { self: true }));
  st.scene.present = ['Анна', 'Борис', 'Ольт'];
  const picked = voiceCandidates(st).map((n) => n.name);
  assert.equal(picked.length, MAX_VOICES);
  assert.equal(picked[0], 'Ольт', 'назван в ходе игрока (и в падеже «Ольта» тоже найдётся)');
});

test('персонаж видит свою тайну и свои факты, но не чужие тайны и не лист героя', () => {
  const st = world();
  const text = voiceMessages(st, st.npcs[0]).map((m) => m.content).join('\n');
  for (const must of ['берёт взятки', 'спокойной смены', 'пустил героя вчера', 'обещал пропустить за серебряный', 'Городские ворота', 'Ольт, пропусти меня', 'Ольт поднимает алебарду']) assert.ok(text.includes(must), must);
  for (const no of ['беглая баронесса', 'Краденый перстень', 'украл перстень']) assert.ok(!text.includes(no), `не должен знать: ${no}`);
});

test('только что вошедший не слышал прежних реплик', () => {
  const st = world();
  st.npcs[0].lastSeen = { turn: 1, day: 1, since: 1 }; // давно не виделись
  const text = voiceMessages(st, st.npcs[0]).map((m) => m.content).join('\n');
  assert.ok(!text.includes('Подхожу к воротам'));
  assert.match(text, /только что оказался в этой сцене/);
});

test('markSeen ведёт счёт, с какого хода персонаж рядом без перерыва', () => {
  const st = world({ turn: 5 });
  markSeen(st);
  assert.deepEqual(st.npcs[0].lastSeen, { turn: 5, day: 1, since: 4 });
  assert.equal(st.npcs[1].lastSeen.since, 5, 'у Риты встреч не было — счёт с этого хода');
  st.turn = 9; markSeen(st);
  assert.equal(st.npcs[0].lastSeen.since, 9, 'после перерыва счёт начинается заново');
});

test('разбор ответа: метки, прочерки, проза без меток', () => {
  assert.deepEqual(parseVoice('РЕШЕНИЕ: не пускать\nРЕПЛИКА: «Бумаги покажи.»\nВЫДАЁТ: —'), { decision: 'не пускать', line: 'Бумаги покажи.', tell: '' });
  assert.deepEqual(parseVoice('**Решение** — тянуть время\nРеплика: —\nВыдает: косится на дверь'), { decision: 'тянуть время', line: '', tell: 'косится на дверь' });
  assert.equal(parseVoice('Ольт молча качает головой.').decision, 'Ольт молча качает головой.');
  assert.equal(parseVoice(''), null);
});

test('ход: персонаж решает до рассказа, рассказчик получает решение, но не тайну', async () => {
  const st = world();
  fake = installFakeFetch([
    (body) => {
      assert.match(body.messages[0].content, /^Ты играешь одного персонажа/);
      assert.ok(body.max_tokens <= 400);
      return reply('РЕШЕНИЕ: содрать серебряный\nРЕПЛИКА: Серебряный — и иди.\nВЫДАЁТ: оглядывается на караульную');
    },
    (body) => {
      const prompt = body.messages.map((m) => m.content).join('\n');
      assert.match(prompt, /ПЕРСОНАЖИ, КОТОРЫЕ РЕШИЛИ САМИ[\s\S]*Ольт — намерение: содрать серебряный; говорит: «Серебряный — и иди\.»; снаружи заметно: оглядывается на караульную/);
      assert.ok(!prompt.includes('берёт взятки'), 'тайну играющего сам рассказчик не видит');
      assert.ok(prompt.includes('беглая баронесса'), 'тайны остальных — как раньше');
      return reply('— Серебряный — и иди, — бросает Ольт, оглянувшись на караульную.');
    },
    reply('', [call('nothing', {})]),
  ]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.deepEqual(out.voices, [{ name: 'Ольт', decision: 'содрать серебряный', line: 'Серебряный — и иди.', tell: 'оглядывается на караульную' }]);
  assert.equal(out.timing.voices.length, 1);
  assert.ok(!('_voices' in st), 'решение живёт один ход и в сохранение не попадает');
  assert.equal(st.messages.length, 4);
});

test('сбой запроса персонажа ход не срывает', async () => {
  const st = world();
  fake = installFakeFetch([{ status: 500, text: 'boom' }, reply('Ольт молчит и смотрит мимо.'), reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.voices, undefined);
  assert.match(out.narration, /Ольт молчит/);
});

test('вне истории (OOC) персонажей не спрашиваем', async () => {
  const st = world();
  fake = installFakeFetch([reply('Отвечаю как рассказчик.')]);
  await runTurn({ state: st, apiKey: 'k', skipSync: true });
  assert.equal(fake.requests.length, 1);
});

test('без отметки промт рассказчика прежний: тайна видна, лишних разделов нет', () => {
  const st = world();
  delete st.npcs[0].self;
  const p = composeStorySystem(st);
  assert.ok(p.includes('СКРЫВАЕТ (герой не знает): берёт взятки'));
  assert.ok(!p.includes('РЕШИЛИ САМИ'));
});
