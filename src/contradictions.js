import { viewMessages } from './lines.js';
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
  const prev = viewMessages(state).filter((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string').map((m) => m.content);
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

// ---- Оформление: разметка и меню вариантов ----
// Лента показывает прозу: заголовки, списки и **жирный** выглядят мусором, а меню «1. … 2. …» в конце
// подталкивает игрока выбирать из предложенного вместо своего хода.
const MD_MARK = /(^|\n)\s{0,3}#{1,4}\s+\S|\*\*[^*\n]+\*\*|(^|\n)\s*[*•]\s+\S[^\n]*\n\s*[*•]\s+\S/u;
const OPTION_LINE = /^\s*(?:\d{1,2}[.)]|[а-гa-d]\))\s+\S/iu;
const OPTIONS_ASK = /(?:^|\n)\s*(?:варианты(?:\s+действий)?\s*:|что\s+(?:ты\s+|вы\s+)?(?:будешь|будете|станешь|станете)\s+делать\s*\?|твои\s+действия\s*[:?]|ваши\s+действия\s*[:?])\s*$/iu;
export function findFormatIssues(narration) {
  const text = String(narration || '').trim();
  const issues = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-4);
  const menu = tail.filter((l) => OPTION_LINE.test(l)).length >= 2 || OPTIONS_ASK.test(text);
  if (menu) {
    issues.push({ kind: 'options', text: 'Ответ закончился списком вариантов действий или вопросом «что будешь делать?». Не предлагай варианты: закончи событием или репликой персонажа — игрок решит сам.' });
  }
  if (MD_MARK.test(text)) {
    issues.push({ kind: 'markup', text: 'В ответе была разметка (заголовки, списки или **жирный**). Пиши только прозу и реплики, без разметки.' });
  }
  return issues;
}

// ---- Штампы ИИ-прозы в авторском тексте ----
// По мотивам no-ai-slop (Peter Yang, MIT), переложено на русскую художественную прозу.
// Смотрим только авторский текст: реплики персонажей («— …») — их голос, там можно всё.
// Ловим осторожно: «не здесь, а в подвале» — обычная речь; штамп — нарочитое противопоставление.
const sentencesOf = (t) => String(t || '').split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
function authorText(text) {
  return String(text || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !/^[—–-]/.test(l)).join('\n')
    .replace(/«[^»]*»/g, '«…»');
}
// «Это был не страх. Это было узнавание.» / «То была не злость — то была усталость.»
const CONTRAST_PAIR = /(?<!\p{L})(это|то)\s+(был[аио]?\s+|были\s+|есть\s+)?не\s+[^.!?…—–]{1,40}([.!?…]|\s[—–])\s+(это|то)\s+(был[аио]?|были|есть)?/iu;
// «не просто взгляд — обещание», «не просто X, а Y», «не столько X, сколько Y»
const CONTRAST_SOFT = /(?<!\p{L})не\s+(просто|только|столько)\s+[^.!?…]{1,40}?(\s+[—–]\s+|,\s*(а|но|сколько)\s+)/giu;
// Рассказчик объясняет читателю, что всё значит.
const META = /(говорил[аио]?\s+больше\s+(любых\s+)?слов|больше,?\s+чем\s+(любые\s+|все\s+)?слова|красноречивее\s+(любых\s+)?слов|и\s+это\s+(было|казалось)\s+(важн|главн)|что-то\s+в\s+(его|её|ее|их|этом|этой)\s+(взгляд|голос|глаз|тон|улыбк))/iu;
// Афоризм в конце: обобщение вместо события.
const KICKER = /((больше|сильнее|громче|страшнее|правдивее|честнее|красноречивее),?\s+чем\s+(любые|любых|все|тысяч)|(в\s+этом|в\s+этой|в\s+том)\s+(и\s+)?(было|была|был|есть|заключал\p{L}*)\s+(вся|весь|всё|правда|суть|смысл|ответ)|(вся|в\s+этом\s+вся|в\s+этом\s+и\s+была)\s+(суть|правда|разница)|(всё|все)\s+только\s+начиналось|ничто\s+уже\s+не\s+будет\s+прежним|(^|[.!?…]\s+)(иногда|порой)\s+[^.!?…]{0,60}\s+(значит\s+больше|важнее|правдивее|громче\s+слов))/iu;

// «Не страх. Не злость. Что-то третье.» — перечисление отрицаний: тот же штамп, что «не X, а Y».
const NEG_LIST = /(^|[.!?…]\s+)Не\s+[^.!?…]{1,30}[.!?…]\s+Не\s+[^.!?…]{1,30}[.!?…]/u;
// «Пустой хвост»: деепричастие в конце фразы, которое приписывает сцене эффект, а не действие.
const TAIL = /,\s+(заставля[яв]\p{L}*\s+(?:\p{L}+\s+)?(сердц|кров|кож|дыхан|тебя|его|её|ее|вас)|наполня[яв]\p{L}*\s+(воздух|комнат|зал|помещен|простран|всё|все)|подч[её]ркива[яв]|напомина[яв]\p{L}*\s+о(\s|б)|придава[яв]\p{L}*\s+\p{L}+\s+(вид|оттенок|выражен)|созда[вя]\p{L}*\s+(ощущен|впечатлен|атмосфер)|окутыва[яв])/giu;
// Рубленые обрубки: три предложения подряд не длиннее двух слов.
const wordCount = (s) => (String(s).match(/\p{L}+/gu) || []).length;
function fragmentRun(text) {
  let run = 0;
  for (const s of sentencesOf(text)) {
    const n = wordCount(s);
    if (n >= 1 && n <= 2) { run++; if (run >= 3) return true; } else if (n > 0) run = 0;
  }
  return false;
}

// Заезженные обороты ролевой прозы — список правит игрок в настройках. Совпадение — по основам слов
// в пределах одной фразы, в любом порядке: «мурашки пробежали по спине» = «по спине пробежали мурашки».
export const DEFAULT_CLICHE_PHRASES = [
  'по спине пробежали мурашки', 'сердце пропустило удар', 'время словно остановилось', 'воздух сгустился',
  'воздух наэлектризован', 'бархатный голос', 'хищная улыбка', 'глаза потемнели', 'мир сузился до',
  'тишина стала осязаемой', 'что-то первобытное', 'едва слышный шёпот',
];
export function normalizeCliches(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : null;
  if (!list) return null;
  const seen = new Set();
  return list.map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter((x) => x.length >= 3 && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, 60);
}
const flatWords = (t) => (String(t || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}-]+/gu) || []);
const stemOf = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w);
function listedPhrases(text, phrases) {
  const sents = sentencesOf(text).map(flatWords);
  return (phrases || []).filter((p) => {
    // Короткие слова («по», «до») — точно; остальные — по основе, чтобы совпадали падежи и формы.
    const need = flatWords(p).map((w) => ({ stem: stemOf(w), exact: w.length <= 3 }));
    return need.length && sents.some((words) => need.every((n) => words.some((w) => (n.exact ? w === n.stem : w.startsWith(n.stem)))));
  });
}

// Реплики персонажей: строки через тире и цитаты в «».
function speechText(text) {
  const t = String(text || '');
  const dash = t.split('\n').map((l) => l.trim()).filter((l) => /^[—–-]/.test(l));
  const quotes = t.match(/«[^»]*»/g) || [];
  return [...dash, ...quotes.map((q) => q.slice(1, -1))].join('\n');
}
const contrastPairs = (t) => sentencesOf(t).reduce((n, s, i, all) => n + (CONTRAST_PAIR.test(s + ' ' + (all[i + 1] || '')) ? 1 : 0), 0);
const contrastSoft = (t) => (String(t).match(CONTRAST_SOFT) || []).length;

// prev — прошлые ответы рассказчика: в репликах одна такая фигура — манера персонажа,
// а когда так говорят все и из ответа в ответ — штамп модели.
export function findClicheIssues(narration, prev = [], { phrases = [] } = {}) {
  const issues = [];
  const listed = listedPhrases(narration, phrases);
  if (listed.length) {
    issues.push({
      kind: 'cliche-list',
      text: `Заезженные обороты из списка игрока: ${listed.slice(0, 5).map((p) => `«${p}»`).join(', ')}. Замени деталью именно этой сцены; на другой оборот из той же обоймы не меняй.`,
    });
  }
  const speechCount = [...prev.slice(-2), narration].reduce((n, t) => { const sp = speechText(t); return n + contrastPairs(sp) + contrastSoft(sp); }, 0);
  const nowSpeech = speechText(narration);
  if (speechCount >= 2 && (contrastPairs(nowSpeech) + contrastSoft(nowSpeech)) >= 1) {
    issues.push({
      kind: 'cliche-speech',
      text: 'Персонажи раз за разом говорят «не X, а Y» («Это не страх, это злость») — так у всех одинаково. Оставь эту фигуру разве что одному, если она в его манере; остальные говорят прямо, своими словами.',
    });
  }
  const text = authorText(narration);
  if (!text) return issues;
  const pairs = contrastPairs(text);
  const soft = contrastSoft(text);
  if (pairs >= 1 || soft >= 2 || NEG_LIST.test(text)) {
    issues.push({
      kind: 'cliche-contrast',
      text: 'Штамп «не X, а Y» («Это был не страх. Это было узнавание», «не просто взгляд — обещание», «Не страх. Не злость. Что-то третье»). Говори сразу Y, без противопоставления.',
    });
  }
  if (fragmentRun(text)) {
    issues.push({
      kind: 'cliche-fragments',
      text: 'Рубленые обрубки подряд («Тишина. Долгая. Тяжёлая.»). Собери в одно нормальное предложение с деталью этой сцены.',
    });
  }
  if ((text.match(TAIL) || []).length >= 2) {
    issues.push({
      kind: 'cliche-tail',
      text: 'Фразы заканчиваются «пустым хвостом» («…, заставляя сердце биться чаще», «…, наполняя воздух ароматом»). Убери хвост или скажи отдельной фразой, что именно произошло.',
    });
  }
  const meta = text.match(META);
  if (meta) {
    issues.push({
      kind: 'cliche-meta',
      text: `Рассказчик объясняет, что всё значит («${meta[0]}»). Покажи деталью — жестом, словом, поступком, — а вывод оставь игроку.`,
    });
  }
  const tail = sentencesOf(text).slice(-2).join(' ');
  if (KICKER.test(tail)) {
    issues.push({
      kind: 'cliche-kicker',
      text: 'Ответ закончился афоризмом вместо события. Не переписывай его красивее — убирай и заканчивай последним конкретным действием или деталью.',
    });
  }
  return issues;
}
