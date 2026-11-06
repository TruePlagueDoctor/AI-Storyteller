import { VITAL_STAT } from './dice.js';

// Сверка текста рассказчика с состоянием, которым владеет код.
// Ловим только надёжные, однозначные расхождения — ложная тревога хуже пропуска.

const DEAD = /(мёртв|мертв|погиб|убит|скончал|труп)/i;
const ACTS = /(говорит|сказал|отвеча|шепч|кричит|спрашива|смеётся|смеется|кивает|подходит|входит|улыба|хмур)/i;

// Ищем упоминание имени (первое слово) в тексте.
function mentioned(text, name) {
  const first = String(name).trim().split(/\s+/)[0];
  if (!first || first.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text);
}

// Предложения, где упомянут персонаж.
function sentencesWith(text, name) {
  return text.split(/(?<=[.!?…])\s+/).filter((s) => mentioned(s, name));
}

export function findContradictions(state, narration) {
  const text = String(narration || '');
  if (!text.trim()) return [];
  const issues = [];

  // 1. Мёртвый персонаж действует в сцене.
  for (const npc of state.npcs || []) {
    if (!DEAD.test(npc.status || '')) continue;
    const acting = sentencesWith(text, npc.name).some((s) => ACTS.test(s));
    if (acting) {
      issues.push({
        kind: 'dead-acts',
        text: `«${npc.name}» помечен как «${npc.status}», но действует в сцене.`,
      });
    }
  }

  // 2. Показатель вышел за границы (учёт мог записать лишнее).
  for (const c of state.characters || []) {
    for (const b of c.blocks || []) {
      if (b.type !== 'stat' || b.max == null) continue;
      const v = Number(b.value);
      if (!Number.isFinite(v)) continue;
      if (v > b.max) issues.push({ kind: 'stat-over', text: `«${b.name}» у ${c.name}: ${v} больше максимума ${b.max}.`, fix: { c, b, value: b.max } });
      if (v < 0) issues.push({ kind: 'stat-under', text: `«${b.name}» у ${c.name} ушло ниже нуля.`, fix: { c, b, value: 0 } });
    }
  }

  // 3. Герой при смерти, но рассказчик описывает его бодрым.
  const active = (state.characters || []).find((c) => c.id === state.activeCharacterId);
  if (active) {
    // Только показатели тела и духа: шкала вроде «Репутация 0/100» или
    // счётчик прогресса — не рана, бодрости не противоречит.
    const vital = (active.blocks || []).find(
      (b) => b.type === 'stat' && b.max != null && VITAL_STAT.test(b.name || '') && Number(b.value) / b.max <= 0.15 && Number(b.value) >= 0
    );
    if (vital && /(бодр|полон сил|свеж|без труда|легко вскак|как ни в чём)/i.test(text)) {
      issues.push({
        kind: 'wounded-fresh',
        text: `«${vital.name}» на исходе (${vital.value}/${vital.max}), но герой описан бодрым.`,
      });
    }
  }

  return issues;
}

// Числовые расхождения чиним сразу — это безопасно и не требует модели.
export function autoFix(issues) {
  const fixed = [];
  for (const i of issues) {
    if (i.fix) {
      i.fix.b.value = String(i.fix.value);
      fixed.push(i.text);
    }
  }
  return fixed;
}

// Заметка рассказчику на следующий ход, чтобы не повторял ошибку.
export function correctionNote(issues) {
  const narrative = issues.filter((i) => !i.fix && !i.silent);
  if (!narrative.length) return '';
  return (
    '[Замечание по прошлому ходу — исправь и не повторяй: ' +
    narrative.map((i) => i.text).join(' ') +
    ']'
  );
}

// ---- Живость сцены ----
// Не противоречия, а признаки «плоского» хода: длинная сцена с людьми без единой
// реплики, или игрок сам объявил исход, а проверки не было. Уходят рассказчику
// тем же замечанием на следующий ход.
const PEOPLE = /(гост|люд|мужчин|женщин|слуг|дам[аыеу](?!\p{L})|девиц|девушк|парен|старик|незнакомец|незнакомк|хозя|толп|собеседник|компани)/iu;
const DECLARED = /(было\s+не\s*сложно|несложно|без\s+труда|легко\s+(удалось|получилось|справил)|удалось|получилось|поверил[иа]?(?!\p{L})|никто\s+не\s+(заметил|понял|усомнил)|убедил|обманул|проскользнул|справил(ся|ась)|как\s+и\s+положено|всё\s+прошло\s+гладко)/iu;

const QUIET = /(скрыт|крадус|прячус|слеж|наблюда|выжида|подслуш|тихо|незамет|один(?!\p{L})|одна(?!\p{L})|в одиночестве|готовлюсь|осматриваю)/iu;

export function findSceneIssues(state, narration, action, rolls) {
  const text = String(narration || '');
  const issues = [];
  if (text.length < 400) return issues;
  if (QUIET.test(String(action || ''))) return issues; // тишина по делу — не плоский ход

  const npcMentioned = (state.npcs || []).some((n) => mentioned(text, n.name));
  const peopleAround = npcMentioned || PEOPLE.test(text);
  // Одна цитата в кавычках — ещё не разговор; ищем хотя бы две реплики.
  const replicas = (text.match(/[«"“]/g) || []).length + (text.match(/(^|\n)\s*[—–-]\s*\S/g) || []).length;
  if (peopleAround && replicas < 2) {
    issues.push({
      kind: 'no-dialogue',
      text: 'В сцене были люди, но никто не произнёс ни слова прямой речью. Дай им голос: хотя бы один живой обмен репликами с именами говорящих.',
    });
  }
  if (DECLARED.test(String(action || '')) && !(rolls && rolls.length)) {
    issues.push({
      kind: 'declared-outcome',
      text: 'Игрок сам объявил исход своего действия, а ты его просто принял. Исход решаешь ты (через roll_check, если он не предрешён), игрок только заявляет намерение.',
    });
  }
  return issues;
}

// ---- Вопросы в конце ответа ----
// Модели любят заканчивать реплику вопросом к герою и переспрашивать уже решённое
// («Уверен? Точно? Согласен?»). Это раздражает: герой уже ответил «да».
const RECONFIRM = /(^|[^\p{L}])(уверен[аы]?|ты\s+(точно|действительно|правда|серь[её]зно|уверен[аы]?)[^.!?«»"]{0,40}|точно|согласен|согласна|согласны|не\s+передумал[аи]?|подумай(те)?\s+ещ[её]\s+раз)\s*[?]/iu;
// Кончается ли текст вопросом: последний знак перед закрывающими кавычками и тире — «?».
const endsWithQuestion = (t) => /\?[\s»"”'—–-]*$/.test(String(t || '').trim());

export function findQuestionIssues(state, narration) {
  const text = String(narration || '');
  const issues = [];
  if (RECONFIRM.test(text)) {
    issues.push({
      kind: 'reconfirm',
      text: 'Персонаж переспросил то, что герой уже решил («уверен? точно? согласен?»). Не переспрашивай: согласие героя — это согласие, дальше сразу действие и последствия.',
    });
  }
  // Сколько ответов подряд (с текущим) кончаются вопросом к герою.
  const prev = (state.messages || []).filter((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string').map((m) => m.content);
  if (prev.length && prev[prev.length - 1] === text) prev.pop(); // текущий ответ уже лежит в истории
  const lastThree = [...prev.slice(-2), text];
  if (lastThree.length === 3 && lastThree.every(endsWithQuestion)) {
    issues.push({
      kind: 'question-endings',
      text: 'Три ответа подряд заканчиваются вопросом к герою. Закончи иначе: действием или решением персонажа, событием, условием, паузой — игрок сам скажет, что делать.',
    });
  }
  return issues;
}
