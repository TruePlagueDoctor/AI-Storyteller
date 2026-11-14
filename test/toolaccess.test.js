// Доступность инструментов рассказчику (бросок, кодекс) и непротиворечивость того, что ему о них сказано.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { runTurn } from '../src/turn.js';
import { storyRequestParts, storyMessages } from '../src/narrator.js';
import { normalizeEntry, narratorIndex } from '../src/codex.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());
const codex = () => [
  normalizeEntry({ id: 'p', title: 'Суккубы', kind: 'people', brief: 'Демоницы.' }),
  normalizeEntry({ id: 'g', title: 'Лоно-руны', kind: 'magic', brief: 'Магия суккубов.' }),
  normalizeEntry({ id: 'r1', title: 'Руна голода', kind: 'magic', brief: 'Жертва слабеет.', fields: { group: 'Лоно-руны', effect: 'слабость' } }),
  normalizeEntry({ id: 'c', title: 'Гуль', kind: 'creature', brief: 'Трупоед.', fields: { danger: 2, habitat: 'кладбища' } }),
  normalizeEntry({ id: 'c1', title: 'Гуль-матка', kind: 'creature', brief: 'Раздутая.', fields: { group: 'Гуль' } }),
  normalizeEntry({ id: 'f', title: 'Серая стража', kind: 'faction', brief: 'Городская стража.' }),
  normalizeEntry({ id: 'pl', title: 'Старый порт', kind: 'place', brief: 'Гавань.' }),
];
const turnState = (over = {}) => makeState({ messages: [{ role: 'user', content: 'Вскрываю замок' }], ...over });

test('рассказчику не говорят «инструменты недоступны», когда бросок и кодекс ему предложены', () => {
  const both = storyRequestParts(makeState({ lorebook: codex() })).system;
  assert.ok(!/инструменты недоступны/i.test(both));
  assert.match(both, /roll_check/);
  assert.match(both, /codex_lookup/);
  assert.match(both, /штатным вызовом[\s\S]{0,120}не текстом/);
  assert.match(both, /лист[\s\S]{0,80}отдельная система/i);
  // Только бросок; только кодекс; ничего.
  const dice = storyRequestParts(makeState()).system;
  assert.ok(/roll_check/.test(dice) && !/codex_lookup/.test(dice));
  const look = storyRequestParts(makeState({ diceEnabled: false, lorebook: codex() })).system;
  assert.ok(!/roll_check/.test(look) && /codex_lookup/.test(look));
  const none = storyRequestParts(makeState({ diceEnabled: false })).system;
  assert.match(none, /инструментов у тебя нет/i);
  assert.ok(!/запроси проверку/.test(none), 'без кубиков правило про проверки не зовёт к несуществующему инструменту');
});

test('служебный блок не запрещает то, чего требуют решения персонажей; формулировки без рода', () => {
  const st = turnState({ lorebook: codex() });
  st.npcs = [{ id: 'n', name: 'Лилит', self: true, secret: 'служит культу', description: 'Суккуб', locked: [] }];
  st.scene.present = ['Лилит'];
  st._voices = [{ name: 'Лилит', decision: 'Лилит молчит', line: 'Зачем тебе?', tell: '' }];
  const last = storyMessages(st).at(-1).content;
  assert.ok(!/не пересказывай и не цитируй/.test(last));
  assert.match(last, /слова персонажа: «Зачем тебе\?»/);
  assert.ok(!/его слова|знает только он сам/.test(last));
  assert.ok(!/помеха или средство/.test(last));
});

test('оглавление кодекса: правила не съедают место названий — все разделы на месте', () => {
  const idx = narratorIndex(makeState({ lorebook: codex() }));
  for (const part of ['Бестиарий: Гуль', 'Народы: Суккубы', 'Фракции: Серая стража', 'Места: Старый порт', 'Магия и явления: Лоно-руны']) assert.ok(idx.includes(part), part);
  assert.ok(!/и ещё \d/.test(idx), idx.split('\n').slice(1).join(' | '));
});

test('последний раунд — без инструментов: модель, которая только бросает, всё равно обязана написать сцену', async () => {
  const st = turnState({ stateSync: true });
  const rollCall = () => reply('', [call('roll_check', { skill: 'Взлом', difficulty: 'обычно' })]);
  fake = installFakeFetch([rollCall(), rollCall(), rollCall(),
    (body) => { assert.equal(body.tool_choice, 'none', 'в последнем раунде вызов инструмента запрещён'); return reply('Замок щёлкает. Дверь приоткрывается.'); },
    reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.narration, 'Замок щёлкает. Дверь приоткрывается.');
  assert.equal(out.rolls.length, 3);
});

test('бросок без названия умения — ошибка с подсказкой, а не бессмысленный бросок', async () => {
  const st = turnState();
  fake = installFakeFetch([
    reply('', [call('roll_check', {})]),
    (body) => { assert.match(body.messages.at(-1).content, /не указано, что проверяем/); return reply('', [call('roll_check', { skill: 'Взлом', difficulty: 'сложно' })]); },
    reply('Замок не поддаётся или поддаётся — как решил бросок.'),
    reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.rolls.length, 1);
  assert.equal(out.rolls[0].skill, 'Взлом');
});

test('вызов броска «утёк» в текст — он исполняется, а в рассказ разметка не попадает', async () => {
  const st = turnState();
  const leaked = 'Ты наклоняешься к замку.\n<|DSML|function_calls>\n<|DSML|invoke name="roll_check">\n<|DSML|parameter name="skill">Взлом</|DSML|parameter>\n<|DSML|parameter name="difficulty">сложно</|DSML|parameter>\n</|DSML|invoke>';
  fake = installFakeFetch([
    reply(leaked),
    (body) => { assert.match(body.messages.at(-1).content, /Проверка «Взлом»[\s\S]*ИСХОД:/); return reply('Отмычка проворачивается, и дужка отходит.'); },
    reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.rolls.length, 1);
  assert.ok(!/DSML|invoke/.test(out.narration));
  assert.match(out.narration, /Отмычка проворачивается/);
});

test('модель или провайдер не умеют инструменты — ход идёт без них, а не падает', async () => {
  const st = turnState({ lorebook: codex() });
  fake = installFakeFetch([
    { status: 404, text: '{"error":{"message":"No endpoints found that support tool use."}}' },
    { status: 404, text: '{"error":{"message":"No endpoints found that support tool use."}}' },
    (body) => { assert.equal(body.tools, undefined); return reply('Замок старый; ты возишься с ним долго, но он уступает.'); },
    reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.match(out.narration, /Замок старый/);
  assert.match(out.toolsNote || '', /без бросков и кодекса/);
});
