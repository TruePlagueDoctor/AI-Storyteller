// Движок проверок. Исход решает код, а не модель:
// бросок d20 + бонус за уровень владения против порога сложности.
import { matchAbility } from './skills.js';
import { adoptSkills, matchSkill, talentsOf, skillBlock, attrValue, attrMod, attrName, defaultCatalog } from './skillset.js';

const BASE_CATALOG = defaultCatalog();

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

// Обстоятельства: как герой подошёл к делу. Сложность — о самой задаче, а это — о подготовке, плане, инструменте,
// позиции (преимущество) или о спешке, негодных средствах, чужой настороженности (помеха).
// Без этого продуманная заявка игрока бросалась так же, как необдуманная.
export const EDGE_MOD = { 'помеха': -2, 'нет': 0, 'преимущество': 2, 'большое преимущество': 4 };

// Показатели тела и духа: раненый, измотанный, теряющий рассудок герой действует хуже.
// Граница слова — через (?!\p{L}): обычный \b в JS не видит кириллицу, и «Сила» не находилась.
export const VITAL_STAT = /(здоров|жизн|(?<![\p{L}])hp(?![\p{L}])|рассуд|психик|вынослив|бодр|энерг|стамин|(?<![\p{L}])сил[аы](?![\p{L}]))/iu;

// Что даёт герою бросок: характеристика навыка (лучшая из двух, если у навыка их две) и уровень владения.
// Навык берётся из списка истории; особый талант с листа («Дар медиума») даёт свой уровень, когда его применяют.
// Названия нет ни в списке, ни среди талантов — бросок «без подготовки», как у любого человека с улицы.
function bonusFor(character, skillName, { catalog = BASE_CATALOG, talent = '' } = {}) {
  const none = { bonus: 0, level: 'без подготовки', block: null, attr: '', attrMod: 0, def: null, unlisted: true };
  if (!character || !skillName) return none;
  adoptSkills(character, catalog); // умения, записанные до появления списка, раскладываются по нему
  const def = matchSkill(catalog, skillName).skill;
  const talents = talentsOf(character);
  const gift = (talent && matchAbility(talents, talent)) || (!def ? matchAbility(talents, skillName) : null);
  if (!def && !gift) return none;
  let attr = ''; let mod = 0;
  if (def) {
    const ids = [def.attr, def.alt].filter(Boolean);
    const best = ids.sort((x, y) => attrMod(attrValue(character, y)) - attrMod(attrValue(character, x)))[0];
    attr = attrName(best); mod = attrMod(attrValue(character, best));
  }
  const own = def ? skillBlock(character, def.id) : null;
  const lv = (blk) => (blk ? (SKILL_BONUS[String(blk.value || '').trim().toLowerCase()] ?? 1) : 0); // нестандартный уровень — минимальный бонус
  const useGift = gift && lv(gift) >= lv(own) && (lv(gift) > 0 || !def);
  const block = useGift ? gift : own;
  return {
    bonus: lv(block), level: block ? (block.value || 'освоено') : 'новичок', block, attr, attrMod: mod, def,
    talent: useGift ? gift.name : undefined, unlisted: false,
  };
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
export function rollCheck({ character, skill, talent, catalog, difficulty, traitMod = 0, traitReasons = [], edge: edgeKey = 'нет', edgeReason = '' }) {
  const diffKey = String(difficulty || 'обычно').trim().toLowerCase();
  const target = DIFFICULTY_TARGET[diffKey] ?? DIFFICULTY_TARGET['обычно'];
  const { bonus, level, block, attr, attrMod: am, def, talent: gift, unlisted } = bonusFor(character, skill, { catalog, talent });
  const { penalty, reason } = conditionPenalty(character);

  // Преимущество — только с названной причиной: её видит игрок, и «+4 просто так» не проходит.
  const why = String(edgeReason || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const wanted = EDGE_MOD[String(edgeKey || 'нет').trim().toLowerCase()] ?? 0;
  const edge = wanted > 0 && !why ? 0 : wanted;
  const edgeDenied = wanted > 0 && !why;

  const roll = d20();
  const total = roll + am + bonus - penalty + traitMod + edge;

  let outcome;
  if (roll === 1) outcome = 'критический провал';
  else if (roll === 20) outcome = 'критический успех';
  else if (total >= target + 5) outcome = 'уверенный успех';
  else if (total >= target) outcome = 'успех';
  else if (total >= target - 3) outcome = 'провал с зацепкой';
  else outcome = 'провал';

  const success = outcome.includes('успех');
  return {
    // В журнал и опыт идёт название навыка из списка, а не формулировка модели.
    skill: def ? def.name : block ? block.name : (skill || '—'),
    skillId: def ? def.id : undefined,
    asked: (def || block) && (def ? def.name : block.name).toLowerCase() !== String(skill || '').trim().toLowerCase() ? skill : undefined,
    attr: attr || undefined, attrMod: am,
    talent: gift, unlisted: unlisted || undefined,
    level,
    difficulty: diffKey,
    roll, bonus, penalty, traitMod, traitReasons, edge, edgeReason: edge ? why : undefined, edgeDenied: edgeDenied || undefined, total, target,
    outcome, success,
    penaltyReason: reason,
  };
}

// Как результат подаётся модели: коротко и однозначно.
export function describeRoll(r) {
  const parts = [
    `Проверка «${r.skill}»${r.talent ? ` с талантом «${r.talent}»` : ''} (${r.level}${r.attr ? `, ${r.attr}` : ''}), сложность: ${r.difficulty}.`,
    `Бросок ${r.roll}${r.attr ? ` ${r.attrMod < 0 ? '−' : '+'} ${Math.abs(r.attrMod)} (${r.attr})` : ''} + ${r.bonus}${r.penalty ? ` − ${r.penalty} (${r.penaltyReason})` : ''}` +
      `${r.traitMod ? ` ${r.traitMod > 0 ? '+' : '−'} ${Math.abs(r.traitMod)} (${(r.traitReasons || []).join('; ')})` : ''}` +
      `${r.edge ? ` ${r.edge > 0 ? '+' : '−'} ${Math.abs(r.edge)} (обстоятельства${r.edgeReason ? ': ' + r.edgeReason : ''})` : ''}` +
      ` = ${r.total} против ${r.target}.`,
    ...(r.unlisted ? ['Такого навыка в списке нет — бросок без подготовки. В следующий раз бери skill точно из списка навыков.'] : []),
    ...(r.edgeDenied ? ['Преимущество не засчитано: не названо, чем оно заслужено (edge_reason).'] : []),
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
