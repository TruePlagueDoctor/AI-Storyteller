// Обстоятельства в броске: подготовка и продуманный план игрока дают преимущество, спешка и негодные средства — помеху.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { rollCheck, describeRoll, EDGE_MOD } from '../src/dice.js';
import { ROLL_TOOL } from '../src/tools.js';
import { composeStorySystem } from '../src/narrator.js';
import { runTurn } from '../src/turn.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());
const hero = { name: 'Ян', blocks: [] };
const avg = (opts, n = 400) => { let s = 0; for (let i = 0; i < n; i++) { const r = rollCheck({ character: hero, skill: 'Взлом', difficulty: 'обычно', ...opts }); s += r.total - r.roll; } return s / n; };

test('преимущество и помеха меняют итог броска на заданную величину', () => {
  assert.deepEqual(EDGE_MOD, { 'помеха': -2, 'нет': 0, 'преимущество': 2, 'большое преимущество': 4 });
  assert.equal(avg({ edge: 'преимущество', edgeReason: 'заранее подпилил решётку' }), 2);
  assert.equal(avg({ edge: 'большое преимущество', edgeReason: 'ключ от хозяина и ночь без стражи' }), 4);
  assert.equal(avg({ edge: 'помеха', edgeReason: 'ломает замок на бегу' }), -2);
  assert.equal(avg({}), 0);
  assert.equal(avg({ edge: 'ерунда', edgeReason: 'x' }), 0, 'неизвестное значение — без изменений');
});

test('преимущество без названной причины не засчитывается, помеха — засчитывается', () => {
  const r = rollCheck({ character: hero, skill: 'Взлом', difficulty: 'обычно', edge: 'большое преимущество', edgeReason: '  ' });
  assert.equal(r.edge, 0);
  assert.match(describeRoll(r), /преимущество не засчитано: не названо, чем оно заслужено/i);
  assert.equal(rollCheck({ character: hero, skill: 'Взлом', difficulty: 'обычно', edge: 'помеха' }).edge, -2);
});

test('в описании броска видно слагаемое и причина', () => {
  const r = rollCheck({ character: hero, skill: 'Взлом', difficulty: 'обычно', edge: 'преимущество', edgeReason: 'заранее подпилил решётку' });
  assert.equal(r.total, r.roll + 2);
  assert.equal(r.edgeReason, 'заранее подпилил решётку');
  assert.match(describeRoll(r), /\+ 2 \(обстоятельства: заранее подпилил решётку\)/);
});

test('рассказчик знает правило: сложность — о задаче, обстоятельства — о подходе игрока', () => {
  const p = ROLL_TOOL.function.parameters.properties;
  assert.deepEqual(p.edge.enum, ['помеха', 'нет', 'преимущество', 'большое преимущество']);
  assert.ok(p.edge_reason);
  assert.match(ROLL_TOOL.function.description, /подготов/);
  const rules = composeStorySystem(makeState());
  assert.match(rules, /продуманн[\s\S]{0,200}преимущество/i);
  assert.match(rules, /исход (уже )?не вызывает сомнений[\s\S]{0,80}без проверки/);
});

test('ход: преимущество из вызова рассказчика доходит до броска и записи под ответом', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Ночью, когда стража сменилась, открываю замок подобранным заранее ключом' }] });
  fake = installFakeFetch([
    reply('', [call('roll_check', { skill: 'Взлом', difficulty: 'сложно', edge: 'большое преимущество', edge_reason: 'ключ подобран заранее, стражи нет' })]),
    (body) => { assert.match(body.messages.at(-1).content, /\+ 4 \(обстоятельства: ключ подобран заранее, стражи нет\)/); return reply('Замок поддаётся. Дверь открыта.'); },
    reply('', [call('nothing', {})]),
  ]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.rolls[0].edge, 4);
  assert.equal(out.rolls[0].edgeReason, 'ключ подобран заранее, стражи нет');
  assert.equal(out.rolls[0].total, out.rolls[0].roll + 4);
});
