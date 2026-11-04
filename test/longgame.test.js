// Долгая игра: промт рассказчика не должен расти без предела.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeStorySystem, activeLoreEntries } from '../src/narrator.js';
import { planSummary, summaryStep } from '../src/summary.js';
import { normalizeEvents } from '../src/chronicle.js';
import { makeState } from './helpers.js';

const npc = (name, over = {}) => ({ id: name, name, locked: [], description: `${name} — житель города. Держит лавку.`, attitude: 'нейтрален', updatedTurn: 1, ...over });

test('давно не появлявшиеся НПС — одной строкой с именами, без карточек', () => {
  const st = makeState({ turn: 120 });
  st.npcs = [
    npc('Лира', { lastSeen: { turn: 119, day: 30 } }),
    npc('Ольт', { lastSeen: { turn: 100, day: 25 } }),
    ...['Бруно', 'Гарт', 'Дана', 'Ёрн', 'Жак'].map((n, i) => npc(n, { lastSeen: { turn: 10 + i, day: 3 } })),
    npc('Марта', { lastSeen: { turn: 5, day: 1 } }),
  ];
  st.scene.present = ['Лира'];
  st.events = normalizeEvents([{ type: 'debt', text: 'Эйра должна Марте сто монет', participants: ['Эйра', 'Марта'] }]);
  st.messages = [{ role: 'assistant', content: 'Ты вспоминаешь Гарта и его кузницу.' }];
  const p = composeStorySystem(st);
  assert.match(p, /• Ольт — отношение: нейтрален; последняя встреча/, 'встречались недавно — строка с подробностями');
  assert.match(p, /• Гарт — /, 'упомянут в недавнем ходу — своя строка');
  assert.match(p, /• Марта — /, 'есть открытое обязательство — своя строка');
  assert.match(p, /Давно не появлялись[^\n]*Бруно, Дана, Ёрн, Жак/);
  assert.ok(!/• Бруно/.test(p));
});

test('накопительные поля обрезаются: «было с героем», образцы речи, заметки нитей', () => {
  const st = makeState({ turn: 50 });
  const history = Array.from({ length: 12 }, (_, i) => `событие ${i + 1}`).join('; ');
  st.npcs = [npc('Лира', { history, voiceSamples: ['а', 'б', 'в', 'г', 'д'] })];
  st.scene.present = ['Лира'];
  st.threads = [{ id: 't', title: 'Найти брата', status: 'open', progress: '', notes: Array.from({ length: 20 }, (_, i) => `зацепка номер ${i + 1}`).join('; ') }];
  const p = composeStorySystem(st);
  assert.match(p, /Было с героем: …; событие 9; событие 10; событие 11; событие 12/);
  assert.ok(!/событие 3;/.test(p));
  assert.match(p, /Как звучит[^\n]*«в» «г» «д»$/m);
  assert.match(p, /Известно: …[^\n]*зацепка номер 20/);
  assert.ok(!/зацепка номер 2;/.test(p));
});

test('справочник мира: по ключам — не больше пяти, свежие упоминания важнее', () => {
  const st = makeState();
  st.lorebook = Array.from({ length: 9 }, (_, i) => ({ id: 'l' + i, title: 'Запись ' + i, keys: ['ключ' + i + 'ик'], content: 'x', enabled: true }));
  st.messages = [
    { role: 'user', content: 'ключ0ик ключ1ик ключ2ик ключ3ик' },
    { role: 'assistant', content: 'ключ4ик ключ5ик' },
    { role: 'user', content: 'ключ6ик ключ7ик ключ8ик' },
  ];
  const got = activeLoreEntries(st).map((e) => e.title);
  assert.equal(got.length, 5);
  assert.deepEqual(got.slice(0, 3).sort(), ['Запись 6', 'Запись 7', 'Запись 8']);
});

test('сжатие начинается раньше: запас сверх «сырых ходов» — четверть, а не половина', () => {
  assert.equal(summaryStep(20), 5);
  assert.equal(summaryStep(6), 4);
  const st = makeState({ historyKeep: 20 });
  st.messages = Array.from({ length: 26 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
  assert.ok(planSummary(st));
  st.messages = st.messages.slice(0, 25);
  assert.equal(planSummary(st), null);
});

test('учётчик тоже видит давно ушедших только по имени', async () => {
  const { installFakeFetch, reply, call } = await import('./fake-llm.js');
  const { syncNarration } = await import('../src/sync.js');
  const st = makeState({ turn: 120 });
  st.npcs = [npc('Лира', { lastSeen: { turn: 119, day: 30 } }), npc('Бруно', { lastSeen: { turn: 10, day: 3 }, history: 'давняя история' })];
  const fake = installFakeFetch([(body) => {
    const u = body.messages[1].content;
    assert.match(u, /Давно не появлялись: Бруно\./);
    assert.ok(!/давняя история/.test(u));
    return reply('', [call('nothing', {})]);
  }]);
  try {
    const r = await syncNarration({ state: st, apiKey: 'k', narration: 'Лира молча смотрит в окно, за которым идёт долгий осенний дождь.' });
    assert.equal(r.status, 'done', r.error);
  } finally { fake.restore(); }
});
