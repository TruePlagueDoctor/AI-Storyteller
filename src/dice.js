// Движок проверок. Исход решает код, а не модель:
// бросок d20 + бонус за уровень владения против порога сложности.
import { matchAbility } from './skills.js';

export const SKILL_BONUS = {
  'новичок': 0,
  'ученик': 2,
  'опытный': 4,
  'мастер': 6,
};

export const DIFFICULTY_TARGET = {
  'легко': 8,
  'обычно': 11,
  'сложно': 14,
  'очень сложно': 17,
};

// Показатели тела и духа: раненый, измотанный, теряющий рассудок герой действует хуже.
// Граница слова — через (?!\p{L}): обычный \b в JS не видит кириллицу, и «Сила» не находилась.
export const VITAL_STAT = /(здоров|жизн|(?<![\p{L}])hp(?![\p{L}])|рассуд|психик|вынослив|бодр|энерг|стамин|(?<![\p{L}])сил[аы](?![\p{L}]))/iu;

// Насколько уровень владения влияет на бросок. Умение не найдено — без бонуса.
// Умение ищется по смыслу (см. skills.js): «Взлом» находит «Взлом замков».
function bonusFor(character, skillName) {
  if (!character || !skillName) return { bonus: 0, level: 'без подготовки', block: null };
  const block = matchAbility(character.blocks, skillName);
  if (!block) return { bonus: 0, level: 'без подготовки', block: null };
  const level = String(block.value || '').trim().toLowerCase();
  const bonus = SKILL_BONUS[level] ?? 1; // нестандартный уровень — минимальный бонус
  return { bonus, level: block.value || 'освоено', block };
}

// Штраф за тяжёлое состояние: раненый герой действует хуже.
function conditionPenalty(character) {
  // Только показатели тела и духа: пустой кошелёк не мешает драться.
  const stats = (character.blocks || []).filter((b) => b.type === 'stat' && b.max != null && VITAL_STAT.test(b.name || ''));
  for (const s of stats) {
    const v = Number(s.value);
    if (Number.isFinite(v) && s.max > 0) {
      const ratio = v / s.max;
      if (ratio <= 0.25) return { penalty: 2, reason: `${s.name} на исходе` };
      if (ratio <= 0.5) return { penalty: 1, reason: `${s.name} невысоко` };
    }
  }
  return { penalty: 0, reason: '' };
}

const d20 = () => 1 + Math.floor(Math.random() * 20);

// Выполняет проверку и возвращает подробный, но компактный результат.
export function rollCheck({ character, skill, difficulty, traitMod = 0, traitReasons = [] }) {
  const diffKey = String(difficulty || 'обычно').trim().toLowerCase();
  const target = DIFFICULTY_TARGET[diffKey] ?? DIFFICULTY_TARGET['обычно'];
  const { bonus, level, block } = bonusFor(character, skill);
  const { penalty, reason } = conditionPenalty(character);

  const roll = d20();
  const total = roll + bonus - penalty + traitMod;

  let outcome;
  if (roll === 1) outcome = 'критический провал';
  else if (roll === 20) outcome = 'критический успех';
  else if (total >= target + 5) outcome = 'уверенный успех';
  else if (total >= target) outcome = 'успех';
  else if (total >= target - 3) outcome = 'провал с зацепкой';
  else outcome = 'провал';

  const success = outcome.includes('успех');
  return {
    // Нашлось умение — в журнал и опыт идёт его настоящее название, а не формулировка модели.
    skill: block ? block.name : (skill || '—'),
    asked: block && block.name.toLowerCase() !== String(skill || '').trim().toLowerCase() ? skill : undefined,
    level,
    difficulty: diffKey,
    roll, bonus, penalty, traitMod, traitReasons, total, target,
    outcome, success,
    penaltyReason: reason,
  };
}

// Как результат подаётся модели: коротко и однозначно.
export function describeRoll(r) {
  const parts = [
    `Проверка «${r.skill}» (${r.level}), сложность: ${r.difficulty}.`,
    `Бросок ${r.roll} + ${r.bonus}${r.penalty ? ` − ${r.penalty} (${r.penaltyReason})` : ''}` +
      `${r.traitMod ? ` ${r.traitMod > 0 ? '+' : '−'} ${Math.abs(r.traitMod)} (${(r.traitReasons || []).join('; ')})` : ''}` +
      ` = ${r.total} против ${r.target}.`,
    `ИСХОД: ${r.outcome.toUpperCase()}.`,
  ];
  if (r.outcome === 'критический провал') {
    parts.push('Всё пошло скверно: помимо неудачи добавь неприятное осложнение.');
  } else if (r.outcome === 'провал с зацепкой') {
    parts.push('Не вышло, но герой узнал или заметил что-то полезное.');
  } else if (r.outcome === 'критический успех') {
    parts.push('Вышло даже лучше задуманного — добавь дополнительную выгоду.');
  }
  parts.push('Опиши сцену по этому исходу. Не меняй его и не смягчай.');
  return parts.join(' ');
}
