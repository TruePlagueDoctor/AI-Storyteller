// Сборка промтов рассказчика и учётчика, проверка полноты, противоречия, сжатие истории.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeStorySystem, labelHeroes, heroMultiplayer, keyMatches, activeLoreEntries, whoShort } from '../src/narrator.js';
import { composeSyncSystem, completenessHints, mayIntroduceNpc, syncWorthwhile, sheetForSync } from '../src/sync.js';
import { stripToolMarkup, parseLeakedToolCalls } from '../src/llm.js';
import { findCutIndex, planSummary, applySummary, renderTranscript } from '../src/summary.js';
import { findContradictions, autoFix, correctionNote, findSceneIssues } from '../src/contradictions.js';
import { normalizeEvents } from '../src/chronicle.js';
import { DEFAULT_SYSTEM_PROMPT } from '../src/prompt.js';
import { makeState, hero } from './helpers.js';

test('лорбук: ключ ловит падежи, фразы — точно, лимит не съедает «всегда»', () => {
  assert.ok(keyMatches('маяк', 'у старого маяка'));
  assert.ok(keyMatches('Гильдия воров', 'гильдия воров ждёт'));
  assert.ok(!keyMatches('кот', 'котёл кипит'), 'короткий ключ — только точное вхождение');
  assert.ok(keyMatches('кот', 'чёрный кот'));
  assert.ok(keyMatches('кот', 'гладит кота'));
  assert.ok(keyMatches('Эль', 'кружка эля'));
  assert.ok(keyMatches('кот', 'гладит кота'));
  assert.ok(keyMatches('Эль', 'кружка эля'));
  const st = makeState({
    messages: [{ role: 'user', content: 'Иду к маяку' }],
    lorebook: [
      { title: 'Маяк', keys: ['маяк'], content: 'Сгорел', enabled: true },
      { title: 'Королевство', keys: [], content: 'x', always: true, enabled: true },
      { title: 'Выключено', keys: ['маяк'], content: 'y', enabled: false },
    ],
  });
  assert.deepEqual(activeLoreEntries(st).map((e) => e.title), ['Королевство', 'Маяк']);
});

test('промт рассказчика: блоки на месте, раздел про инструменты убран в двухпроходном режиме', () => {
  const st = makeState({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    worldPrompt: 'Тёмное средневековье',
    scenarioPrompt: 'Жанр: нуар\nЗавязка: туман',
    summary: 'Ян приехал в город.',
    directorNote: 'Хочу интригу',
    difficulty: 'hard',
    narration: 'third',
  });
  st.scene.location = 'Таверна';
  st.npcs = [{ name: 'Ольт', description: 'Стражник у ворот. Любит эль.', attitude: 'насторожен' }];
  const p = composeStorySystem(st);
  for (const part of ['=== МИР ===', '=== СЦЕНАРИЙ ===', '=== ПРЕДЫСТОРИЯ', '=== СЦЕНА', '=== ГЕРОЙ ===', '=== ВСТРЕЧЕННЫЕ ПЕРСОНАЖИ', 'СУРОВЫЙ', 'третье', 'НАПРАВЛЕНИЕ ОТ ИГРОКА', 'ЖАНР И ТЕМЫ ЭТОЙ ИСТОРИИ: Жанр: нуар']) {
    assert.ok(p.includes(part), part);
  }
  assert.ok(!/^Управление листами героев:/m.test(p));
  assert.ok(/^Управление листами героев:/m.test(composeStorySystem(st, { withTools: true })) || !/^Управление листами героев:/m.test(DEFAULT_SYSTEM_PROMPT));
  assert.equal(whoShort({ description: 'Стражник у ворот. Любит эль.' }), 'Стражник у ворот');
});

test('несколько героев: ходы помечаются, чужие эпизоды подписаны', () => {
  const st = makeState();
  st.characters.push({ id: 'h2', name: 'Рита', blocks: [], present: true });
  const msgs = [
    { role: 'user', content: 'Иду', hero: 'h2' },
    { role: 'assistant', content: 'Ты идёшь', hero: 'h2' },
    { role: 'user', content: 'Сижу', hero: 'h1' },
  ];
  st.messages = msgs;
  assert.ok(heroMultiplayer(st));
  const out = labelHeroes(st, msgs);
  assert.equal(out[0].content, '[Ход за героя Рита] Иду');
  assert.match(out[1].content, /^\[Эпизод героя Рита: «ты» здесь — Рита, не Ян\]/);
  assert.equal(out[2].content, '[Ход за героя Ян] Сижу');
  assert.ok(out.every((m) => !('hero' in m)));
  st.messages = [{ role: 'user', content: 'x', hero: 'h1' }];
  assert.ok(!heroMultiplayer(st));
});

test('промт учётчика: постоянная часть в начале, справочники — только при новом персонаже', () => {
  const st = makeState();
  st.npcs = [{ name: 'Ольт', locked: [] }];
  const plain = composeSyncSystem(st, 'Ольт кивает тебе.');
  assert.ok(plain.startsWith('РОЛЬ: учётчик'));
  assert.ok(!plain.includes('ЧЕРТЫ:'));
  assert.match(plain, /ЛИСТ ПУСТ у: Ян/);
  const intro = composeSyncSystem(st, 'К столу подходит незнакомец и называет себя Корвином.');
  assert.ok(intro.includes('ЧЕРТЫ:'));
  st.syncPromptStyle = 'legacy';
  assert.ok(composeSyncSystem(st, 'x').startsWith('Ты — учётчик'));
  assert.ok(mayIntroduceNpc(st, 'Рядом сидел Борис.'));
  assert.ok(!mayIntroduceNpc(st, 'Ольт молчит. Ян пьёт.'));
});

test('стоит ли запускать учёт', () => {
  const st = makeState();
  assert.ok(!syncWorthwhile(st, ''));
  assert.ok(!syncWorthwhile(st, 'Тихо.'));
  assert.ok(syncWorthwhile(st, '«Да»'));
  assert.ok(syncWorthwhile(st, 'x'.repeat(60)));
});

test('лист для учётчика: закрепления и описание при пустом листе', () => {
  const h = { name: 'Ян', persona: 'Бывший наёмник', blocks: [], appearance: 'седой', social: '', locked: ['appearance'] };
  assert.match(sheetForSync(h), /\(лист пуст\)[\s\S]*внешность 🔒: седой[\s\S]*описание героя: Бывший наёмник/);
  h.blocks = [{ type: 'stat', name: 'Здоровье', value: '5', max: 10, locked: true }];
  assert.match(sheetForSync(h), /Здоровье 5\/10 \[stat\] 🔒/);
});

test('проверка полноты: признаки событий без вызовов', () => {
  const st = makeState();
  hero(st).blocks = [{ type: 'item', name: 'Кошель', value: '35 золотых' }];
  st.scene.present = ['Ольт'];
  st.events = normalizeEvents([{ type: 'debt', text: 'Ян должен Ольту двадцать золотых', participants: ['Ян', 'Ольт'] }]);
  const text = 'Ты отсчитываешь Ольту двадцать золотых. Он кивает и уходит. Через час стемнело.';
  const hints = completenessHints(st, text, [{ name: 'npc' }]);
  assert.ok(hints.some((h) => /платят/.test(h) && /Кошель: 35 золотых/.test(h)));
  assert.ok(hints.some((h) => /прошло заметное время/.test(h)));
  assert.ok(hints.some((h) => /Похоже, кто-то ушёл \(Ольт\)/.test(h)));
  assert.ok(hints.some((h) => /ХРОНИКА #1/.test(h)));
  assert.deepEqual(completenessHints(st, text, [{ name: 'block' }, { name: 'scene' }, { name: 'event' }]), []);
  assert.deepEqual(completenessHints(st, 'Тихо падает снег.', []), []);
});

test('утёкшая разметка инструментов: обрезается и разбирается', () => {
  const raw = 'Ты входишь.<｜DSML｜invoke name="block"><parameter name="type">item</parameter><parameter name="name">Ключ</parameter></invoke>';
  assert.equal(stripToolMarkup(raw), 'Ты входишь.');
  assert.deepEqual(parseLeakedToolCalls(raw), [{ name: 'block', args: { type: 'item', name: 'Ключ' } }]);
  assert.deepEqual(parseLeakedToolCalls('просто текст'), []);
});

test('противоречия: мёртвый действует, показатель за границей чинится', () => {
  const st = makeState();
  st.npcs = [{ name: 'Ольт', status: 'убит в переулке' }];
  hero(st).blocks = [{ type: 'stat', name: 'Здоровье', value: '12', max: 10 }, { type: 'stat', name: 'Сила', value: '1', max: 10 }];
  const issues = findContradictions(st, 'Ольт говорит: «Привет». Ты бодр и полон сил.');
  assert.deepEqual(issues.map((i) => i.kind).sort(), ['dead-acts', 'stat-over', 'wounded-fresh']);
  assert.equal(autoFix(issues).length, 1);
  assert.equal(hero(st).blocks[0].value, '10');
  assert.match(correctionNote(issues), /Ольт.*действует/);
  assert.equal(correctionNote([]), '');
});

test('живость сцены: люди без реплик, объявленный игроком исход', () => {
  const st = makeState();
  const flat = 'В таверне полно людей. '.repeat(30);
  assert.deepEqual(findSceneIssues(st, flat, 'Мне легко удалось их обмануть', []).map((i) => i.kind), ['no-dialogue', 'declared-outcome']);
  assert.deepEqual(findSceneIssues(st, flat, 'Тихо наблюдаю', []), []);
  assert.deepEqual(findSceneIssues(st, 'коротко', 'x', []), []);
});

test('сжатие: режем только по реплике игрока и только если история не менялась', () => {
  const msgs = [];
  for (let i = 0; i < 16; i++) msgs.push({ role: 'user', content: `ход ${i}` }, { role: 'assistant', content: `ответ ${i}` });
  msgs.splice(5, 0, { role: 'tool', content: 'x' });
  assert.equal(findCutIndex(msgs, 20), 13);
  assert.equal(findCutIndex(msgs, 19), 15, 'на ответе рассказчика не режем — ищем следующую реплику игрока');
  const st = makeState({ messages: msgs, historyKeep: 20, summary: 'старое' });
  const plan = planSummary(st);
  assert.ok(plan);
  assert.equal(plan.cut, 13);
  assert.match(plan.transcript, /Игрок: ход 0/);
  assert.equal(planSummary({ ...st, autoSummarize: false }), null);
  assert.equal(planSummary({ ...st, messages: msgs.slice(0, 25) }), null, 'ещё рано: нужно keep + keep/2');
  // История изменилась — результат не применяется.
  const changed = { ...st, messages: [...msgs] };
  assert.equal(applySummary(plan, 'новое', changed), false);
  assert.equal(applySummary(plan, 'новое', st), true);
  assert.equal(st.summary, 'новое');
  assert.equal(st.messages.length, msgs.length - 13);
  assert.equal(st.messages[0].role, 'user');
});

test('пересказ для сжатия: без реплик вне истории, с именами героев', () => {
  const st = makeState();
  st.characters.push({ id: 'h2', name: 'Рита', blocks: [] });
  const t = renderTranscript([
    { role: 'user', content: 'иду', hero: 'h1' },
    { role: 'assistant', content: 'идёшь', hero: 'h1' },
    { role: 'user', content: 'служебное', ooc: true },
    { role: 'user', content: 'пою', hero: 'h2' },
  ], st);
  assert.match(t, /Игрок \(за Ян\): иду/);
  assert.match(t, /Игрок \(за Рита\): пою/);
  assert.ok(!t.includes('служебное'));
});

test('проверка полноты смотрит, что именно записано в лист', () => {
  const st = makeState();
  hero(st).blocks = [{ type: 'item', name: 'Кошель', value: '35 золотых' }, { type: 'stat', name: 'Здоровье', value: '10', max: 10 }];
  const text = 'Ты платишь лекарю десять золотых, и он перевязывает тебе рану.';
  // Записали только деньги — про лечение надо напомнить.
  const onlyMoney = completenessHints(st, text, [{ name: 'block', args: { type: 'item', name: 'Кошель', value: '25 золотых' } }]);
  assert.ok(onlyMoney.some((h) => /ранение или лечение/.test(h)), onlyMoney.join(' | '));
  assert.ok(!onlyMoney.some((h) => /платят/.test(h)));
  // Записали только здоровье — про деньги надо напомнить.
  const onlyHp = completenessHints(st, text, [{ name: 'block', args: { type: 'stat', name: 'Здоровье', value: '10' } }]);
  assert.ok(onlyHp.some((h) => /платят/.test(h)), onlyHp.join(' | '));
  // Старые имена инструментов и вызовы без аргументов тоже считаются.
  assert.deepEqual(completenessHints(st, text, [{ name: 'update_block' }]), []);
  // Деньги показателем: «Золото» закрывает оплату, «Здоровье» — нет.
  assert.ok(!completenessHints(st, text, [{ name: 'block', args: { type: 'stat', name: 'Золото', value: '5' } }]).some((h) => /платят/.test(h)));
});

test('признаки событий видят русские окончания (без \\b)', () => {
  const st = makeState();
  const hint = (t) => completenessHints(st, t, []).join(' | ');
  assert.match(hint('Клинок оставляет на твоём плече глубокую рану.'), /ранение/);
  assert.match(hint('В вине, что ты выпил, был яд.'), /ранение/);
  assert.match(hint('Ты отдал ему последнюю монету.'), /платят/);
  assert.match(hint('Ты платишь за ночлег.'), /платят/);
  assert.equal(hint('На плечи ложится платок.'), '');
  assert.equal(hint('Рано утром идёт снег.'), '');
  // Прогноз и «возвращается к делу» — не время и не оплата.
  assert.equal(hint('«Дождь к вечеру будет», — Марта возвращается к своему вязанию.'), '');
  assert.match(hint('Ты возвращаешь ему кольцо.'), /платят/);
  assert.match(hint('К вечеру вы добираетесь до деревни.'), /время/);
});

test('проверка полноты: рана, деньги, отдых — только если это про героя', () => {
  const st = makeState();
  const hint = (t) => completenessHints(st, t, []).join(' | ');
  assert.equal(hint('Незнакомец откидывает капюшон: худой, седой, с ожогом на шее.'), '');
  assert.equal(hint('Купец платит стражнику и проезжает.'), '');
  assert.match(hint('Разбойник полосует тебя ножом. Рана глубокая.'), /ранение/, 'рана в следующей фразе после «тебя»');
  assert.match(hint('Ты платишь за ночлег.'), /платят/);
  // Повествование от третьего лица — по имени героя.
  assert.match(hint('Яна ранили в плечо.'), /ранение/);
});

test('пересказ для сжатия подписывает героя, даже если он в куске один', () => {
  const st = makeState();
  hero(st).name = 'Эйра';
  const t = renderTranscript([{ role: 'user', content: 'сплю', hero: 'h1' }, { role: 'assistant', content: 'тебе снится лес', hero: 'h1' }], st);
  assert.match(t, /Игрок \(за Эйра\): сплю/);
  assert.match(t, /«ты» = Эйра/);
});
