// Линии героев: у каждого своё окно в общей истории и своя предыстория.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { viewMessages, visibleTo, stamp, switchLine, migrateLines, reconcileLines, dropLine, summaryOf } from '../src/lines.js';
import { planSummary, applySummary } from '../src/summary.js';
import { storyMessages, heroMultiplayer } from '../src/narrator.js';
import { isOpening } from '../src/codex.js';
import { runTurn } from '../src/turn.js';
import { advanceStatuses } from '../src/statuses.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const U = (content, hero, wth) => ({ role: 'user', content, hero, ...(wth ? { with: wth } : {}) });
const A = (content, hero, wth) => ({ role: 'assistant', content, hero, ...(wth ? { with: wth } : {}) });
const two = (over = {}) => {
  const st = makeState({ diceEnabled: false, ...over });
  st.characters.push({ id: 'h2', name: 'Мира', persona: '', blocks: [], skillXp: {}, present: true, appearance: '', social: '', group: 'h2' });
  return st;
};

test('окно героя: свои ходы, общие со спутником, старые записи без пометки; свёрнутое не видно', () => {
  const st = two();
  st.messages = [
    U('старый общий ход', 'h1'), A('старый общий ответ', 'h1'),           // до правки: без with — общие
    U('Ян один', 'h1', []), A('ответ Яну', 'h1', []),
    U('Мира одна', 'h2', []), A('ответ Мире', 'h2', []), { role: 'tool', content: 'служебное Миры' },
    U('вместе', 'h1', ['h2']), A('ответ обоим', 'h1', ['h2']),
  ];
  const texts = (id) => viewMessages(st, id).map((m) => m.content);
  assert.deepEqual(texts('h1'), ['старый общий ход', 'старый общий ответ', 'Ян один', 'ответ Яну', 'вместе', 'ответ обоим']);
  assert.deepEqual(texts('h2'), ['старый общий ход', 'старый общий ответ', 'Мира одна', 'ответ Мире', 'служебное Миры', 'вместе', 'ответ обоим']);
  st.messages[0].done = ['h2'];
  assert.equal(texts('h2')[0], 'старый общий ответ');
  assert.equal(texts('h1')[0], 'старый общий ход');
  assert.equal(visibleTo({ role: 'ooc', text: 'без героя' }, 'h2'), true);
});

test('пометка хода: спутник — из той же компании и отмечен «рядом»', () => {
  const st = two();
  assert.deepEqual(stamp(st), { hero: 'h1', with: [] }, 'у Миры своя отдельная история');
  delete st.characters[1].group;
  assert.deepEqual(stamp(st).with, ['h2']);
  st.characters[1].present = false;
  assert.deepEqual(stamp(st).with, []);
});

test('рассказчик видит только историю и предысторию своего героя; чужих пометок и «нескольких героев» нет', () => {
  const st = two({ summary: 'Предыстория Яна.' });
  st.summaries = { h2: 'Предыстория Миры.' };
  st.messages = [U('Ян у ворот', 'h1', []), A('Ольт преграждает путь Яну.', 'h1', []), U('Мира в порту', 'h2', []), A('Чайки кричат над Мирой.', 'h2', []), U('Ян ждёт', 'h1', [])];
  let text = storyMessages(st).map((m) => m.content).join('\n');
  assert.ok(text.includes('Ольт преграждает путь') && text.includes('Предыстория Яна.'));
  assert.ok(!text.includes('Чайки кричат') && !text.includes('Предыстория Миры.'));
  assert.equal(heroMultiplayer(st), false);
  assert.ok(!text.includes('[Ход за героя'));
  // Переключаемся на Миру.
  switchLine(st, 'h1', 'h2'); st.activeCharacterId = 'h2'; st.messages.pop(); st.messages.push(U('Мира ждёт', 'h2', []));
  text = storyMessages(st).map((m) => m.content).join('\n');
  assert.ok(text.includes('Чайки кричат') && text.includes('Предыстория Миры.'));
  assert.ok(!text.includes('Ольт преграждает путь') && !text.includes('Предыстория Яна.'));
  assert.equal(summaryOf(st, 'h1'), 'Предыстория Яна.');
});

test('общие ходы спутников по-прежнему помечаются, чей эпизод', () => {
  const st = two();
  delete st.characters[1].group;
  st.messages = [U('Мира говорит', 'h2', ['h1']), A('Ты, Мира, видишь стражу.', 'h2', ['h1']), U('Ян отвечает', 'h1', ['h2'])];
  assert.equal(heroMultiplayer(st), true);
  assert.match(storyMessages(st)[2].content, /^\[Эпизод героя Мира/);
});

test('у нового героя с пустой линией — вступление (кодекс знакомит с миром), хотя партия идёт давно', () => {
  const st = two();
  st.messages = [U('Ян у ворот', 'h1', []), A('Ольт преграждает путь.', 'h1', [])];
  assert.equal(isOpening(st), false);
  st.activeCharacterId = 'h2';
  assert.equal(isOpening(st), true);
});

test('сжатие — по герою: своё уходит в свою предысторию, общее остаётся второму, чужое не трогается', () => {
  const st = two({ historyKeep: 4, summary: 'старое Яна' });
  st.summaries = { h2: 'старое Миры' };
  st.messages = [U('общий старый', 'h1'), A('общий ответ', 'h1')];
  for (let i = 0; i < 6; i++) st.messages.push(U(`Ян ${i}`, 'h1', []), A(`ответ Яну ${i}`, 'h1', []), U(`Мира ${i}`, 'h2', []), A(`ответ Мире ${i}`, 'h2', []));
  const plan = planSummary(st);
  assert.equal(plan.heroId, 'h1');
  assert.ok(!plan.transcript.includes('Мира 0'), 'в пересказ идёт только история Яна');
  assert.match(plan.transcript, /общий старый[\s\S]*Ян 0/);
  // Пока шло сжатие, игрок переключился на Миру — предыстория всё равно ложится Яну.
  switchLine(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.equal(applySummary(plan, 'новое Яна', st), true);
  assert.equal(summaryOf(st, 'h1'), 'новое Яна');
  assert.equal(st.summary, 'старое Миры');
  assert.equal(viewMessages(st, 'h1').length, 4, 'у Яна осталось historyKeep сообщений');
  assert.equal(viewMessages(st, 'h2').length, 14, 'история Миры цела, включая общий старый ход');
  assert.deepEqual(st.messages[0].done, ['h1']);
  assert.ok(!st.messages.some((m) => m.content === 'Ян 0'), 'своё свёрнутое удалено совсем');
  // Теперь сжимается Мира: общий старый ход больше никому не нужен и уходит.
  const plan2 = planSummary(st);
  assert.equal(plan2.heroId, 'h2');
  assert.equal(applySummary(plan2, 'новое Миры', st), true);
  assert.ok(!st.messages.some((m) => m.content === 'общий старый'));
  assert.equal(st.summary, 'новое Миры');
});

test('старая партия: общая предыстория остаётся у обоих героев; снимок возвращает предыстории на места', () => {
  const st = two({ summary: 'общая предыстория' });
  migrateLines(st);
  assert.deepEqual(st.summaries, { h2: 'общая предыстория' });
  migrateLines(st);
  switchLine(st, 'h1', 'h2'); st.activeCharacterId = 'h2';
  assert.equal(st.summary, 'общая предыстория');
  st.summary = 'у Миры своё';
  // Снимок сделан, когда играл Ян; откат при активной Мире.
  st.summary = 'предыстория Яна из снимка';
  reconcileLines(st, { relFor: 'h1', summaries: { h2: 'Мира из снимка' } });
  assert.equal(st.summary, 'Мира из снимка');
  assert.equal(st.summaries.h1, 'предыстория Яна из снимка');
});

test('удалённый герой: его предыстория и никому не видимые сообщения уходят, общие остаются', () => {
  const st = two();
  st.summaries = { h2: 'x' };
  st.messages = [U('общий', 'h1'), U('Мира одна', 'h2', []), { role: 'tool', content: 't' }, U('вместе', 'h2', ['h1']), U('Ян', 'h1', [])];
  st.characters = st.characters.filter((c) => c.id !== 'h2');
  dropLine(st, 'h2');
  assert.deepEqual(st.messages.map((m) => m.content), ['общий', 'вместе', 'Ян']);
  assert.deepEqual(st.summaries, {});
});

test('ход целиком: новые сообщения получают пометку линии', async () => {
  const st = two({ messages: [U('Иду', 'h1', [])] });
  fake = installFakeFetch([reply('Ты идёшь. Вокруг тихо.'), reply('', [call('nothing', {})])]);
  await runTurn({ state: st, apiKey: 'k' });
  assert.deepEqual({ hero: st.messages[1].hero, with: st.messages[1].with }, { hero: 'h1', with: [] });
});

test('состояния тикают только у героев в сцене: отдельный герой не теряет здоровье, пока играют за другого', () => {
  const st = two();
  const sheet = () => [{ id: 's', type: 'stat', name: 'Здоровье', value: '8', max: 10 }, { id: 'p', type: 'status', name: 'Отравлен', addedTurn: 1 }];
  st.characters[0].blocks = sheet(); st.characters[1].blocks = sheet();
  st.statusCatalog = [{ name: 'Отравлен', tick: { stat: 'Здоровье', delta: -3 }, duration: 5 }];
  st.turn = 2;
  const report = advanceStatuses(st);
  assert.equal(st.characters[0].blocks[0].value, '5');
  assert.equal(st.characters[1].blocks[0].value, '8');
  assert.ok(report.every((r) => !r.includes('Мира')));
});
