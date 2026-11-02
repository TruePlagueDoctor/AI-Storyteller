// Хроника — журнал установленных фактов и событий, которые нельзя терять при
// сжатии истории: обещания, долги, ложь, раскрытые тайны, решения, смерти,
// факты о прошлом. В промт попадают ВЫБОРОЧНО: незакрытые обязательства,
// события с участием тех, кто сейчас в сцене, и совпавшие по ключевым словам.
// Иначе хроника съедала бы внимание модели, как это было с «каноном».

import { randomUUID } from 'node:crypto';
import { parseTimeHint } from './scene.js';

export const EVENT_TYPES = ['promise', 'debt', 'plan', 'lie', 'reveal', 'decision', 'death', 'fact', 'relation', 'other'];
// «Висящее» — то, что держится, пока его не исполнят, не нарушат или пока не пройдёт срок.
export const OBLIGATION = new Set(['promise', 'debt', 'plan']);
export const OUTCOMES = ['done', 'broken', 'past'];
const OUTCOME_LABEL = { done: 'исполнено', broken: 'нарушено', past: 'прошло/отменено' };
const TYPE_LABEL = {
  promise: 'обещание', debt: 'долг', plan: 'назначено', lie: 'ложь', reveal: 'раскрыто', decision: 'решение',
  death: 'смерть', fact: 'факт', relation: 'отношения', other: 'событие',
};
export const typeLabel = (t) => TYPE_LABEL[t] || TYPE_LABEL.other;
export const outcomeLabel = (o) => OUTCOME_LABEL[o] || 'закрыто';

// Факт про будущее («ожидает приём», «завтра казнь») устаревает, даже если записан как «факт».
const FUTURE_RE = /ожида|предсто|назнач|запланир|завтра|сегодня|вечером|утром|в полдень|в полночь|через\s|скоро|собира|намерева|долж(ен|на|ны)\s|встреч|при[её]м|аудиенц|приглаш|срок|до\s(зимы|весны|лета|осени|рассвета|заката|утра|вечера|полуночи)|будет|будут/i;
export const looksTimed = (e) => e.type === 'plan' || Boolean(e.when) || FUTURE_RE.test(e.text);

const fmtClock = (c) => `день ${c.day}, ${String(Math.floor(c.minute / 60)).padStart(2, '0')}:${String(c.minute % 60).padStart(2, '0')}`;

// Срок по сцене: от момента записи (at) и словесного «когда» («в полдень», «завтра вечером», «18:00»).
export function dueOf(e) {
  // Срок не указан отдельно, но сам факт про будущее («в полдень ожидает приём») — берём время из текста.
  const when = e.when || (FUTURE_RE.test(e.text) ? e.text : '');
  if (!e.at || !when) return null;
  const hint = parseTimeHint(when);
  const tomorrow = /завтра/i.test(when);
  const after = /послезавтра/i.test(when) ? 2 : tomorrow ? 1 : 0;
  const rel = String(when).match(/через\s+(\d+)?\s*(час|день|дн|сут)/i);
  if (rel) {
    const n = Number(rel[1]) || 1;
    const add = /час/i.test(rel[2]) ? n * 60 : n * 1440;
    const total = e.at.minute + add;
    return { day: e.at.day + Math.floor(total / 1440), minute: total % 1440 };
  }
  if (!hint && !after) return null;
  let day = e.at.day + after;
  const minute = hint ? hint.minute : 12 * 60;
  if (!after && minute < e.at.minute) day += 1; // «в полдень», записанное вечером, — это завтрашний полдень
  return { day, minute };
}
export function isOverdue(e, scene) {
  if (e.status !== 'open' || !scene) return false;
  const d = dueOf(e);
  if (!d) return false;
  return scene.day * 1440 + scene.minute > d.day * 1440 + d.minute;
}

const STOP = /^(что|кто|это|был|была|было|были|для|как|так|его|её|ему|ей|они|она|он|мы|вы|при|над|под|про|без|через|после|перед|когда|потом|тогда|уже|ещё|еще|один|одна|очень|самый|себя|свой|своя|свои|тот|эта|этот|тем|том)$/;
export function stems(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.test(w)).map((w) => w.slice(0, 4));
}

export function normalizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object' && String(e.text || '').trim()).map((e) => ({
    id: e.id || randomUUID(),
    turn: Number(e.turn) || 0,
    type: EVENT_TYPES.includes(e.type) ? e.type : 'other',
    text: String(e.text).trim(),
    participants: Array.isArray(e.participants) ? e.participants.map((x) => String(x).trim()).filter(Boolean) : [],
    knownBy: Array.isArray(e.knownBy) ? e.knownBy.map((x) => String(x).trim()).filter(Boolean) : [],
    status: e.status === 'done' ? 'done' : 'open',
    outcome: OUTCOMES.includes(e.outcome) ? e.outcome : '',
    when: String(e.when || '').trim(),
    at: e.at && Number.isFinite(Number(e.at.day)) ? { day: Number(e.at.day), minute: Number(e.at.minute) || 0 } : null,
    locked: Boolean(e.locked),
  }));
}

// Поиск похожего события — чтобы учётчик не плодил дубли одной и той же записи.
export function findSimilar(events, text) {
  const a = stems(text);
  if (!a.length) return null;
  let best = null; let score = 0;
  for (const e of events) {
    const b = stems(e.text);
    if (!b.length) continue;
    const common = a.filter((w) => b.includes(w)).length;
    const s = common / Math.min(a.length, b.length);
    if (s > score) { score = s; best = e; }
  }
  return score >= 0.6 && Math.min(a.length, stems(best.text).length) >= 2 ? best : null;
}

const nameKey = (n) => String(n || '').toLowerCase().split(/\s+/)[0];
const involves = (e, names) => e.participants.some((p) => names.includes(nameKey(p)));

// Выборка для рассказчика. names — кто сейчас в сцене (герой, присутствующие, привязанные).
export function selectForNarrator(events, { sceneNames = [], recentText = '', limit = 18 } = {}) {
  const names = sceneNames.map(nameKey).filter(Boolean);
  const hay = stems(recentText);
  const picked = new Map();
  const add = (e, why) => { if (!picked.has(e.id)) picked.set(e.id, { e, why }); };

  // 1. Незакрытые обязательства — всегда, иначе их и забывают.
  for (const e of events) if (e.status === 'open' && OBLIGATION.has(e.type)) add(e, 'долг');
  // 2. События с участием тех, кто в сцене — последние по времени.
  [...events].reverse().filter((e) => involves(e, names)).slice(0, 10).forEach((e) => add(e, 'в сцене'));
  // 3. Совпадения по ключевым словам с недавними ходами.
  if (hay.length) {
    for (const e of events) {
      const s = stems(e.text);
      if (s.some((w) => hay.includes(w)) && s.filter((w) => hay.includes(w)).length >= 2) add(e, 'по теме');
    }
  }
  return [...picked.values()].slice(0, limit).map((x) => x.e).sort((a, b) => a.turn - b.turn);
}

export function chronicleBlock(events, opts) {
  const sel = selectForNarrator(events || [], opts);
  if (!sel.length) return '';
  const names = (opts.sceneNames || []).map(nameKey);
  const lines = sel.map((e) => {
    // Кто из присутствующих НЕ знает об этом — отдельно, это главный источник «всеведения».
    const unaware = e.knownBy.length && e.status !== 'done'
      ? (opts.sceneNames || []).filter((n) => !e.knownBy.map(nameKey).includes(nameKey(n)) && names.includes(nameKey(n)))
      : [];
    const tag = e.status === 'done' ? ` (${outcomeLabel(e.outcome)})`
      : isOverdue(e, opts.scene) ? ' (назначенный срок по часам уже прошёл)'
      : e.when ? ` (когда: ${e.when})` : '';
    const who = unaware.length ? ` — ${e.type === 'lie' ? 'правды НЕ знают' : 'НЕ знают'}: ${unaware.join(', ')}` : '';
    return `• [ход ${e.turn}, ${typeLabel(e.type)}] ${e.text}${tag}${who}`;
  });
  return '=== ХРОНИКА (установленные факты — не противоречь им) ===\n' + lines.join('\n') +
    '\nЕсли рядом с фактом указано, кто о нём НЕ знает, — этот персонаж не может на него ссылаться, пока не узнает в сцене.';
}

// Для учётчика: с номерами (#N — позиция в хронике), чтобы закрывать точно, а не угадывать текст.
// Всегда — всё «висящее» и всё, что звучит как будущее (встречи, сроки); плюс последние записи.
export function chronicleForSync(events, scene) {
  if (!events || !events.length) return '';
  const idx = new Map(events.map((e, i) => [e.id, i + 1]));
  const open = events.filter((e) => e.status === 'open' && (OBLIGATION.has(e.type) || looksTimed(e)));
  const recent = events.slice(-10);
  const seen = new Set();
  const list = [...open, ...recent].filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(-30);
  let overdue = 0;
  const lines = list.map((e) => {
    const bits = [typeLabel(e.type), `ход ${e.turn}`];
    if (e.at) bits.push('записано ' + fmtClock(e.at));
    if (e.when) bits.push('когда: ' + e.when);
    let tail = '';
    if (e.status === 'done') tail = ` (закрыто: ${outcomeLabel(e.outcome)})`;
    else if (isOverdue(e, scene)) { tail = ' ⚠ СРОК ПРОШЁЛ'; overdue++; }
    else if (e.locked) tail = ' 🔒';
    return `#${idx.get(e.id)} [${bits.join(', ')}] ${e.text}${tail}`;
  });
  return 'ХРОНИКА (уже записано — не дублируй; #номер — чтобы закрыть или поправить запись):\n' + lines.join('\n') +
    (overdue ? '\nЗаписи с ⚠ — срок по часам сцены прошёл: закрой (outcome past/done/broken) или поправь, если событие перенесли.' : '');
}
