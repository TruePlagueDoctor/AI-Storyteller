// Раздел кодекса «Магия и явления»: рассказчик берёт записанные варианты и эффекты, учётчик ставит состояние,
// эффект состояния считает код по статье.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { normalizeEntry, narratorIndex, selectCodex, renderCodex, lookupCodex, codexMisses, codexIndex, CODEX_KINDS, KIND_FIELDS } from '../src/codex.js';
import { statusCatalogOf, advanceStatuses, statusRollMod, describeStatus } from '../src/statuses.js';
import { composeSyncSystem, completenessHints } from '../src/sync.js';
import { composeStorySystem } from '../src/narrator.js';
import { executeTool } from '../src/tools.js';
import { runTurn } from '../src/turn.js';
import { makeState, hero, block } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const LONG = 'Подробности. '.repeat(120); // ~1500 знаков — больше прежнего предела в 600
const book = () => [
  normalizeEntry({ id: 'r0', title: 'Руны суккубов', kind: 'magic', always: true, brief: 'Магия суккубов. Разновидности: Руна голода, Руна покорности.', content: '' }),
  normalizeEntry({ id: 'r1', title: 'Руна голода', kind: 'magic', keys: ['голода'], brief: 'Жертва слабеет без близости.',
    fields: { effect: 'Тянет силы каждый час', look: 'алый знак ниже пупка', how: 'накладывается касанием, снимается жрецом', mech_roll: '−2', mech_tick: 'Рассудок −2', mech_turns: '4' }, content: LONG }),
  normalizeEntry({ id: 'r2', title: 'Руна покорности', kind: 'magic', brief: 'Трудно ослушаться наложившего.', fields: { effect: 'Приказы наложившего трудно нарушить' } }),
  normalizeEntry({ id: 'c1', title: 'Гуль', kind: 'creature', brief: 'Трупоед.' }),
];
const world = (over = {}) => {
  const st = makeState({ lorebook: book(), messages: [{ role: 'user', content: 'Вхожу в зал' }, { role: 'assistant', content: 'В зале тихо.' }, { role: 'user', content: 'Осматриваюсь' }], ...over });
  hero(st).blocks = [{ id: 's', type: 'stat', name: 'Рассудок', value: '10', max: 10 }];
  return st;
};

test('раздел есть, с полями эффекта и механики', () => {
  assert.ok(CODEX_KINDS.includes('magic'));
  assert.deepEqual(KIND_FIELDS.magic.map(([k]) => k), ['group', 'effect', 'look', 'how', 'mech_roll', 'mech_tick', 'mech_turns']);
});

test('рассказчик видит раздел в оглавлении с правилом «бери записанное»', () => {
  const st = world();
  const idx = narratorIndex(st);
  assert.match(idx, /Магия и явления: Руны суккубов, Руна голода, Руна покорности/);
  assert.match(idx, /заклинани/);
  assert.match(composeStorySystem(st), /не придумывай новых разновидностей и эффектов, пока подходит записанное/);
});

test('подглядывание отдаёт статью целиком, а в запросе она по-прежнему ужата', () => {
  const st = world();
  const full = lookupCodex(st, ['Руна голода']).text;
  assert.ok(full.length > 1400, `статья по запросу не обрезается: ${full.length}`);
  assert.match(full, /Эффект: Тянет силы каждый час/);
  st.messages.push({ role: 'assistant', content: 'x' }, { role: 'user', content: 'Что такое руна голода?' });
  const inPrompt = renderCodex(st).text;
  assert.match(inPrompt, /Руна голода \[магия\] — Жертва слабеет/);
  assert.ok(inPrompt.length < 2500);
});

test('состояние с названием статьи берёт эффект из статьи: броски, тик, срок', () => {
  const st = world({ turn: 3 });
  const cat = statusCatalogOf(st);
  const def = cat.find((d) => d.name === 'Руна голода');
  assert.deepEqual({ rollMod: def.rollMod, tick: def.tick, duration: def.duration }, { rollMod: -2, tick: { stat: 'Рассудок', delta: -2 }, duration: 4 });
  assert.ok(cat.some((d) => d.name === 'Руна покорности'), 'руна без чисел — тоже известное состояние');
  assert.ok(cat.some((d) => d.name === 'Отравлен'), 'обычный каталог на месте');
  executeTool('block', { type: 'status', name: 'Руна голода' }, st);
  assert.ok(block(st, 'Руна голода'));
  assert.equal(statusRollMod(cat, hero(st)).mod, -2);
  assert.match(describeStatus(cat, block(st, 'Руна голода')), /−?-?2 к броскам/);
  st.turn = 4;
  const report = advanceStatuses(st);
  assert.equal(block(st, 'Рассудок').value, '8');
  assert.ok(report.some((r) => /Руна голода/.test(r)));
});

test('действующая на героя руна сама подтягивает свою статью рассказчику', () => {
  const st = world();
  assert.ok(!selectCodex(st).some((x) => x.entry.id === 'r2'));
  hero(st).blocks.push({ id: 'p', type: 'status', name: 'Руна покорности' });
  const sel = selectCodex(st).find((x) => x.entry.id === 'r2');
  assert.equal(sel.level, 'full');
  assert.match(renderCodex(st).text, /Эффект: Приказы наложившего трудно нарушить/);
});

test('учётчик знает руны как состояния и получает правило', () => {
  const st = world();
  const sys = composeSyncSystem(st, '');
  assert.match(sys, /КАТАЛОГ СОСТОЯНИЙ:[^\n]*Руна голода \(-2 к броскам, Рассудок -2\/ход, 4 х\.\)/);
  assert.match(sys, /МАГИЯ И ЯВЛЕНИЯ[^\n]*block type:status/);
  assert.ok(!/Руна голода/.test(codexIndex(st)), 'состояния из кодекса учётчик видит в каталоге — в оглавлении не дублируются');
  // Без статей этого раздела промт учётчика прежний.
  const plain = composeSyncSystem(makeState(), '');
  assert.ok(!/МАГИЯ И ЯВЛЕНИЯ/.test(plain));
});

test('проверка полноты: руну наложили в тексте, а состояния на листе нет', () => {
  const st = world();
  const text = 'Лилит касается твоего живота, и на коже вспыхивает Руна голода. Ты чувствуешь слабость.';
  const hints = completenessHints(st, text, [{ name: 'npc', args: { name: 'Лилит' } }]);
  assert.ok(hints.some((h) => /Руна голода/.test(h) && /status/.test(h)), hints.join(' | '));
  assert.ok(!completenessHints(st, text, [{ name: 'block', args: { type: 'status', name: 'Руна голода' } }]).some((h) => /Руна голода/.test(h)));
  assert.ok(!completenessHints(st, 'Старик рассказывает, что руна голода — выдумка.', []).some((h) => /Руна голода/.test(h)), 'просто упоминание — не повод');
});

test('рассказчик описал руну, не видя статьи, — замечание на следующий ход', async () => {
  const st = world();
  st.lorebook[0].always = false;
  const seen = renderCodex(st).shown;
  assert.deepEqual(codexMisses(st, 'На её коже проступает руна покорности.', seen), ['Руна покорности']);
  fake = installFakeFetch([reply('На её коже проступает руна покорности, и воздух густеет.'), reply('', [call('nothing', {})])]);
  await runTurn({ state: { ...st, diceEnabled: false }, apiKey: 'k' });
});

// 32 руны в оглавление не помещались (влезала половина). Группа: одна строка в оглавлении, полный список — по запросу.
const NAMES = ['голода', 'покорности', 'жажды', 'тишины', 'боли', 'сна', 'верности', 'огня', 'льда', 'тени', 'страха', 'забвения', 'желания', 'слабости', 'силы', 'крови',
  'уз', 'молчания', 'зова', 'послушания', 'истомы', 'голоса', 'плодородия', 'увядания', 'метки', 'привязи', 'отражения', 'обмана', 'правды', 'покоя', 'ярости', 'пустоты'];
const bigBook = () => [
  normalizeEntry({ id: 'g', title: 'Лоно-руны', kind: 'magic', brief: 'Магия суккубов: знаки на теле, меняющие носителя.' }),
  ...NAMES.map((n, i) => normalizeEntry({ id: 'r' + i, title: 'Руна ' + n, kind: 'magic', brief: `Эффект руны ${n} одной строкой.`, fields: { group: 'Лоно-руны', effect: 'эффект ' + n } })),
  normalizeEntry({ id: 'c', title: 'Гуль', kind: 'creature' }),
  normalizeEntry({ id: 'm', title: 'Чёрная хворь', kind: 'magic', brief: 'Болезнь.', fields: { effect: 'слабость' } }),
];

test('группа из 32 рун: в оглавлении одна строка с числом видов, без «и ещё N»', () => {
  const st = world({ lorebook: bigBook() });
  const idx = narratorIndex(st);
  assert.match(idx, /Магия и явления: Лоно-руны \(32 вида — список в статье\), Чёрная хворь/);
  assert.ok(!/Руна голода/.test(idx) && !/и ещё/.test(idx), idx);
  assert.match(idx, /прежде чем выбрать разновидность, прочитай статью группы/);
});

test('по запросу группа отдаёт все разновидности с эффектами одной строкой; разновидность — свою статью', () => {
  const st = world({ lorebook: bigBook() });
  const res = lookupCodex(st, ['Лоно-руны']);
  for (const n of NAMES) assert.ok(res.text.includes(`Руна ${n} — Эффект руны ${n} одной строкой.`), n);
  assert.match(res.text, /Разновидности \(32\)/);
  assert.match(lookupCodex(st, ['Руна пустоты']).text, /Эффект: эффект пустоты/);
  // Группа без общей статьи тоже находится по названию.
  st.lorebook = st.lorebook.filter((e) => e.id !== 'g');
  assert.match(narratorIndex(st), /Лоно-руны \(32 вида — список в статье\)/);
  assert.match(lookupCodex(st, ['Лоно-руны']).text, /Разновидности \(32\)[\s\S]*Руна голода/);
});

test('общая статья в запросе несёт названия разновидностей, пока влезает в бюджет', () => {
  const st = world({ lorebook: bigBook() });
  st.lorebook[0].always = true;
  const text = renderCodex(st).text;
  assert.match(text, /Разновидности: Руна голода, Руна покорности/);
  assert.ok(text.length / 3.2 <= 1300, `кодекс в бюджете: ~${Math.round(text.length / 3.2)} ток.`);
});

// Случай пользователя: общая статья (описание + базовый эффект для любой руны) и отдельно — виды.
test('общее для группы доходит вместе с разновидностью: по запросу вида и когда вид действует на героя', () => {
  const st = world({ lorebook: bigBook() });
  st.lorebook[0].fields = { effect: 'Любая руна греется при близости наложившего' };
  st.lorebook[0].brief = 'Магия суккубов: знаки на теле.';
  const one = lookupCodex(st, ['Руна пустоты']).text;
  assert.match(one, /Общее для группы «Лоно-руны»: Магия суккубов: знаки на теле\. Эффект: Любая руна греется при близости наложившего/);
  hero(st).blocks.push({ id: 'p', type: 'status', name: 'Руна пустоты' });
  const sel = selectCodex(st);
  assert.equal(sel.find((x) => x.entry.title === 'Руна пустоты').level, 'full');
  assert.ok(sel.some((x) => x.entry.id === 'g'), 'общая статья подтянулась вместе с действующей руной');
  assert.match(renderCodex(st).text, /Лоно-руны \[магия\]/);
});

test('общая статья группы — не состояние, даже если у неё заполнен базовый эффект', () => {
  const st = world({ lorebook: bigBook() });
  st.lorebook[0].fields = { effect: 'Любая руна греется при близости наложившего' };
  const names = statusCatalogOf(st).map((d) => d.name);
  assert.ok(!names.includes('Лоно-руны'));
  assert.ok(names.includes('Руна голода') && names.includes('Чёрная хворь'));
});

// Жалоба: в запросе руны перечислены через запятую без описаний — эффекты рассказчик получал, только если сам
// запросит статью (codex_lookup), а дешёвые модели инструмент вызывают не всегда.
test('речь зашла о рунах — список видов с эффектами приходит рассказчику сам, без запроса', () => {
  const st = world({ lorebook: bigBook() });
  st.lorebook[0].keys = ['руна', 'руны'];
  const quiet = renderCodex(st).text;
  assert.ok(!/Разновидности \(32\)/.test(quiet), 'пока о рунах не говорят — списка нет');
  st.messages.push({ role: 'assistant', content: 'Суккуб улыбается.' }, { role: 'user', content: 'Спрашиваю её про руны' });
  const { text, shown } = renderCodex(st);
  assert.match(text, /Разновидности \(32\)/);
  for (const n of NAMES) assert.ok(text.includes(`Руна ${n} — `), n);
  assert.ok(!/Разновидности: Руна голода, Руна покорности/.test(text), 'названия через запятую не дублируются');
  assert.ok(shown.has('r5'), 'виды из списка считаются показанными — замечания «не зная статьи» не будет');
  assert.ok(text.length / 3.2 <= 1200 + 950, `кодекс со списком в пределах: ~${Math.round(text.length / 3.2)} ток.`);
});

test('список приходит и когда руна уже на герое или названа в прошлом ответе; длинные выжимки ужимаются', () => {
  const st = world({ lorebook: bigBook() });
  hero(st).blocks.push({ id: 'p', type: 'status', name: 'Руна пустоты' });
  assert.match(renderCodex(st).text, /Разновидности \(32\)/);
  const st2 = world({ lorebook: bigBook() });
  st2.messages = [{ role: 'user', content: 'Жду' }, { role: 'assistant', content: 'На её коже вспыхивает руна тени.' }, { role: 'user', content: 'Отступаю' }];
  assert.match(renderCodex(st2).text, /Разновидности \(32\)/);
  // Очень длинные выжимки: список всё равно со всеми названиями, но в пределе.
  for (const e of st2.lorebook) if (e.fields && e.fields.group) e.brief = 'Очень длинное описание эффекта. '.repeat(12);
  const text = renderCodex(st2).text;
  for (const n of NAMES) assert.ok(text.includes(`Руна ${n}`), n);
  assert.ok(text.length / 3.2 <= 1200 + 950, `~${Math.round(text.length / 3.2)} ток.`);
});
