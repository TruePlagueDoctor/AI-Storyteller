import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueOf, isOverdue, normalizeEvents, findSimilar, selectForNarrator, chronicleBlock, chronicleForSync, looksTimed } from '../src/chronicle.js';

const ev = (o) => normalizeEvents([{ text: 'x', ...o }])[0];

test('normalizeEvents: пустые выброшены, поля приведены', () => {
  const list = normalizeEvents([{ text: '  ' }, null, { text: 'Долг', type: 'debt', status: 'done', outcome: 'zzz', at: { day: '2', minute: 'x' } }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'debt');
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].outcome, '');
  assert.deepEqual(list[0].at, { day: 2, minute: 0 });
  assert.ok(list[0].id);
  assert.equal(normalizeEvents('мусор').length, 0);
});

test('сроки: «в полдень», записанное вечером, — это завтра', () => {
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'в полдень', at: { day: 1, minute: 600 } })), { day: 1, minute: 720 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'в полдень', at: { day: 1, minute: 1200 } })), { day: 2, minute: 720 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'завтра вечером', at: { day: 3, minute: 600 } })), { day: 4, minute: 1140 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'послезавтра', at: { day: 3, minute: 600 } })), { day: 5, minute: 720 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'через 2 часа', at: { day: 1, minute: 1380 } })), { day: 2, minute: 60 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'через три дня', at: { day: 1, minute: 600 } })), { day: 4, minute: 600 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'через неделю', at: { day: 1, minute: 600 } })), { day: 8, minute: 600 });
  assert.deepEqual(dueOf(ev({ type: 'plan', when: 'через пару часов', at: { day: 1, minute: 600 } })), { day: 1, minute: 720 });
  assert.equal(dueOf(ev({ type: 'plan', when: 'когда-нибудь', at: { day: 1, minute: 0 } })), null);
  assert.equal(dueOf(ev({ type: 'plan', when: 'в полдень' })), null, 'без момента записи срока нет');
  // Срок из самого текста факта.
  assert.deepEqual(dueOf(ev({ type: 'fact', text: 'В полдень героя ждут на приёме', at: { day: 1, minute: 480 } })), { day: 1, minute: 720 });
});

test('isOverdue: только открытые и только после срока', () => {
  const e = ev({ type: 'plan', when: '18:00', at: { day: 1, minute: 600 } });
  assert.equal(isOverdue(e, { day: 1, minute: 1000 }), false);
  assert.equal(isOverdue(e, { day: 1, minute: 1100 }), true);
  e.status = 'done';
  assert.equal(isOverdue(e, { day: 9, minute: 0 }), false);
  assert.equal(isOverdue(e, null), false);
});

test('findSimilar ловит переформулировку, но не случайное совпадение', () => {
  const events = normalizeEvents([
    { text: 'Альберт обещал Роланду вернуть меч до зимы' },
    { text: 'Марта солгала страже о своём брате' },
  ]);
  assert.equal(findSimilar(events, 'Альберт пообещал Роланду вернуть меч').text, events[0].text);
  assert.equal(findSimilar(events, 'Роланд купил коня'), null);
  assert.equal(findSimilar(events, 'да'), null);
});

test('выборка для рассказчика: обязательства всегда, остальное — по сцене и теме', () => {
  const events = normalizeEvents([
    { turn: 1, type: 'debt', text: 'Ян должен Ольту двадцать золотых', participants: ['Ян', 'Ольт'] },
    { turn: 2, type: 'fact', text: 'Марта служит в приюте семь лет', participants: ['Марта'] },
    { turn: 3, type: 'fact', text: 'Старый маяк сгорел прошлой зимой', participants: [] },
    { turn: 4, type: 'lie', text: 'Марта солгала Яну о брате', participants: ['Марта', 'Ян'], knownBy: ['Марта'] },
  ]);
  const ids = (sel) => sel.map((e) => e.turn);
  assert.deepEqual(ids(selectForNarrator(events, { sceneNames: [] })), [1]);
  assert.deepEqual(ids(selectForNarrator(events, { sceneNames: ['Марта'] })), [1, 2, 4]);
  assert.deepEqual(ids(selectForNarrator(events, { recentText: 'Видишь ли ты старый маяк? Он сгорел.' })), [1, 3]);
  const block = chronicleBlock(events, { sceneNames: ['Ян', 'Марта'], scene: null });
  assert.match(block, /правды НЕ знают: Ян/);
  assert.equal(chronicleBlock([], { sceneNames: [] }), '');
});

test('хроника для учётчика: номера и ⚠ просроченного', () => {
  const events = normalizeEvents([
    { type: 'plan', text: 'Приём у короля', when: 'в полдень', at: { day: 1, minute: 480 } },
    { type: 'fact', text: 'Факт', status: 'done', outcome: 'past' },
  ]);
  const txt = chronicleForSync(events, { day: 1, minute: 800 });
  assert.match(txt, /#1 \[назначено.*Приём у короля ⚠ СРОК ПРОШЁЛ/);
  assert.match(txt, /#2 .*закрыто: прошло\/отменено/);
  assert.match(txt, /Записи с ⚠/);
  assert.equal(chronicleForSync([], null), '');
  assert.ok(looksTimed({ type: 'fact', text: 'завтра казнь', when: '' }));
});
