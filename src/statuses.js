import { partyOf } from './relations.js';
// Статусы с механикой. Каталог задаёт, что делает статус:
//   rollMod  — модификатор ко всем броскам, пока статус висит;
//   tick     — изменение показателя каждый ход ({ stat, delta });
//   duration — через сколько ходов статус спадёт сам (null = пока не снимут).
// Модель ставит статус по названию, код применяет эффекты. Статус вне
// каталога — просто ярлык, как раньше. Каталог правится в настройках.

export const DEFAULT_STATUSES = [
  { name: 'Отравлен',       rollMod: -2, tick: { stat: 'Здоровье', delta: -3 }, duration: 3 },
  { name: 'Кровотечение',   rollMod: -1, tick: { stat: 'Здоровье', delta: -4 }, duration: 3 },
  { name: 'Ранен',          rollMod: -1, tick: null, duration: null },
  { name: 'Тяжело ранен',   rollMod: -3, tick: { stat: 'Здоровье', delta: -2 }, duration: null },
  { name: 'Болен',          rollMod: -1, tick: { stat: 'Здоровье', delta: -1 }, duration: null },
  { name: 'Измотан',        rollMod: -1, tick: null, duration: 2 },
  { name: 'Истощён',        rollMod: -3, tick: null, duration: null },
  { name: 'Голоден',        rollMod: -1, tick: null, duration: null },
  { name: 'Оглушён',        rollMod: -4, tick: null, duration: 1 },
  { name: 'Напуган',        rollMod: -2, tick: null, duration: 2 },
  { name: 'Пьян',           rollMod: -2, tick: null, duration: 2 },
  { name: 'Проклят',        rollMod: -2, tick: null, duration: 5 },
  { name: 'В ярости',       rollMod: 1,  tick: null, duration: 2 },
  { name: 'Вдохновлён',     rollMod: 2,  tick: null, duration: 2 },
  { name: 'Сосредоточен',   rollMod: 1,  tick: null, duration: 1 },
  { name: 'Благословлён',   rollMod: 2,  tick: null, duration: 3 },
];

const key = (s) => String(s || '').trim().toLowerCase();

// Магия и явления из кодекса партии — тоже состояния: название статьи = название состояния,
// а поля «к броскам / за ход / длится ходов» задают его эффект. Так руна, проклятие или болезнь из кодекса
// работают механически без отдельной записи в общем каталоге (он один на все партии, кодекс — у каждой свой).
const num = (v) => { const n = Number(String(v ?? '').replace(/[−–—]/g, '-').replace(',', '.').replace(/\s+/g, '')); return Number.isFinite(n) ? n : null; };
export function magicStatuses(state) {
  const out = [];
  for (const e of (state && state.lorebook) || []) {
    if (!e || e.kind !== 'magic' || e.enabled === false || !String(e.title || '').trim()) continue;
    const f = e.fields || {};
    const roll = f.mech_roll !== undefined && f.mech_roll !== '' ? num(f.mech_roll) : null;
    const m = String(f.mech_tick || '').match(/^\s*(.+?)\s*([+\-−–]\s*\d+)\s*(?:\/?\s*(?:за\s+)?ход)?\s*$/i);
    const turns = f.mech_turns !== undefined && f.mech_turns !== '' ? num(f.mech_turns) : null;
    // Статья-обзор без эффекта и чисел («Руны суккубов: какие бывают») — не состояние.
    if (!String(f.effect || '').trim() && roll === null && !m && turns === null) continue;
    out.push({
      name: String(e.title).trim(),
      rollMod: roll || 0,
      tick: m && num(m[2]) ? { stat: m[1].trim(), delta: num(m[2]) } : null,
      duration: turns && turns > 0 ? Math.round(turns) : null,
      fromCodex: true,
    });
  }
  return out;
}
// Каталог состояний этой партии: магия из кодекса + общий каталог (при совпадении имён главнее статья партии).
export function statusCatalogOf(state) {
  const magic = magicStatuses(state);
  const taken = new Set(magic.map((d) => key(d.name)));
  return [...magic, ...((state && state.statusCatalog) || []).filter((d) => !taken.has(key(d.name)))];
}

export function findStatusDef(catalog, name) {
  const k = key(name);
  return (catalog || []).find((d) => key(d.name) === k) || null;
}

export function statusEffects(catalog, block) {
  const def = findStatusDef(catalog, block.name) || {};
  const rollMod = block.rollMod ?? def.rollMod ?? 0;
  const tick = block.tick ?? def.tick ?? null;
  return { rollMod: Number(rollMod) || 0, tick };
}

export function statusRollMod(catalog, character) {
  let mod = 0;
  const reasons = [];
  for (const b of character.blocks || []) {
    if (b.type !== 'status') continue;
    const { rollMod } = statusEffects(catalog, b);
    if (!rollMod) continue;
    mod += rollMod;
    reasons.push(`${b.name} ${rollMod > 0 ? '+' : ''}${rollMod}`);
  }
  return { mod, reasons };
}

// Один ход прошёл: тики, длительность, снятие истёкших. Возвращает отчёт.
export function advanceStatuses(state) {
  const catalog = statusCatalogOf(state);
  const report = [];
  // Время идёт для тех, кто в сцене: герой со своей отдельной историей «стоит на паузе», пока играют не за него.
  for (const c of partyOf(state)) {
    const keep = [];
    for (const b of c.blocks || []) {
      if (b.type !== 'status') { keep.push(b); continue; }
      const { tick } = statusEffects(catalog, b);
      const def = findStatusDef(catalog, b.name);
      if (tick && tick.stat) {
        const stat = (c.blocks || []).find((x) => x.type === 'stat' && key(x.name) === key(tick.stat));
        if (stat) {
          const before = Number(stat.value) || 0;
          let after = before + (Number(tick.delta) || 0);
          if (stat.max != null) after = Math.min(stat.max, after);
          after = Math.max(0, after);
          if (after !== before) {
            stat.value = String(after);
            report.push(`${c.name}: «${b.name}» — ${tick.stat} ${after - before > 0 ? '+' : ''}${after - before} (${after}${stat.max != null ? '/' + stat.max : ''})`);
          }
        }
      }
      if (b.duration == null && def && def.duration != null) b.duration = def.duration;
      // Статус, полученный на прошлом ходу, впервые срабатывает сейчас — длительность
      // начинаем отсчитывать только со следующего тика.
      const fresh = b.sinceTurn != null && b.sinceTurn >= (state.turn || 0) - 1;
      if (b.duration != null && !fresh) {
        b.duration = Number(b.duration) - 1;
        if (b.duration <= 0) { report.push(`${c.name}: статус «${b.name}» прошёл`); continue; }
      }
      keep.push(b);
    }
    c.blocks = keep;
  }
  return report;
}

export function describeStatus(catalog, block) {
  const { rollMod, tick } = statusEffects(catalog, block);
  const bits = [];
  if (rollMod) bits.push(`${rollMod > 0 ? '+' : ''}${rollMod} к броскам`);
  if (tick && tick.stat) bits.push(`${tick.stat} ${tick.delta > 0 ? '+' : ''}${tick.delta}/ход`);
  if (block.duration != null) bits.push(`${block.duration} ход${block.duration === 1 ? '' : block.duration < 5 ? 'а' : 'ов'}`);
  return bits.length ? `${block.name} (${bits.join(', ')})` : block.name;
}

export function normalizeStatusCatalog(raw) {
  if (!Array.isArray(raw)) return DEFAULT_STATUSES.map((s) => ({ ...s, tick: s.tick ? { ...s.tick } : null }));
  return raw
    .filter((s) => s && String(s.name || '').trim())
    .map((s) => ({
      name: String(s.name).trim(),
      rollMod: Number(s.rollMod) || 0,
      tick: s.tick && s.tick.stat ? { stat: String(s.tick.stat).trim(), delta: Number(s.tick.delta) || 0 } : null,
      duration: s.duration == null || s.duration === '' ? null : Math.max(1, Number(s.duration) || 1),
    }));
}
