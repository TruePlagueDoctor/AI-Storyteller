// Кодекс мира: какие статьи и в каком объёме идут рассказчику.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, findPeople, selectCodex, codexBlock, CODEX_BUDGET_TOKENS, entryBrief } from '../src/codex.js';
import { composeStorySystem } from '../src/narrator.js';
import { makeState, hero } from './helpers.js';

const entry = (o) => normalizeEntry({ id: o.title, keys: [], content: '', enabled: true, ...o });
const codex = () => [
  entry({ title: 'Гномы', kind: 'people', brief: 'Подгорный народ, живут до 300 лет, чтят клятвы.', keys: ['гном'],
    fields: { look: 'Коренастые, бородатые', customs: 'Клятва дороже жизни' },
    relations: [{ to: 'Эльфы', text: 'презирают за спесь' }, { to: 'Орки', text: 'кровная вражда' }] }),
  entry({ title: 'Эльфы', kind: 'people', brief: 'Лесной народ, живут тысячу лет.', relations: [{ to: 'Гномы', text: 'считают грубыми' }] }),
  entry({ title: 'Орки', kind: 'people', brief: 'Степные кланы.' }),
  entry({ title: 'Упыри', kind: 'creature', brief: 'Ночные трупоеды, боятся огня.', fields: { danger: 3, weaknesses: 'огонь, серебро', habits: 'нападают стаей' } }),
  entry({ title: 'Виверна', kind: 'creature', brief: 'Летучий ящер с ядовитым хвостом.', keys: ['виверн'] }),
  entry({ title: 'Гильдия теней', kind: 'faction', brief: 'Воры столицы.', keys: ['гильди'] }),
  entry({ title: 'Законы королевства', kind: 'other', content: 'Магия под запретом.', always: true }),
];

test('народ находится по слову из карточки: «гном», «эльфийка», по ключу', () => {
  const c = codex();
  assert.equal(findPeople(c, 'гном').title, 'Гномы');
  assert.equal(findPeople(c, 'Эльфийка').title, 'Эльфы');
  assert.equal(findPeople(c, 'орк').title, 'Орки');
  assert.equal(findPeople(c, 'человек'), null);
  assert.equal(findPeople(c, ''), null);
  assert.equal(findPeople(c, 'Упыри'), null, 'народ — только среди народов');
});

test('выжимка: своя или первая фраза описания', () => {
  assert.equal(entryBrief(entry({ title: 'X', brief: 'Коротко.' })), 'Коротко.');
  assert.equal(entryBrief(entry({ title: 'X', content: 'Первая фраза. Вторая фраза.' })), 'Первая фраза');
});

test('в сцене: существо — полностью, народ НПС — выжимка, предубеждения — только между теми, кто рядом', () => {
  const st = makeState({ lorebook: codex() });
  hero(st).race = 'эльфийка';
  st.npcs = [{ name: 'Торин', race: 'гном', locked: [] }, { name: 'Грок', race: 'орк', locked: [] }];
  st.scene.present = ['Торин'];
  st.scene.creatures = ['Упыри'];
  const sel = selectCodex(st);
  const level = (t) => (sel.find((x) => x.entry.title === t) || {}).level;
  assert.equal(level('Упыри'), 'full');
  assert.equal(level('Гномы'), 'brief');
  assert.equal(level('Эльфы'), 'brief', 'народ героя');
  assert.equal(level('Орки'), undefined, 'Грока нет в сцене');
  assert.equal(level('Законы королевства'), 'full', 'всегда в контексте');
  const block = codexBlock(st);
  assert.match(block, /Упыри[\s\S]*Слабости: огонь, серебро/);
  assert.match(block, /Гномы о народе «Эльфы»: презирают за спесь/);
  assert.match(block, /Эльфы о народе «Гномы»: считают грубыми/);
  assert.ok(!/Орки/.test(block), 'вражда с орками — не в этой сцене');
});

test('упоминания: в последнем ходе игрока — полностью, в последних сообщениях — выжимкой, давнее — нет', () => {
  const st = makeState({ lorebook: codex() });
  st.messages = [
    { role: 'user', content: 'Спрашиваю про гильдию' },
    { role: 'assistant', content: 'Старик рассказывает о Гильдии теней.' },
    { role: 'user', content: 'Иду дальше' },
    { role: 'assistant', content: 'Над холмами кружит виверна.' },
    { role: 'user', content: 'Что я знаю о виверне?' },
  ];
  const sel = selectCodex(st);
  const level = (t) => (sel.find((x) => x.entry.title === t) || {}).level;
  assert.equal(level('Виверна'), 'full');
  assert.equal(level('Гильдия теней'), 'brief', 'держится пару ходов после упоминания');
  st.messages.push({ role: 'assistant', content: 'Тишина.' }, { role: 'user', content: 'Сплю' }, { role: 'assistant', content: 'Утро.' });
  assert.equal(selectCodex(st).find((x) => x.entry.title === 'Гильдия теней'), undefined);
});

test('бюджет: полные статьи сжимаются до выжимок, лишнее отбрасывается', () => {
  const big = 'Очень длинное описание. '.repeat(120);
  const lore = Array.from({ length: 12 }, (_, i) => entry({ title: `Тварь ${i}`, kind: 'creature', brief: `Тварь номер ${i}. ` + 'жуткая '.repeat(20), content: big, fields: { habits: big } }));
  const st = makeState({ lorebook: lore });
  st.scene.creatures = lore.map((e) => e.title);
  const block = codexBlock(st);
  assert.ok(block.length / 3.2 <= CODEX_BUDGET_TOKENS * 1.05, `размер ${Math.round(block.length / 3.2)} токенов`);
  assert.match(block, /Тварь 0/);
  assert.match(block, /не поместилось/);
});

test('рассказчик получает кодекс вместо старого справочника', () => {
  const st = makeState({ lorebook: codex() });
  st.scene.creatures = ['Упыри'];
  const p = composeStorySystem(st);
  assert.match(p, /=== КОДЕКС МИРА ===/);
  assert.match(p, /Упыри/);
});

test('старые записи справочника становятся «прочим» без потерь', () => {
  const e = normalizeEntry({ id: 'x', title: 'Порт', keys: 'порт, гавань', content: 'Шумно', always: false });
  assert.equal(e.kind, 'other');
  assert.deepEqual(e.keys, ['порт', 'гавань']);
  assert.equal(e.brief, '');
  assert.deepEqual(e.relations, []);
});

test('учётчик: народ у НПС, существа в сцене, оглавление кодекса', async () => {
  const { executeTool } = await import('../src/tools.js');
  const { codexIndex } = await import('../src/codex.js');
  const { syncNarration } = await import('../src/sync.js');
  const { installFakeFetch, reply, call } = await import('./fake-llm.js');
  const st = makeState({ lorebook: codex() });
  executeTool('npc', { name: 'Торин', race: 'гном' }, st);
  assert.equal(st.npcs[0].race, 'гном');
  executeTool('npc', { name: 'Торин', race: 'горный гном' }, st);
  assert.equal(st.npcs[0].race, 'горный гном');
  executeTool('scene', { creatures: ['Упыри', ' '] }, st);
  assert.deepEqual(st.scene.creatures, ['Упыри']);
  executeTool('scene', { creatures: [] }, st);
  assert.deepEqual(st.scene.creatures, []);
  assert.match(codexIndex(st), /Народы: Гномы, Эльфы, Орки\nБестиарий: Упыри, Виверна\nФракции: Гильдия теней/);
  const fake = installFakeFetch([(body) => { assert.match(body.messages[1].content, /КОДЕКС \(названия/); return reply('', [call('nothing', {})]); }]);
  try {
    const r = await syncNarration({ state: st, apiKey: 'k', narration: 'Из тумана выходят упыри, и Торин молча берётся за топор, глядя на тебя.' });
    assert.equal(r.status, 'done', r.error);
  } finally { fake.restore(); }
});

test('рассказчик дописывает кодекс: раздел и выжимка', async () => {
  const { executeTool } = await import('../src/tools.js');
  const st = makeState({ loreAutoWrite: true });
  executeTool('record_lore', { title: 'Кобольды', kind: 'creature', brief: 'Мелкие пещерные пакостники.', content: 'Живут в шахтах.' }, st);
  assert.equal(st.lorebook[0].kind, 'creature');
  assert.equal(st.lorebook[0].brief, 'Мелкие пещерные пакостники.');
});
