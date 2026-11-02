// Ход с подменённой моделью: рассказ, бросок, учёт в два раунда, откаты запросов.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { runTurn } from '../src/turn.js';
import { callOpenRouter } from '../src/llm.js';
import { syncNarration } from '../src/sync.js';
import { makeState, hero, block } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const NARRATION = 'Ольт швыряет тебе флягу: «Пей, пока я добрый». Ты делаешь глоток, и рана саднит меньше. Он уходит к воротам.';

test('полный ход: рассказ → учёт → проверка полноты → второй раунд', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Прошу воды' }] });
  hero(st).blocks = [{ id: 'b1', type: 'stat', name: 'Здоровье', value: '5', max: 10 }];
  st.npcs = [{ name: 'Ольт', locked: [] }];
  st.scene.present = ['Ольт'];
  fake = installFakeFetch([
    reply(NARRATION),
    // Учётчик раунд 1: предмет и НПС, но не сцену (кто-то ушёл).
    reply('', [call('block', { type: 'item', name: 'Фляга' }), call('npc', { name: 'Ольт', history: 'дал флягу' })]),
    // Раунд 2 после проверки полноты.
    reply('', [call('scene', { present: [] }), call('block', { type: 'stat', name: 'Здоровье', value: '6' })]),
  ]);
  let before = 0;
  const out = await runTurn({ state: st, apiKey: 'k', beforeSync: () => { before++; } });
  assert.equal(out.narration, NARRATION);
  assert.equal(before, 1);
  assert.equal(out.sync.status, 'done');
  assert.ok(block(st, 'Фляга'));
  assert.equal(block(st, 'Здоровье').value, '6');
  assert.deepEqual(st.scene.present, []);
  assert.equal(st.npcs[0].history, 'дал флягу');
  assert.ok(out.sync.calls.some((c) => c.check), 'в журнале есть проверка полноты');
  // Рассказ лёг в историю, учёт — нет.
  assert.equal(st.messages.at(-1).content, NARRATION);
  assert.equal(st.messages.length, 2);
  // Запросы: учётчик — с обязательным вызовом и низкой температурой.
  assert.equal(fake.requests.length, 3);
  assert.equal(fake.requests[1].tool_choice, 'required');
  assert.equal(fake.requests[1].temperature, 0.2);
  assert.equal(fake.requests[2].tool_choice, 'auto');
});

test('бросок: модель просит проверку, исход считает код и он попадает в журнал', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Вскрываю замок' }], stateSync: false, diceEnabled: true });
  hero(st).blocks = [{ type: 'ability', name: 'Взлом замков', value: 'мастер' }];
  fake = installFakeFetch([
    (body) => {
      assert.ok(body.tools.some((t) => t.function.name === 'roll_check'));
      assert.match(body.tools.find((t) => t.function.name === 'roll_check').function.parameters.properties.skill.description, /Взлом замков \(мастер\)/);
      return reply('', [call('roll_check', { skill: 'взлом', difficulty: 'сложно' })]);
    },
    (body) => {
      const tool = body.messages.at(-1);
      assert.equal(tool.role, 'tool');
      assert.match(tool.content, /Проверка «Взлом замков» \(мастер\)/);
      return reply('Замок щёлкает.');
    },
  ]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.rolls.length, 1);
  assert.equal(out.rolls[0].skill, 'Взлом замков');
  assert.equal(out.narration, 'Замок щёлкает.');
  assert.equal(out.sync.status, 'inline');
});

test('оборванный ответ дописывается вторым запросом', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Иду' }], diceEnabled: false });
  fake = installFakeFetch([reply('Ты идёшь по улице и видишь', [], 'length'), reply('старый маяк.'), reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.narration, 'Ты идёшь по улице и видишь старый маяк.');
});

test('сбой учёта не роняет ход', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Иду' }], diceEnabled: false });
  fake = installFakeFetch([reply('Ты долго идёшь по пустой дороге, и ничего не меняется вокруг.'), { status: 500, text: 'boom' }]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.sync.status, 'failed');
  assert.match(out.sync.error, /Сбой на стороне провайдера/);
});

test('учётчик: ошибка инструмента даёт второй раунд с просьбой исправить', async () => {
  const st = makeState();
  fake = installFakeFetch([
    reply('', [call('block', { type: 'item', name: 'Ключ', action: 'remove' })]),
    (body) => { assert.match(body.messages.at(-1).content, /вернула ошибку или предупреждение/); return reply('', [call('nothing', {})]); },
  ]);
  const r = await syncNarration({ state: st, apiKey: 'k', narration: 'Ты отдаёшь ключ стражнику, и тот молча прячет его в карман своего плаща.' });
  assert.equal(r.status, 'done');
  assert.equal(r.calls[0].warn, true);
});

test('откаты: tool_choice required → auto, обязательный reasoning', async () => {
  fake = installFakeFetch([
    { status: 400, text: 'tool_choice "required" is not supported' },
    { status: 400, text: 'Reasoning is mandatory for this endpoint and cannot be disabled' },
    reply('ok'),
  ]);
  const data = await callOpenRouter({ purpose: 'тест', model: 'm/fallback', messages: [], apiKey: 'k', tools: [], toolChoice: 'required' });
  assert.equal(data.choices[0].message.content, 'ok');
  assert.equal(fake.requests[0].tool_choice, 'required');
  assert.equal(fake.requests[1].tool_choice, 'auto');
  assert.ok(fake.requests[1].reasoning);
  assert.equal(fake.requests[2].reasoning, undefined);
});

test('понятная ошибка вместо сырой', async () => {
  fake = installFakeFetch([{ status: 402, text: 'Insufficient credits' }]);
  await assert.rejects(callOpenRouter({ purpose: 'тест', model: 'm/x', messages: [], apiKey: 'k' }), /закончились деньги.*Insufficient credits/);
});
