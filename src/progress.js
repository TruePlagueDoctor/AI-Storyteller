// Прогресс умений через использование: успешная проверка даёт опыт навыку,
// на порогах уровень растёт. Данные берутся из бросков.

export const LEVELS = ['новичок', 'ученик', 'опытный', 'мастер'];
export const THRESHOLDS = { 'ученик': 3, 'опытный': 7, 'мастер': 14 };

const key = (s) => String(s || '').trim().toLowerCase();
const levelIndex = (v) => { const i = LEVELS.indexOf(key(v)); return i === -1 ? 0 : i; };
function levelForXp(xp) {
  let lvl = 'новичок';
  for (const [name, need] of Object.entries(THRESHOLDS)) if (xp >= need) lvl = name;
  return lvl;
}

// Опыт копится только у умений, которые есть в листе (их находит dice.js по смыслу и
// подставляет настоящее название). Раньше после трёх удач по любой формулировке
// заводилось новое умение — так появлялись дубли и «умения» вроде «Открыть дверь».
// Заводить умения — дело учётчика: он видит, устойчивая ли это компетенция.
export function recordRoll(character, roll) {
  if (!character || !roll || !roll.skill || roll.skill === '—') return null;
  const k = key(roll.skill);
  const block = (character.blocks || []).find((b) => b.type === 'ability' && key(b.name) === k);
  if (!block) return null;
  if (block.locked) return null; // закреплённое игроком умение не растёт само
  const gain = roll.outcome === 'критический успех' ? 2 : roll.success ? 1 : 0;
  if (!gain) return null;
  if (!character.skillXp || typeof character.skillXp !== 'object') character.skillXp = {};
  // Стартовый уровень засчитывается: «опытному» до мастера — 14 − 7, а не 14 с нуля.
  const floor = THRESHOLDS[key(block.value)] || 0;
  character.skillXp[k] = Math.max(character.skillXp[k] || 0, floor) + gain;
  const target = levelForXp(character.skillXp[k]);
  if (levelIndex(target) > levelIndex(block.value)) {
    const was = block.value || 'новичок';
    block.value = target;
    return `${character.name}: «${block.name}» выросло — ${was} → ${target}`;
  }
  return null;
}

export function progressInfo(character, skillName) {
  const xp = character?.skillXp?.[key(skillName)] || 0;
  const current = levelForXp(xp);
  const next = Object.entries(THRESHOLDS).find(([, need]) => xp < need);
  return { xp, current, next: next ? { level: next[0], need: next[1] } : null };
}
