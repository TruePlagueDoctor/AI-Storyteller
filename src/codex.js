// Кодекс мира: статьи о народах, существах, фракциях, местах и прочем (бывший лорбук).
// Главное здесь — что и в каком объёме идёт рассказчику, чтобы не утопить контекст:
//   полностью  — существо в сцене, статья из последнего хода игрока, «всегда в контексте»;
//   выжимкой   — народ того, кто рядом, народ героя, место сцены, недавние упоминания;
//   предубеждения народов — только между теми, кто сейчас в сцене;
//   всё — в пределах бюджета (CODEX_BUDGET_TOKENS): полное сжимается до выжимки, лишнее отбрасывается.
import { partyOf } from './relations.js';
import { viewMessages } from './lines.js';
import { randomUUID } from 'node:crypto';
import { keyMatches } from './narrator-keys.js';

export const CODEX_BUDGET_TOKENS = 1200;
const tok = (s) => Math.ceil(String(s).length / 3.2);

export const CODEX_KINDS = ['people', 'creature', 'faction', 'place', 'magic', 'other'];
export const KIND_LABEL = { people: 'народ', creature: 'бестиарий', faction: 'фракция', place: 'место', magic: 'магия', other: 'заметка' };
// Поля статьи по разделам: [ключ, подпись]. Опасность существа — число 1–5.
export const KIND_FIELDS = {
  people: [['look', 'Облик'], ['lifespan', 'Век'], ['customs', 'Обычаи и нрав']],
  creature: [['look', 'Облик'], ['habits', 'Повадки'], ['habitat', 'Где водится'], ['danger', 'Опасность'], ['weaknesses', 'Слабости'], ['rumors', 'Слухи']],
  faction: [['goal', 'Цель'], ['leader', 'Глава'], ['stance', 'Отношение к герою']],
  place: [['what', 'Что там'], ['ruler', 'Кто правит'], ['danger', 'Чем опасно']],
  // Магия и явления: заклинания, руны, проклятия, болезни, зелья. Название статьи = название состояния на листе;
  // три последних поля — механика этого состояния (см. statusCatalogOf в statuses.js).
  magic: [['effect', 'Эффект'], ['look', 'Как выглядит'], ['how', 'Как возникает и снимается'],
    ['mech_roll', 'К броскам, пока действует (число, например −2)'], ['mech_tick', 'За ход (например: Рассудок −2)'], ['mech_turns', 'Длится ходов (пусто — пока не снимут)']],
  other: [],
};

const str = (v) => (v == null ? '' : String(v)).trim();
const norm = (s) => str(s).toLowerCase().replace(/ё/g, 'е');

export function normalizeEntry(raw = {}) {
  const kind = CODEX_KINDS.includes(raw.kind) ? raw.kind : 'other';
  const keys = Array.isArray(raw.keys) ? raw.keys : typeof raw.keys === 'string' ? raw.keys.split(',') : [];
  const fields = {};
  for (const [k] of KIND_FIELDS[kind]) {
    const v = raw.fields && raw.fields[k];
    if (k === 'danger' && kind === 'creature') { const n = Math.round(Number(v)); if (n >= 1 && n <= 5) fields.danger = n; continue; }
    if (str(v)) fields[k] = str(v);
  }
  const relations = kind === 'people' && Array.isArray(raw.relations)
    ? raw.relations.map((r) => ({ to: str(r && r.to), text: str(r && r.text) })).filter((r) => r.to && r.text)
    : [];
  return {
    ...raw,
    id: raw.id || randomUUID(),
    title: str(raw.title) || 'Без названия',
    kind, brief: str(raw.brief), fields, relations,
    keys: keys.map((k) => str(k)).filter(Boolean),
    content: typeof raw.content === 'string' ? raw.content : '',
    always: raw.always === true,
    enabled: raw.enabled !== false,
  };
}

// Выжимка: своя или первая фраза описания (до ~200 знаков).
export function entryBrief(e) {
  if (e.brief) return e.brief;
  const d = str(e.content).replace(/\s+/g, ' ');
  if (!d) return '';
  let first = d.split(/(?<=[.!?…])\s/)[0].replace(/[.!?…]+$/, '');
  if (first.length > 200) first = first.slice(0, 200).replace(/[\s,;:—-]+\S*$/, '') + '…';
  return first;
}

// «гном» ≈ «Гномы», «эльфийка» ≈ «Эльфы»: короткое слово без последней буквы — начало длинного.
function stemEq(a, b) {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3) return false;
  const base = s.length > 3 ? s.slice(0, -1) : s;
  return l.startsWith(base) && l.length - base.length <= 5;
}
const wordsOf = (t) => norm(t).split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
function nameMatches(e, text) {
  const ws = wordsOf(text);
  if (!ws.length) return false;
  const cands = [...wordsOf(e.title), ...e.keys.flatMap(wordsOf)];
  return ws.some((w) => cands.some((c) => stemEq(w, c)));
}

// Народ по слову из карточки героя или НПС («гном», «эльфийка»).
export function findPeople(book, text) {
  if (!str(text)) return null;
  return (book || []).find((e) => e.kind === 'people' && e.enabled !== false && nameMatches(e, text)) || null;
}
// Точное название — первым; похожее — только если оно одно (нечёткое совпадение — только однозначное).
function findAny(book, text) {
  const live = (book || []).filter((e) => e.enabled !== false);
  const exact = live.find((e) => norm(e.title) === norm(text));
  if (exact) return exact;
  const fuzzy = live.filter((e) => nameMatches(e, text));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

// Упомянута ли статья в тексте: ключи, название; однословное название — и по основе.
export const mentionedIn = (e, text) => mentioned(e, norm(text));
function mentioned(e, hay) {
  if (!hay) return false;
  const keys = [...e.keys, e.title];
  const t = norm(e.title);
  if (!/\s/.test(t) && t.length > 4) keys.push(t.slice(0, -1));
  return keys.some((k) => keyMatches(k, hay));
}

// Кто из героев в истории (активный и присутствующие) и НПС рядом с героем.
function sceneParty(state) {
  const heroes = partyOf(state);
  const present = ((state.scene && state.scene.present) || []).map(norm);
  const first = (s) => norm(s).split(/\s+/)[0];
  const near = (state.npcs || []).filter((n) => !n.archived && (n.bound || present.some((p) => p === norm(n.name) || first(p) === first(n.name))));
  return { heroes, near };
}

// Начало игры: ни одного ответа рассказчика (служебные OOC не в счёт).
export function isOpening(state) {
  return !viewMessages(state).some((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string' && m.content.trim());
}
export const OPENING_BUDGET_TOKENS = 2400;

export function selectCodex(state) {
  const book = (state.lorebook || []).filter((e) => e.enabled !== false).map((e) => (e.kind ? e : normalizeEntry(e)));
  if (!book.length) return [];
  const picked = new Map();
  const pick = (e, level, prio, why) => {
    const was = picked.get(e.id);
    if (!was || prio > was.prio) picked.set(e.id, { entry: e, level: was && was.level === 'full' ? 'full' : level, prio, why });
    else if (level === 'full') was.level = 'full';
  };
  const msgs = viewMessages(state).filter((m) => typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant') && !m.ooc);
  const lastPlayer = norm([...msgs].reverse().find((m) => m.role === 'user')?.content);
  const last2 = norm(msgs.slice(-2).map((m) => m.content).join('\n'));
  const older = norm(msgs.slice(-6, -2).map((m) => m.content).join('\n'));

  for (const e of book) if (e.always) pick(e, 'full', 100, 'всегда');
  for (const name of (state.scene && state.scene.creatures) || []) { const e = findAny(book, name); if (e) pick(e, 'full', 90, 'в сцене'); }
  for (const e of book) if (mentioned(e, lastPlayer)) pick(e, 'full', 85, 'спросил игрок');
  const { heroes, near } = sceneParty(state);
  // Магия, которая сейчас действует: состояние на листе героя с названием статьи — статья нужна целиком;
  // упомянута в положении НПС рядом — выжимкой.
  for (const e of book) {
    if (e.kind !== 'magic') continue;
    const t = norm(e.title);
    if (heroes.some((c) => (c.blocks || []).some((b) => b.type === 'status' && norm(b.name) === t))) pick(e, 'full', 88, 'действует на героя');
    else if (near.some((n) => mentioned(e, norm(n.status)))) pick(e, 'brief', 75, 'действует на того, кто рядом');
  }
  for (const p of [...near.map((n) => n.race), ...heroes.map((c) => c.race)]) { const e = findPeople(book, p); if (e) pick(e, 'brief', 80, 'народ в сцене'); }
  const loc = norm(state.scene && state.scene.location);
  for (const e of book) if (e.kind === 'place' && loc && mentioned(e, loc)) pick(e, 'brief', 70, 'место сцены');
  for (const e of book) if (mentioned(e, last2)) pick(e, 'brief', 60, 'упомянуто');
  for (const e of book) if (mentioned(e, older)) pick(e, 'brief', 40, 'упоминалось');
  // Открывающая сцена: рассказчик ещё ничего не писал — пусть знает мир не только по названиям.
  if (isOpening(state)) {
    const order = { creature: 30, people: 25, faction: 20, place: 15, magic: 10 };
    for (const e of book) if (order[e.kind]) pick(e, 'brief', order[e.kind], 'начало игры');
  }
  return [...picked.values()].sort((a, b) => b.prio - a.prio);
}

// Предубеждения: только пары народов, которые оба сейчас в сцене.
function prejudiceLines(state) {
  const book = (state.lorebook || []).filter((e) => e.enabled !== false && e.kind === 'people');
  const { heroes, near } = sceneParty(state);
  const here = new Set([...near.map((n) => n.race), ...heroes.map((c) => c.race)].map((r) => findPeople(book, r)).filter(Boolean));
  const lines = [];
  for (const a of here) for (const r of a.relations || []) {
    const b = findPeople(book, r.to);
    if (b && b !== a && here.has(b)) lines.push(`${a.title} о народе «${b.title}»: ${r.text}`);
  }
  return lines;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
function renderBrief(e) {
  const b = entryBrief(e);
  return `• ${e.title} [${KIND_LABEL[e.kind]}]${b ? ' — ' + b : ''}`;
}
// В запросе статья ужата (бюджет кодекса); по подглядыванию рассказчик получает её целиком:
// статья-список (виды рун и их эффекты) в 600 знаков не помещалась, и остальное модель додумывала.
const FIELD_SHORT = { mech_roll: 'К броскам', mech_tick: 'За ход', mech_turns: 'Длится ходов' };
function renderFull(e, { fieldMax = 300, textMax = 600 } = {}) {
  let s = renderBrief(e);
  for (const [k, label] of KIND_FIELDS[e.kind]) {
    const v = e.fields && e.fields[k];
    if (v === undefined || v === '') continue;
    s += `\n  ${FIELD_SHORT[k] || label}: ${k === 'danger' && e.kind === 'creature' ? `${v}/5` : cut(String(v), fieldMax)}`;
  }
  const c = str(e.content);
  if (c && c !== e.brief) s += `\n  ${cut(c.replace(/\s+/g, ' '), textMax)}`;
  return s;
}

// Оглавление для рассказчика: что вообще есть в мире (существа — с опасностью и местом обитания),
// чтобы он брал зверей, народы и фракции отсюда, а не выдумывал. Ограничено INDEX_BUDGET_TOKENS.
export const INDEX_BUDGET_TOKENS = 250;
export function narratorIndex(state) {
  const book = (state.lorebook || []).filter((e) => e.enabled !== false).map((e) => (e.kind ? e : normalizeEntry(e)));
  const label = (e) => {
    if (e.kind !== 'creature') return e.title;
    const f = e.fields || {};
    const bits = [];
    if (f.danger) bits.push('☠'.repeat(f.danger));
    if (str(f.habitat)) bits.push(cut(str(f.habitat).replace(/\s+/g, ' '), 30));
    return bits.length ? `${e.title} (${bits.join(', ')})` : e.title;
  };
  const kinds = [['creature', 'Бестиарий'], ['people', 'Народы'], ['faction', 'Фракции'], ['place', 'Места'], ['magic', 'Магия и явления']];
  const lists = kinds.map(([k, n]) => [n, book.filter((e) => e.kind === k).map(label)]).filter(([, l]) => l.length);
  if (!lists.length) return '';
  const hasMagic = lists.some(([n]) => n === 'Магия и явления');
  const head = `Что есть в этом мире (когда сцене нужен зверь, чудовище, народ, фракция${hasMagic ? ', место, заклинание или иное явление' : ' или место'} — бери отсюда, а не выдумывай; новое — только если ничего не подходит). ` +
    'Чудовища — всегда конкретный вид отсюда, не безымянная «тварь». Выводишь в сцену того, о ком ниже нет подробностей, — сначала загляни в статью (codex_lookup), потом пиши' +
    (hasMagic ? '. Магия и явления действуют строго по статье: не придумывай новых разновидностей и эффектов, пока подходит записанное' : '') + ':';
  // По одному названию по кругу, пока влезает: так ни один раздел не съедает весь бюджет.
  const taken = lists.map(() => []);
  let used = tok(head) + lists.reduce((a, [n]) => a + tok(n + ': \n'), 0);
  const longest = Math.max(...lists.map(([, l]) => l.length));
  for (let i = 0; i < longest; i++) {
    lists.forEach(([, l], j) => {
      if (i >= l.length || taken[j].length < i) return;
      const t = tok(l[i] + ', ');
      if (used + t <= INDEX_BUDGET_TOKENS) { taken[j].push(l[i]); used += t; }
    });
  }
  const more = lists.reduce((a, [, l], j) => a + l.length - taken[j].length, 0);
  const lines = lists.map(([n], j) => taken[j].length ? `${n}: ${taken[j].join(', ')}` : null).filter(Boolean);
  return [head, ...lines].join('\n') + (more ? `\n(и ещё ${more})` : '');
}

// Блок кодекса для рассказчика и какие статьи в нём показаны (полностью или выжимкой).
export function renderCodex(state) {
  const sel = selectCodex(state);
  const prejudice = prejudiceLines(state);
  const index = narratorIndex(state);
  const shown = new Set();
  if (!sel.length && !prejudice.length && !index) return { text: '', shown };
  const budget = isOpening(state) ? OPENING_BUDGET_TOKENS : CODEX_BUDGET_TOKENS;
  const head = '=== КОДЕКС МИРА ===\nНароды, существа, фракции и места этого мира. Не противоречь им; подробности сверх написанного додумывай в том же духе.';
  let used = tok(head);
  const parts = [head];
  if (index) { parts.push(index); used += tok(index); }
  if (prejudice.length) {
    const p = 'Кто здесь как к кому относится (играй через поведение, не объявляй вслух):\n' + prejudice.join('\n');
    parts.push(p); used += tok(p);
  }
  const dropped = [];
  for (const x of sel) {
    const full = x.level === 'full' ? renderFull(x.entry) : null;
    const brief = renderBrief(x.entry);
    if (full && used + tok(full) <= budget) { parts.push(full); used += tok(full); shown.add(x.entry.id); }
    else if (used + tok(brief) <= budget) { parts.push(brief); used += tok(brief); shown.add(x.entry.id); }
    else dropped.push(x.entry.title);
  }
  if (dropped.length) parts.push(`(не поместилось: ${dropped.slice(0, 12).join(', ')}${dropped.length > 12 ? '…' : ''})`);
  return { text: parts.join('\n'), shown };
}
export const codexBlock = (state) => renderCodex(state).text;

// ---- Подглядывание в кодекс ----
// Рассказчик перед тем, как вывести в сцену существо (народ, фракцию), берёт его полную статью —
// чтобы первое же появление было по кодексу, а не «киношным зомби».
export const LOOKUP_TOOL = {
  type: 'function',
  function: {
    name: 'codex_lookup',
    description:
      'Прочитать статьи кодекса мира перед тем, как писать. Вызывай, когда собираешься вывести в сцену существо, ' +
      'народ, фракцию, место, магию или явление из оглавления кодекса, которых нет в кодексе подробно. Названия — как в оглавлении.',
    parameters: {
      type: 'object',
      properties: { titles: { type: 'array', items: { type: 'string' }, description: 'Названия статей, до трёх.' } },
      required: ['titles'],
    },
  },
};
export const hasCodex = (state) => (state.lorebook || []).some((e) => e.enabled !== false);

// Возвращает текст для модели и id найденных статей.
export function lookupCodex(state, titles) {
  const book = (state.lorebook || []).filter((e) => e.enabled !== false).map((e) => (e.kind ? e : normalizeEntry(e)));
  const list = (Array.isArray(titles) ? titles : [titles]).map(str).filter(Boolean).slice(0, 3);
  const found = [];
  const out = [];
  for (const t of list) {
    const e = findAny(book, t);
    if (e) { found.push(e.id); out.push(renderFull(e, { fieldMax: 1000, textMax: 4000 })); continue; }
    const similar = book.filter((x) => nameMatches(x, t)).map((x) => x.title).slice(0, 6);
    out.push(`«${t}» в кодексе не найдено.` + (similar.length ? ` Похожие: ${similar.join(', ')}.` : ' Возьми название из оглавления.'));
  }
  if (!list.length) out.push('Не указано, что искать: передай названия из оглавления кодекса.');
  return { text: out.join('\n'), found };
}

// Какие существа и фракции появились в тексте, хотя рассказчик их статей не видел и не заглядывал в них.
export function codexMisses(state, narration, seen) {
  if (!seen) return [];
  const text = norm(narration);
  if (!text) return [];
  return (state.lorebook || []).filter((e) => e.enabled !== false).map((e) => (e.kind ? e : normalizeEntry(e)))
    .filter((e) => (e.kind === 'creature' || e.kind === 'faction' || e.kind === 'magic') && !seen.has(e.id) && mentioned(e, text))
    .map((e) => e.title);
}

// Оглавление для учётчика: только названия по разделам — чтобы указывать народ НПС и существ в сцене.
export function codexIndex(state) {
  const book = (state.lorebook || []).filter((e) => e.enabled !== false);
  const by = (k) => book.filter((e) => (e.kind || 'other') === k).map((e) => e.title);
  const parts = [['Народы', by('people')], ['Бестиарий', by('creature')], ['Фракции', by('faction')], ['Места', by('place')], ['Магия и явления', by('magic')]]
    .filter(([, l]) => l.length).map(([n, l]) => `${n}: ${l.slice(0, 40).join(', ')}`);
  return parts.length ? 'КОДЕКС (названия — для race у npc и creatures у scene; магия и явления — названия состояний):\n' + parts.join('\n') : '';
}
