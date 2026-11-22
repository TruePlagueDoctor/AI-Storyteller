// Характеристики и постоянный список навыков истории.
// Навык из списка хранится на листе обычным блоком умения с каноническим названием и пометкой block.skill = id;
// навыка без блока герой касается «без подготовки» (уровень «новичок», бонус 0). Блок умения без пометки —
// особый талант героя («Дар медиума»): свободная запись, которая даёт бонус, когда её применяют.
// Название навыка в броске и тренировке выбирается из списка, а не сочиняется моделью.
import { skillStems, synonymGroup } from './skills.js';

export const ATTRIBUTES = [
  { id: 'str', name: 'Сила', hint: 'мощь, здоровье, стойкость' },
  { id: 'dex', name: 'Ловкость', hint: 'координация, точность, быстрота' },
  { id: 'int', name: 'Ум', hint: 'знания, сообразительность, внимательность' },
  { id: 'wil', name: 'Воля', hint: 'самообладание, упорство, сила духа' },
  { id: 'cha', name: 'Обаяние', hint: 'умение ладить с людьми и влиять на них' },
];
export const ATTR_MIN = 1;
export const ATTR_MAX = 6;
export const ATTR_DEFAULT = 3;            // обычный человек: модификатор 0
export const ATTR_BUDGET = 17;            // потолок суммы, когда характеристики расставляет учётчик (все по 3 — это 15)
const ATTR_BY_ID = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, a]));
const low = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е');

export const attrName = (id) => (ATTR_BY_ID[id] ? ATTR_BY_ID[id].name : '');
// «Сила», «сил», «str» → 'str'
export function attrId(text) {
  const t = low(text);
  if (!t) return '';
  if (ATTR_BY_ID[t]) return t;
  const hit = ATTRIBUTES.find((a) => low(a.name) === t) || ATTRIBUTES.find((a) => t.length >= 3 && low(a.name).startsWith(t.slice(0, 4)));
  return hit ? hit.id : '';
}
export const attrValue = (character, id) => {
  const v = Number(character && character.attrs && character.attrs[id]);
  return Number.isFinite(v) ? Math.min(ATTR_MAX, Math.max(ATTR_MIN, Math.round(v))) : ATTR_DEFAULT;
};
// 1 → −2, 3 → 0, 6 → +3
export const attrMod = (value) => Math.min(ATTR_MAX, Math.max(ATTR_MIN, Math.round(Number(value) || ATTR_DEFAULT))) - ATTR_DEFAULT;
export function normalizeAttrs(raw) {
  const out = {};
  for (const a of ATTRIBUTES) out[a.id] = attrValue({ attrs: raw || {} }, a.id);
  return out;
}
export const attrsLine = (character) => ATTRIBUTES.map((a) => `${a.name} ${attrValue(character, a.id)}`).join(', ');

// ---- Заготовки списка ----
const S = (id, name, attr, desc, alt) => ({ id, name, attr, ...(alt ? { alt } : {}), desc });
const BASE = [
  S('athletics', 'Атлетика', 'str', 'бег, прыжки, лазание, плавание, поднять, выломать, увернуться', 'dex'),
  S('brawl', 'Рукопашный бой', 'str', 'драка без оружия, борьба, захваты'),
  S('melee', 'Холодное оружие', 'str', 'мечи, ножи, топоры, копья, фехтование', 'dex'),
  S('fortitude', 'Стойкость', 'str', 'вытерпеть боль, яд, холод, голод, усталость, выпивку'),
  S('shooting', 'Стрельба', 'dex', 'лук, арбалет, огнестрельное и метательное оружие'),
  S('stealth', 'Скрытность', 'dex', 'прокрасться, спрятаться, слежка, уйти незамеченным'),
  S('sleight', 'Ловкость рук', 'dex', 'карманная кража, подбросить, спрятать, шулерство, фокусы'),
  S('lockpick', 'Взлом', 'dex', 'замки, запоры, ловушки, отмычки, вскрыть', 'int'),
  S('riding', 'Езда', 'dex', 'верхом, повозка, лодка, машина, погоня на транспорте'),
  S('notice', 'Внимательность', 'int', 'заметить, услышать, найти спрятанное, осмотреть, обыскать'),
  S('lore', 'Знания', 'int', 'история, науки, обычаи, языки, вспомнить, разобраться в записях'),
  S('medicine', 'Медицина', 'int', 'перевязать, лечить, распознать болезнь или яд, лекарства'),
  S('craft', 'Ремесло', 'int', 'смастерить, починить, приготовить, оценить вещь', 'dex'),
  S('survival', 'Выживание', 'int', 'следы, охота, ориентирование, ночлег, звери, погода'),
  S('composure', 'Самообладание', 'wil', 'не поддаться страху, соблазну, давлению, сохранить лицо'),
  S('intimidate', 'Запугивание', 'wil', 'угроза, давление, сломить, заставить отступить', 'str'),
  S('persuade', 'Убеждение', 'cha', 'уговорить, договориться, торг, переговоры, расположить к себе'),
  S('deceive', 'Обман', 'cha', 'ложь, блеф, притворство, перевоплощение, сыграть роль'),
  S('insight', 'Проницательность', 'cha', 'понять, лжёт ли собеседник, чего он хочет, что чувствует'),
];
export const SKILL_PRESETS = {
  universal: { label: 'Универсальный', skills: BASE },
  fantasy: { label: 'Фэнтези', skills: [...BASE, S('magic', 'Магия', 'wil', 'заклинания, ритуалы, чары, распознать колдовство')] },
  modern: { label: 'Современность', skills: [...BASE, S('tech', 'Техника', 'int', 'компьютеры, электроника, связь, машины и приборы')] },
};
export const defaultCatalog = (preset = 'universal') => (SKILL_PRESETS[preset] || SKILL_PRESETS.universal).skills.map((s) => ({ ...s }));
export const catalogOf = (state) => (Array.isArray(state && state.skillCatalog) && state.skillCatalog.length ? state.skillCatalog : BASE);
export const skillById = (catalog, id) => (catalog || []).find((s) => s.id === id) || null;

// ---- Текстовый вид списка: «Название — Сила/Ловкость — что сюда входит» ----
export function catalogToText(catalog) {
  return (catalog || []).map((s) => `${s.name} — ${attrName(s.attr)}${s.alt ? '/' + attrName(s.alt) : ''}${s.desc ? ` — ${s.desc}` : ''}`).join('\n');
}
// Разобрать текст игрока. Прежние id сохраняются: по названию, а если строк столько же — и по месту (переименование).
// Возвращает { catalog, renamed: [{id, from, to}], removed: [id], errors: [строки, которые не удалось разобрать] }.
export function parseCatalogText(text, prev = []) {
  const rows = [];
  const errors = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+[—–|-]\s+|\s*\|\s*/).map((p) => p.trim());
    const name = (parts[0] || '').replace(/\s+/g, ' ').slice(0, 40);
    const [a, b] = String(parts[1] || '').split(/[\/,]/).map((x) => attrId(x));
    if (!name || !a) { errors.push(line); continue; }
    if (rows.some((r) => low(r.name) === low(name))) continue;
    rows.push({ name, attr: a, ...(b && b !== a ? { alt: b } : {}), desc: parts.slice(2).join(' — ').slice(0, 160) });
  }
  const used = new Set();
  const byName = (n) => prev.find((p) => low(p.name) === low(n) && !used.has(p.id));
  for (const r of rows) { const p = byName(r.name); if (p) { r.id = p.id; used.add(p.id); } }
  const renamed = [];
  if (rows.length === prev.length) {
    rows.forEach((r, i) => {
      if (!r.id && prev[i] && !used.has(prev[i].id)) { r.id = prev[i].id; used.add(r.id); renamed.push({ id: r.id, from: prev[i].name, to: r.name }); }
    });
  }
  for (const r of rows) if (!r.id) r.id = 'c' + Math.random().toString(36).slice(2, 9);
  const catalog = rows.slice(0, 40).map((r) => ({ id: r.id, name: r.name, attr: r.attr, ...(r.alt ? { alt: r.alt } : {}), desc: r.desc }));
  return { catalog, renamed, removed: prev.filter((p) => !catalog.some((c) => c.id === p.id)).map((p) => p.id), errors };
}

// ---- Поиск навыка по тексту ----
// Основы названия и описания навыка: «Взлом замков» целиком покрывается навыком «Взлом — замки, запоры…».
const defStems = (s) => ({ name: skillStems(s.name), all: [...skillStems(s.name), ...skillStems(s.desc || '')] });
const hit = (x, list) => list.some((y) => y === x || y.startsWith(x) || x.startsWith(y))
  || (synonymGroup(x) !== -1 && list.some((y) => synonymGroup(y) === synonymGroup(x)));
function coverage(stems, def) {
  const d = defStems(def);
  if (!stems.length) return 0;
  let covered = 0; let inName = 0;
  for (const x of stems) { if (hit(x, d.all)) covered += 1; if (hit(x, d.name)) inName += 1; }
  return covered / stems.length + 0.01 * inName;
}
// strict — только если все слова текста относятся к навыку (перенос старых умений, записи учётчика): «Магия крови» — не «Магия».
// Иначе хватит половины слов (формулировка рассказчика). Несколько одинаково подходящих — не выбираем никого.
export function matchSkill(catalog, text, { strict = false } = {}) {
  const want = low(text);
  if (!want) return { skill: null, similar: [] };
  const exact = (catalog || []).find((s) => low(s.name) === want);
  if (exact) return { skill: exact, similar: [] };
  const stems = skillStems(want);
  const scored = (catalog || []).map((s) => ({ s, score: coverage(stems, s) })).filter((x) => x.score >= (strict ? 1 : 0.5)).sort((a, b) => b.score - a.score);
  if (!scored.length) return { skill: null, similar: [] };
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.005) return { skill: null, similar: scored.slice(0, 4).map((x) => x.s.name) };
  return { skill: scored[0].s, similar: [] };
}

// ---- Лист героя ----
const LEVELS = ['новичок', 'ученик', 'опытный', 'мастер'];
const lvl = (v) => Math.max(0, LEVELS.indexOf(low(v)));
export const isAbility = (b) => b && b.type === 'ability';
export const skillBlock = (character, id) => ((character && character.blocks) || []).find((b) => isAbility(b) && b.skill === id) || null;
export const talentsOf = (character) => ((character && character.blocks) || []).filter((b) => isAbility(b) && !b.skill);
export const skillLevel = (character, id) => { const b = skillBlock(character, id); return b ? (LEVELS[lvl(b.value)]) : 'новичок'; };
// Навыки выше «новичка» — то, чем герой отличается от любого другого.
export function trainedSkills(character, catalog) {
  return (catalog || []).map((s) => ({ s, b: skillBlock(character, s.id) })).filter((x) => x.b && lvl(x.b.value) > 0)
    .map((x) => ({ ...x.s, level: LEVELS[lvl(x.b.value)] }));
}

// Привести умения героя к списку: что относится к навыку — получает его название и пометку, остальное помечается талантом.
// Безопасно вызывать сколько угодно раз (после загрузки, после восстановления снимка): уже разобранные блоки не трогаются.
export function adoptSkills(character, catalog) {
  if (!character || !Array.isArray(character.blocks)) return false;
  let changed = false;
  const xp = (character.skillXp && typeof character.skillXp === 'object') ? character.skillXp : (character.skillXp = {});
  const ids = new Set((catalog || []).map((s) => s.id));
  for (const b of [...character.blocks]) {
    if (!isAbility(b)) continue;
    if (b.skill && !ids.has(b.skill)) { delete b.skill; b.talent = true; changed = true; continue; } // навык убрали из списка — стал талантом
    if (b.skill || b.talent) continue;
    const exact = (catalog || []).find((s) => low(s.name) === low(b.name));
    const found = exact || (b.locked ? null : matchSkill(catalog, b.name, { strict: true }).skill);
    changed = true;
    if (!found) { b.talent = true; continue; }
    const twin = skillBlock(character, found.id);
    const oldKey = low(b.name); const newKey = low(found.name);
    const carried = Math.max(xp[oldKey] || 0, xp[newKey] || 0);
    if (oldKey !== newKey) delete xp[oldKey];
    if (carried) xp[newKey] = carried;
    if (twin) { // два умения об одном и том же — остаётся одно, с большим уровнем
      if (lvl(b.value) > lvl(twin.value) && !twin.locked) twin.value = LEVELS[lvl(b.value)];
      character.blocks.splice(character.blocks.indexOf(b), 1);
      continue;
    }
    if (!exact && !b.description) b.description = `прежде: ${b.name}`;
    b.name = found.name; b.skill = found.id; b.value = LEVELS[lvl(b.value)];
  }
  return changed;
}
export function adoptAllSkills(state) {
  let changed = false;
  for (const c of (state.characters || [])) {
    if (!c.attrs || typeof c.attrs !== 'object') { c.attrs = normalizeAttrs({}); changed = true; }
    if (adoptSkills(c, catalogOf(state))) changed = true;
  }
  return changed;
}

// Список сменили: переименованные навыки переименовываются и на листах, убранные становятся талантами.
export function applyCatalogChange(state, { renamed = [] } = {}) {
  for (const c of (state.characters || [])) {
    for (const r of renamed) {
      const b = skillBlock(c, r.id);
      if (!b) continue;
      const xp = c.skillXp || (c.skillXp = {});
      if (xp[low(b.name)] != null) { xp[low(r.to)] = xp[low(b.name)]; delete xp[low(b.name)]; }
      b.name = r.to;
    }
    adoptSkills(c, catalogOf(state));
  }
}

// Список для рассказчика и учётчика: «Скрытность (Ловкость) — прокрасться, спрятаться…»
export function catalogLines(catalog) {
  return (catalog || []).map((s) => `${s.name} (${attrName(s.attr)}${s.alt ? ' или ' + attrName(s.alt) : ''})${s.desc ? ' — ' + s.desc : ''}`).join('; ');
}
