// Определения инструментов (OpenAI-совместимый формат для OpenRouter)
// и их исполнители. Блоки принадлежат конкретному герою.

import { randomUUID } from 'node:crypto';
import { normalizeScene, advanceClock, parseTimeHint, clockLabel, dayPart } from './scene.js';
import { findSimilar, EVENT_TYPES, OUTCOMES, typeLabel, outcomeLabel } from './chronicle.js';
import { matchAbility, COMPETENCE } from './skills.js';
import { addXp, nextLevel, LEVELS } from './progress.js';

// Инструмент проверки доступен ТОЛЬКО в проходе рассказа: модель запрашивает
// бросок, исход считает код. Он намеренно не входит в TOOL_DEFINITIONS.
export const ROLL_TOOL = {
  type: 'function',
  function: {
    name: 'roll_check',
    description:
      'Запросить проверку, когда исход действия героя не предрешён: скрытность, взлом, убеждение, драка, ' +
      'бег наперегонки. Вызывай ДО описания результата — исход определит бросок, а не ты. ' +
      'Для действий с очевидным исходом проверка не нужна.',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Что проверяем: название умения героя или навык по смыслу ("Скрытность", "Убеждение").' },
        difficulty: { type: 'string', enum: ['легко', 'обычно', 'сложно', 'очень сложно'], description: 'Насколько это трудно в данных обстоятельствах.' },
        character: { type: 'string', description: 'Имя героя. Без него — активный.' },
        target: { type: 'string', description: 'Имя НПС, против которого проверка (убеждение, обман, запугивание, бой). Его черты и умелость повлияют на исход.' },
      },
      required: ['skill', 'difficulty'],
    },
  },
};

export const BLOCK_TYPES = ['status', 'item', 'stat', 'relationship', 'ability'];

const typeEnum = {
  type: 'string',
  enum: BLOCK_TYPES,
  description:
    'status — состояние, item — предмет, stat — показатель (value+max), ' +
    'ability — умение (value = уровень), relationship — отношения с группой.',
};

const characterParam = { type: 'string', description: 'Имя героя. Без него — активный.' };

// Явный ответ «записывать нечего»: при обязательном вызове инструментов модель
// не может молча пропустить ход — либо изменения, либо осознанное nothing.
export const NOTHING_TOOL = {
  type: 'function',
  function: {
    name: 'nothing',
    description: 'Вызови, если в этом фрагменте ничего не изменилось и записывать нечего.',
    parameters: { type: 'object', properties: {} },
  },
};

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'block',
      description:
        'Лист героя: предмет, состояние, показатель, умение, отношения с группой. ' +
        'Ищется по типу и названию: есть — обновится, нет — заведётся. action "remove" — убрать.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'remove'], description: 'По умолчанию set.' },
          type: typeEnum,
          name: { type: 'string', description: 'Короткое название: "Здоровье", "Ржавый меч", "Отравлен".' },
          value: { type: 'string', description: 'Значение; у stat — число.' },
          max: { type: 'number', description: 'Максимум для stat.' },
          description: { type: 'string', description: 'Пояснение, если нужно.' },
          character: characterParam,
        },
        required: ['type', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'npc',
      description:
        'Персонаж мира (не герой игрока). Ищется по имени: есть — обновится, нет — заведётся. ' +
        'Передавай только то, что изменилось или впервые прозвучало. action "archive" — ушёл из истории насовсем (карточка сохранится).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'archive'], description: 'По умолчанию set.' },
          name: { type: 'string', description: 'Имя или прозвище.' },
          new_name: { type: 'string', description: 'Настоящее имя, если персонаж был записан по описанию.' },
          description: { type: 'string', description: 'Кто он: роль, происхождение — постоянное. Целиком.' },
          appearance: { type: 'string', description: 'Внешность целиком.' },
          personality: { type: 'string', description: 'Характер целиком.' },
          traits: { type: 'array', items: { type: 'string' }, description: 'Ярлыки из списка черт, список целиком.' },
          attitude: { type: 'string', description: 'Отношение к герою сейчас.' },
          status: { type: 'string', description: 'Где он и в каком состоянии сейчас.' },
          history: { type: 'string', description: 'Что произошло с героем — одна строка, дописывается.' },
          wants: { type: 'string', description: 'Чего хочет сейчас.' },
          quirk: { type: 'string', description: 'Изюминка.' },
          secret: { type: 'string', description: 'Что скрывает; "" — тайна раскрылась.' },
          links: { type: 'string', description: 'Связи с другими НПС, целиком.' },
          voice_style: { type: 'string', description: 'Манера речи.' },
          voice_humor: { type: 'string', description: 'Тип юмора.' },
          voice_habits: { type: 'string', description: 'Обращения, словечки.' },
          voice_sample: { type: 'string', description: 'Одна характерная реплика дословно.' },
          voice_masks: { type: 'string', description: 'Как прячет чувства.' },
          voice_taboos: { type: 'string', description: 'Чего в речи не делает.' },
          competence: { type: 'string', enum: COMPETENCE, description: 'Насколько хорош в своём деле (только у значимых, у кого есть ремесло).' },
          skills: { type: 'array', items: { type: 'string' }, description: '1–3 ключевых умения: «следствие», «фехтование», «стража». Список целиком.' },
          mood: { type: 'string', description: 'Настроение сейчас.' },
          mood_reason: { type: 'string', description: 'Почему такое настроение.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_lore',
      description:
        'Записать важные сведения о мире (порядки, законы, события прошлого, цены). ' +
        'Не атмосферу и не разовые детали сцены. Такое же название — дополнится.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Короткое название, напр. "Порядки в приюте".' },
          content: { type: 'string', description: 'Сами сведения, кратко и точно.' },
          keys: { type: 'string', description: 'Слова через запятую для поиска.' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'thread',
      description:
        'Сюжетная нить — цель, загадка или конфликт, который тянется через сцены. ' +
        'open — завести, когда появилась; update — продвинулась (progress) или новое узнано (notes); ' +
        'done/failed — закрыть. По названию; такое же название — та же нить.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['open', 'update', 'done', 'failed'] },
          title: { type: 'string', description: 'Короткое название: "Найти сестру", "Долг гильдии", "Что скрывает Марта".' },
          progress: { type: 'string', description: 'Где сейчас, одной фразой: "узнал, что она в северном блоке".' },
          notes: { type: 'string', description: 'Что известно, зацепки. Дописывается.' },
        },
        required: ['action', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'event',
      description:
        'Хроника — установленные факты, которые нельзя потерять: обещание, долг, назначенная встреча или срок (plan), ' +
        'ложь (кто кому что соврал), раскрытая тайна, важное решение, смерть, факт о прошлом, перелом в отношениях. ' +
        'Одна запись — один факт, одной фразой, с именами. Не для мелочей и не для целей (цели — thread). ' +
        'close — запись больше не в силе: обещание исполнено или нарушено, долг отдан, встреча состоялась или сорвалась, факт устарел. ' +
        'update — та же запись изменилась (встречу перенесли). Для close/update укажи id (#номер из хроники).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'close', 'update'], description: 'add — записать; close — больше не в силе; update — поправить текст/срок.' },
          id: { type: 'string', description: 'Для close/update: номер записи из хроники, например "#4".' },
          type: { type: 'string', enum: EVENT_TYPES },
          text: { type: 'string', description: 'add: факт одной фразой ("Альберт обещал Роланду вернуть меч до зимы"). update: новый текст. close: можно не указывать, если есть id.' },
          when: { type: 'string', description: 'Для plan/обещаний со сроком: когда, словами по часам истории ("в полдень", "завтра вечером", "через 2 часа", "18:00").' },
          outcome: { type: 'string', enum: OUTCOMES, description: 'Для close: done — исполнено/состоялось, broken — нарушено/сорвано, past — прошло само или отменено.' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Кто участвует (имена героя и НПС).' },
          known_by: { type: 'array', items: { type: 'string' }, description: 'Кто об этом ЗНАЕТ. Важно для лжи и тайн: если соврали герою — герой НЕ знает правды. По умолчанию — участники.' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene',
      description:
        'Обновить сцену: где герой, сколько времени прошло, кто рядом. Вызывай, когда герой сменил место, ' +
        'прошло заметное время, кто-то пришёл или ушёл. Передавай только то, что изменилось.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Где герой сейчас, коротко: "Таверна «Кривой якорь», зал".' },
          elapsed_minutes: { type: 'integer', description: 'Сколько игровых минут прошло за этот ход (разговор ~10, дорога через город ~60, ночь сна ~480).' },
          time: { type: 'string', description: 'Только если время задано в тексте явно: "21:30", "рассвет". Иначе не передавай — часы считает код.' },
          present: { type: 'array', items: { type: 'string' }, description: 'ПОЛНЫЙ список, кто сейчас ФИЗИЧЕСКИ рядом с героем (имена НПС). Пустой массив — никого. Спутников и голоса в голове, помеченных «всегда с героем», не перечисляй.' },
          note: { type: 'string', description: 'Обстановка одной фразой: погода, шум, опасность, что происходит вокруг.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'practice',
      description:
        'Опыт умению героя за обучение: тренировался, упражнялся, учился у наставника, долго практиковал ремесло. ' +
        'Только для умения, которое уже есть в листе. Применение умения в деле — не практика (опыт за это даёт бросок).',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Умение из листа героя.' },
          kind: { type: 'string', enum: ['practice', 'lesson'], description: 'practice — сам (+1), lesson — у наставника или учителя (+2).' },
          reason: { type: 'string', description: 'Что делал, одной фразой.' },
          character: characterParam,
        },
        required: ['skill', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_hero',
      description:
        'Внешность или положение героя игрока — только когда они в тексте ИЗМЕНИЛИСЬ надолго (шрам, стрижка, превращение, новый титул). ' +
        'Деталь изменилась или добавилась — appearance_change, код допишет её к прежнему. ' +
        'Облик изменился почти целиком — appearance: ПОЛНОЕ новое описание на основе прежнего (оно есть в данных).',
      parameters: {
        type: 'object',
        properties: {
          character: { type: 'string', description: 'Имя героя. Без него берётся активный.' },
          appearance_change: { type: 'string', description: 'Что изменилось или добавилось — одна-две фразы: "на щеке свежий шрам".' },
          appearance: { type: 'string', description: 'Полное новое описание внешности (заменяет прежнее целиком).' },
          social: { type: 'string', description: 'Общественное положение.' },
        },
      },
    },
  },
];

export function resolveCharacterFor(state, name) {
  return resolveCharacter(state, name);
}

function resolveCharacter(state, name) {
  if (name && String(name).trim()) {
    const n = String(name).trim().toLowerCase();
    const found = state.characters.find((c) => c.name.trim().toLowerCase() === n);
    if (found) return found;
  }
  return state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
}

// Одно и то же название в другом падеже: «Здоровья» = «Здоровье», «Барона» = «Барон».
// Короткие слова (до 5 букв) сравниваем только точно: «Дорн» и «Дора» — разные.
function sameWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= Math.max(a.length, b.length) - 2 && p >= Math.min(a.length, b.length) - 1;
}
// Запись «по описанию»: после первого слова идут строчные — «Девочка с хвостиком»,
// «Человек в сером». «Барон Кейн» — это имя, а не описание.
export function isDescriptiveName(name) {
  const w = String(name || '').trim().split(/\s+/);
  return w.length >= 2 && w.slice(1).some((x) => /^[a-zа-яё]/.test(x));
}

// Безымянный: записан по описанию («Девушка в красном плаще») или по роли
// одним словом («Незнакомец», «Стражник», «Торговка»). Когда прозвучит имя,
// такую запись надо переименовать, а не заводить нового человека.
const ROLE_WORDS = new Set(('незнакомец незнакомка некто старик старуха старец девушка девочка девица мальчик мальчишка паренёк парень юноша ' +
  'мужчина женщина стражник страж часовой солдат наёмник наёмница торговец торговка купец купчиха трактирщик трактирщица корчмарь ' +
  'хозяин хозяйка служанка слуга лакей кузнец лекарь знахарь знахарка охотник рыбак нищий нищенка бродяга путник путница странник ' +
  'странница воин рыцарь монах монахиня жрец жрица ведьма колдун колдунья маг вор воровка разбойник бандит вдова кормилица шут конюх ' +
  'кучер гонец посыльный матрос моряк капрал сержант офицер чиновник писарь крестьянин крестьянка фермер пастух охранник громила ' +
  'человек тень голос фигура силуэт ребёнок подросток дед бабка тётка дядька хромой слепой горбун толстяк здоровяк коротышка').split(' '));
export function isUnnamedName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (isDescriptiveName(n)) return true;
  const w = n.split(/\s+/);
  return w.length === 1 && ROLE_WORDS.has(w[0].toLowerCase().replace(/е(?=нок$)/, 'ё'));
}

// Насколько описание нового персонажа совпадает с безымянной записью:
// общие значимые основы слов во внешности и описании.
function lookStems(t) {
  const STOP = /^(котор|очень|этот|этого|него|неё|него|свои|своё|своей|своим|будто|почти|лишь|только|когда|потом|снова|чтобы|вокруг|между|около|через)/;
  return [...new Set(String(t || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.test(w)).map((w) => w.slice(0, 5)))];
}
function lookOverlap(a, b) {
  const sa = lookStems(a); const sb = new Set(lookStems(b));
  return sa.filter((w) => sb.has(w));
}

export function sameName(a, b) {
  const wa = String(a).trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  const wb = String(b).trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  return wa.length > 0 && wa.length === wb.length && wa.every((w, i) => sameWord(w, wb[i]));
}

function findIndex(blocks, type, name) {
  const n = String(name).trim().toLowerCase();
  const exact = blocks.findIndex((b) => b.type === type && b.name.trim().toLowerCase() === n);
  if (exact !== -1) return exact;
  return blocks.findIndex((b) => b.type === type && sameName(b.name, name));
}

// «Отравление» → каталожное «Отравлен»: тогда сработают эффекты статуса.
// Только для однословных названий — «Проклятие ведьмы» оставляем как есть.
function catalogStatusName(state, name) {
  const n = String(name).trim();
  if (/\s/.test(n)) return null;
  const low = n.toLowerCase();
  for (const d of state.statusCatalog || []) {
    const c = String(d.name || '').toLowerCase();
    if (!c || c === low || /\s/.test(c)) continue;
    const stem = c.length > 5 ? c.slice(0, c.length - 2) : c.length > 3 ? c.slice(0, c.length - 1) : c;
    const stem2 = low.length > 5 ? low.slice(0, low.length - 2) : low.length > 3 ? low.slice(0, low.length - 1) : low;
    if (stem.length >= 4 && (low.startsWith(stem) || c.startsWith(stem2))) return d.name;
  }
  return null;
}

function coerceNumber(value) {
  if (value == null) return undefined;
  const num = Number(String(value).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(num) ? num : undefined;
}

const LORE_TOOLS = ['record_lore'];
const THREAD_TOOLS = ['thread'];

// Нити ищем не по точному названию, а по смыслу: модель легко переформулирует
// «Найти сестру» в «Поиски сестры Анны», и без этого плодились бы дубли.
// Служебные глаголы и вопросительные слова не считаются: «Найти сестру» и
// «Найти убийцу» — разные нити, хотя слово «найти» общее.
const THREAD_STOP = /^(найти|найди|узнат|выясн|спаст|добыт|верну|понят|раскр|разоб|помоч|что|кто|где|куда|почем|зачем|скрыв|тайна|тайну|дело|задан|поиск|поиски)$/;
function threadStems(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 4).map((w) => w.slice(0, 5)).filter((w) => !THREAD_STOP.test(w));
}
function findThread(threads, title) {
  const k = String(title).trim().toLowerCase();
  const exact = threads.find((x) => x.title.trim().toLowerCase() === k);
  if (exact) return exact;
  const a = threadStems(title);
  if (!a.length) return null;
  let best = null; let bestScore = 0;
  for (const t of threads) {
    const b = threadStems(t.title);
    if (!b.length) continue;
    const common = a.filter((w) => b.includes(w)).length;
    const score = common / Math.min(a.length, b.length);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 0.5 ? best : null;
}

function executeThreadTool(args, state) {
  const title = String(args?.title || '').trim();
  const action = String(args?.action || 'update');
  if (!title) return 'Ошибка: у нити нужно название.';
  if (!Array.isArray(state.threads)) state.threads = [];
  let t = findThread(state.threads, title);
  let note = '';

  if (!t) {
    if (action === 'done' || action === 'failed') return `Нити «${title}» нет — закрывать нечего.`;
    t = { id: randomUUID(), title, status: 'open', progress: '', notes: '', openedTurn: state.turn || 0 };
    state.threads.push(t);
  } else if (t.title.trim().toLowerCase() !== title.toLowerCase()) {
    note = action === 'done' || action === 'failed' ? ` (по названию «${title}»)` : ` (совпала с существующей «${t.title}» — дубль не создан)`;
  }
  if (args.progress !== undefined && String(args.progress).trim()) t.progress = String(args.progress).trim();
  if (args.notes !== undefined) {
    const add = String(args.notes).trim();
    if (add && !(t.notes || '').toLowerCase().includes(add.toLowerCase())) t.notes = t.notes ? `${t.notes}; ${add}` : add;
  }
  if (action === 'done' || action === 'failed') {
    t.status = action;
    return `Нить «${t.title}» ${action === 'done' ? 'закрыта' : 'провалена'}${note}.`;
  }
  if (t.status !== 'open') {
    if (action === 'open') { t.status = 'open'; note += ' (открыта заново)'; }
    else return `Нить «${t.title}» уже закрыта (${t.status}); заметки дописаны, статус не менялся. Чтобы возобновить — action open${note}.`;
  }
  return `Нить «${t.title}»${t.progress ? ': ' + t.progress : ''}${note}.`;
}
const SPACE_RE = /\s+/;
const HERO_TOOLS = ['update_hero'];
const SCENE_TOOLS = ['scene'];
const EVENT_TOOLS = ['event'];

// Номер из хроники («#4», «4», «запись 4») — позиция; иначе настоящий id записи.
function findEventById(events, id) {
  const raw = String(id || '').trim();
  const byId = events.find((e) => e.id === raw);
  if (byId) return byId;
  const m = raw.match(/^(?:#|№|запись\s*)?\s*(\d+)$/i);
  return m ? events[Number(m[1]) - 1] || null : null;
}

function executeEventTool(args, state) {
  if (!Array.isArray(state.events)) state.events = [];
  const a = args || {};
  const text = String(a.text || '').trim();
  const when = String(a.when || '').trim();
  const action = ['close', 'update'].includes(a.action) ? a.action : 'add';
  if (action !== 'add') {
    let target = null;
    if (a.id !== undefined && a.id !== null && String(a.id).trim()) {
      target = findEventById(state.events, a.id);
      if (!target) return `Ошибка: записи ${a.id} в хронике не найдено — сверь номер.`;
    } else if (text) target = findSimilar(state.events, text);
    if (!target) return text ? 'Похожей записи нет — закрывать нечего. Укажи id (#номер из хроники).' : 'Ошибка: укажи id записи (#номер из хроники).';
    if (target.locked) return `Запись «${target.text}» закреплена игроком — не меняю.`;
    // update с исходом — модели так закрывают запись («встреча сорвалась»): закрываем,
    // заодно принимая новый текст. Раньше исход молча терялся и запись висела открытой.
    if (action === 'update' && OUTCOMES.includes(a.outcome)) {
      if (text) target.text = text;
      if (when) target.when = when;
    }
    if (action === 'close' || (action === 'update' && OUTCOMES.includes(a.outcome))) {
      if (target.status === 'done' && action === 'close') return `Уже закрыто: «${target.text}».`;
      target.status = 'done';
      target.outcome = OUTCOMES.includes(a.outcome) ? a.outcome : 'done';
      return `Закрыто (${outcomeLabel(target.outcome)}): «${target.text}».`;
    }
    if (text) target.text = text;
    if (when) target.when = when;
    if (when && state.scene) target.at = { day: state.scene.day, minute: state.scene.minute };
    if (EVENT_TYPES.includes(a.type)) target.type = a.type;
    if (a.outcome === undefined && target.status === 'done' && (text || when)) { target.status = 'open'; target.outcome = ''; }
    return `Поправлено: «${target.text}»${target.when ? ` (когда: ${target.when})` : ''}.`;
  }
  if (!text) return 'Ошибка: у записи нужен текст.';
  const similar = findSimilar(state.events, text);
  if (similar) {
    if (similar.locked) return `Уже есть (закреплено): «${similar.text}».`;
    // Уточнение того же факта: обновляем участников и знание, текст не трогаем.
    const addNames = (arr, more) => { for (const n of more || []) { const k = String(n).trim(); if (k && !arr.some((x) => x.toLowerCase() === k.toLowerCase())) arr.push(k); } };
    addNames(similar.participants, a.participants);
    addNames(similar.knownBy, a.known_by);
    if (when && !similar.when) { similar.when = when; if (state.scene) similar.at = { day: state.scene.day, minute: state.scene.minute }; }
    return `Уже записано: «${similar.text}» — дубль не создан.`;
  }
  const participants = Array.isArray(a.participants) ? a.participants.map((x) => String(x).trim()).filter(Boolean) : [];
  // По умолчанию знают участники и активный герой: повествование идёт от его лица, он обычно свидетель.
  const hero = resolveCharacter(state, a.character);
  const knownBy = Array.isArray(a.known_by) && a.known_by.length
    ? a.known_by.map((x) => String(x).trim()).filter(Boolean)
    : [...new Set([...participants, ...(hero ? [hero.name] : [])])];
  const type = EVENT_TYPES.includes(a.type) ? a.type : 'fact';
  const sc = state.scene;
  state.events.push({
    id: randomUUID(), turn: state.turn || 0, type,
    text, participants, knownBy, status: 'open', outcome: '', locked: false,
    when, at: sc && Number.isFinite(sc.day) ? { day: sc.day, minute: sc.minute } : null,
  });
  return `В хронику #${state.events.length}: [${typeLabel(type)}] ${text}${when ? ` (когда: ${when})` : ''}.`;
}

// Перевести часы на названное время. Время идёт только вперёд: «утро», сказанное
// вечером, — это следующее утро. Но «вечер», сказанный вечером, — тот же вечер
// (часы не трогаем), а явные часы чуть раньше текущих — поправка, не новые сутки.
function moveClockTo(s, hint) {
  if (hint.minute >= s.minute) { s.minute = hint.minute; return; }
  if (!hint.exact && dayPart(hint.minute) === dayPart(s.minute)) return;
  if (hint.exact && s.minute - hint.minute <= 90) { s.minute = hint.minute; return; }
  s.day += 1;
  s.minute = hint.minute;
}

// Модель иногда переписывает в место нашу же заглушку «(место не записано)».
const PLACEHOLDER_PLACE = /^[(\[]?\s*(место\s+)?(не\s+(записано|указано|известно|названо)|неизвестно|неясно|нет|—|-|\?|unknown|n\/a)\s*[)\]]?\.?$/i;

function executeSceneTool(args, state) {
  const s = state.scene = normalizeScene(state.scene);
  const locked = s.locked || [];
  const changed = [];
  const skipped = [];
  const a = args || {};
  if (typeof a.location === 'string' && a.location.trim() && !PLACEHOLDER_PLACE.test(a.location.trim())) {
    if (locked.includes('location')) skipped.push('место'); else { s.location = a.location.trim(); changed.push('место'); }
  }
  const el = Number(a.elapsed_minutes);
  if (Number.isFinite(el) && el > 0) {
    if (locked.includes('clock')) skipped.push('время');
    else { advanceClock(s, el); s.time = ''; changed.push(`+${Math.round(el)} мин`); } // словесная метка устарела
  }
  if (typeof a.time === 'string' && a.time.trim()) {
    if (locked.includes('clock') || locked.includes('time')) skipped.push('время');
    else {
      const hint = parseTimeHint(a.time);
      if (hint) moveClockTo(s, hint);
      s.time = a.time.trim();
      changed.push('время');
    }
  }
  if (Array.isArray(a.present)) {
    if (locked.includes('present')) skipped.push('присутствующие');
    else { s.present = a.present.map((x) => String(x).trim()).filter(Boolean); changed.push('рядом'); }
  }
  if (typeof a.note === 'string') {
    if (locked.includes('note')) skipped.push('обстановка'); else { s.note = a.note.trim(); changed.push('обстановка'); }
  }
  let out = `Сцена: ${s.location || '—'}; ${clockLabel(s)}; рядом: ${s.present.length ? s.present.join(', ') : 'никого'}.`;
  if (Array.isArray(a.present)) {
    const known = [...(state.npcs || []).map((n) => n.name), ...(state.characters || []).map((c) => c.name)];
    const unknown = s.present.filter((p) => !known.some((k) => k.toLowerCase() === p.toLowerCase() || sameName(k, p) || k.toLowerCase().split(/\s+/)[0] === p.toLowerCase().split(/\s+/)[0]));
    if (unknown.length) out += ` Нет среди НПС: ${unknown.join(', ')} — значимых заведи через npc, массовку в present не держи.`;
  }
  if (skipped.length) out += ` Закреплено игроком, не изменено: ${skipped.join(', ')}.`;
  return out;
}

// Сколько значимых слов прежнего описания сохранилось в новом (по основам).
function keptShare(oldText, newText) {
  const stems = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
  const a = [...new Set(stems(oldText))];
  if (!a.length) return 1;
  const b = new Set(stems(newText));
  return a.filter((w) => b.has(w)).length / a.length;
}

// Опыт за обучение. Раз в игровой день на умение — иначе «тренируюсь» каждый ход
// разгоняло бы уровень за пару минут игры.
function executePracticeTool(args, state) {
  const a = args || {};
  const skill = String(a.skill || '').trim();
  if (!skill) return 'Ошибка: укажи skill — умение из листа героя.';
  const c = resolveCharacter(state, a.character);
  const block = matchAbility(c.blocks, skill);
  if (!block) {
    const have = (c.blocks || []).filter((b) => b.type === 'ability').map((b) => b.name);
    return `Ошибка: у героя «${c.name}» нет умения «${skill}».` + (have.length ? ` Есть: ${have.join(', ')}.` : '') +
      ' Если он начал учиться новому — заведи его: block type:ability value:новичок.';
  }
  if (block.locked) return `Умение «${block.name}» закреплено игроком — опыт не начисляется.`;
  if (LEVELS.indexOf(String(block.value || '').trim().toLowerCase()) === LEVELS.length - 1) return `«${block.name}»: герой уже мастер — расти некуда.`;
  const day = (state.scene && state.scene.day) || 1;
  if (!c.practiceDays || typeof c.practiceDays !== 'object') c.practiceDays = {};
  const k = block.name.trim().toLowerCase();
  if (c.practiceDays[k] === day) return `Тренировка «${block.name}» уже засчитана сегодня (день ${day}) — опыт не добавлен. Следующая — завтра по часам истории.`;
  const lesson = a.kind === 'lesson';
  const gain = lesson ? 2 : 1;
  c.practiceDays[k] = day;
  const { xp, grew } = addXp(c, block, gain, lesson ? 'урок' : 'тренировка');
  if (grew) (state._growth ||= []).push(grew);
  const next = nextLevel(block, xp);
  return `«${block.name}»: +${gain} опыта (${lesson ? 'урок' : 'тренировка'})` +
    (grew ? ` — ${grew.replace(/^[^:]*: «[^»]*» выросло — /, '').replace(/ \(.*\)$/, '')}` : '') +
    (next ? `; до «${next.level}»: ${next.xp} из ${next.need}.` : '.');
}

function executeHeroTool(args, state) {
  const { character, appearance, appearance_change: change, social } = args || {};
  const c = resolveCharacter(state, character);
  const locked = Array.isArray(c.locked) ? c.locked : [];
  const changed = [];
  const notes = [];
  const prevLook = (c.appearance || '').trim();
  const setLook = (text) => {
    if (prevLook) c.appearancePrev = prevLook; // для кнопки «вернуть прежнюю»
    c.appearance = text;
    delete c.portraitTags; // старые теги портрета больше не описывают героя
    changed.push('внешность');
  };

  if ((typeof appearance === 'string' && appearance.trim()) || (typeof change === 'string' && change.trim())) {
    if (locked.includes('appearance')) {
      notes.push('внешность закреплена игроком — не изменена');
    } else if (typeof appearance === 'string' && appearance.trim() && appearance.trim() !== prevLook) {
      const next = appearance.trim();
      // Полная замена, которая теряет большую часть прежнего описания, — почти
      // всегда ошибка: модель записала одну увиденную деталь вместо облика целиком.
      if (prevLook.length >= 60 && next.length < prevLook.length * 0.6 && keptShare(prevLook, next) < 0.35) {
        return `ВНИМАНИЕ: новое описание внешности «${c.name}» короче прежнего и теряет почти всё. Не записано. ` +
          `Прежнее: «${prevLook}». Если изменилась деталь — передай её в appearance_change; ` +
          'если облик правда сменился целиком — передай appearance ПОЛНОСТЬЮ: рост, сложение, волосы, лицо, одежда, приметы.';
      }
      setLook(next);
    } else if (typeof change === 'string' && change.trim()) {
      const add = change.trim().replace(/\s+/g, ' ');
      if (prevLook.toLowerCase().includes(add.toLowerCase())) notes.push('эта деталь уже есть во внешности');
      else setLook(prevLook ? prevLook.replace(/[\s.;,]*$/, '') + '. ' + add.replace(/^./, (x) => x.toUpperCase()).replace(/[.]*$/, '.') : add);
    }
  }
  if (typeof social === 'string' && social.trim() && social.trim() !== (c.social || '')) {
    if (locked.includes('social')) notes.push('положение закреплено игроком — не изменено');
    else { c.social = social.trim(); changed.push('положение'); }
  }
  if (!changed.length) return notes.length ? `У героя «${c.name}»: ${notes.join('; ')}.` : 'Нечего обновлять у героя.';
  return `У героя «${c.name}» обновлено: ${changed.join(', ')}.` + (notes.length ? ` (${notes.join('; ')})` : '');
}

function executeLoreTool(args, state) {
  if (state.loreAutoWrite !== true) {
    return 'Дописывать справочник мира нельзя: игрок ведёт его сам. Сведения о людях записывай через npc.';
  }
  const title = String(args?.title || '').trim();
  const content = String(args?.content || '').trim();
  if (!title || !content) return 'Ошибка: нужны название и содержание.';
  if (!Array.isArray(state.lorebook)) state.lorebook = [];

  const keys = String(args?.keys || '').split(',').map((k) => k.trim()).filter(Boolean);
  const idx = state.lorebook.findIndex((e) => e.title.trim().toLowerCase() === title.toLowerCase());

  if (idx === -1) {
    state.lorebook.push({
      id: randomUUID(), title, content,
      keys: keys.length ? keys : [title.split(SPACE_RE)[0]],
      always: false, enabled: true, locked: false, author: 'narrator',
    });
    return 'Записано о мире: ' + title + '.';
  }
  const e = state.lorebook[idx];
  if (e.locked || e.author === 'player') return 'Запись «' + title + '» ведёт игрок, она не изменена.';
  e.content = e.content && !content.includes(e.content) ? e.content + '; ' + content : content;
  for (const k of keys) if (!e.keys.includes(k)) e.keys.push(k);
  return 'Дополнено о мире: ' + title + '.';
}

const NPC_TOOLS = ['create_npc', 'update_npc', 'remove_npc'];

// Принимаем только ярлыки, реально существующие в пуле игрока.
function validTraits(state, list) {
  const pool = (state.traitPool || []).map((t) => t.label.toLowerCase());
  const out = [];
  for (const raw of list) {
    const label = String(raw).trim();
    const i = pool.indexOf(label.toLowerCase());
    if (i !== -1 && !out.includes(state.traitPool[i].label)) out.push(state.traitPool[i].label);
  }
  return out.slice(0, 5);
}

// Падежное окончание у короткого имени: «Лиру» = «Лира», «Дорну» = «Дорн». Только если совпадение одно —
// «Дорн» и «Дора» сюда не попадут: у них разные основы.
const caseStem = (w) => w.toLowerCase().replace(/(ой|ей|ою|ею|ом|ем|ам|ям|ах|ях|а|у|е|ы|и|ю|я|о)$/, '');
function findNpc(state, name) {
  const n = String(name).trim().toLowerCase();
  const exact = state.npcs.findIndex((x) => x.name.trim().toLowerCase() === n);
  if (exact !== -1) return exact;
  const fuzzy = state.npcs.findIndex((x) => sameName(x.name, name));
  if (fuzzy !== -1) return fuzzy;
  const words = n.split(/\s+/);
  if (words.length !== 1 || words[0].length < 3) return -1;
  const st = caseStem(words[0]);
  if (st.length < 3 || st === words[0]) return -1; // окончания нет — это не падежная форма, а другое имя
  const hits = state.npcs.map((x, i) => [x, i]).filter(([x]) => { const w = x.name.trim().split(/\s+/); return w.length === 1 && caseStem(w[0]) === st; });
  return hits.length === 1 ? hits[0][1] : -1;
}

function executeNpcTool(name, args, state) {
  const { name: npcName, new_name: newName, description, appearance, personality, attitude, status, history, traits, wants, secret, quirk, links,
    voice_style, voice_humor, voice_habits, voice_sample, voice_masks, voice_taboos, mood, mood_reason, competence, skills } = args || {};
  // Умелость — только из списка; умения — до трёх коротких строк.
  const level = typeof competence === 'string' && COMPETENCE.includes(competence.trim().toLowerCase()) ? competence.trim().toLowerCase() : undefined;
  const skillList = Array.isArray(skills) ? skills.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
    : typeof skills === 'string' && skills.trim() ? skills.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 3) : undefined;
  const VOICE_MAP = { voiceStyle: voice_style, voiceHumor: voice_humor, voiceHabits: voice_habits, voiceMasks: voice_masks, voiceTaboos: voice_taboos };
  const addSample = (n, s) => {
    const line = String(s || '').trim().replace(/^[«"“\s—-]+|[»"”\s]+$/g, '');
    if (!line) return;
    if (!Array.isArray(n.voiceSamples)) n.voiceSamples = [];
    if (n.voiceSamples.some((x) => x.toLowerCase() === line.toLowerCase())) return;
    n.voiceSamples.push(line);
    if (n.voiceSamples.length > 8) n.voiceSamples.shift();
  };
  if (!npcName || !String(npcName).trim()) return 'Ошибка: не указано имя НПС.';
  if (!Array.isArray(state.npcs)) state.npcs = [];

  const idx = findNpc(state, npcName);

  if (name === 'remove_npc') {
    if (idx === -1) {
      const first = String(npcName).trim().toLowerCase().split(/\s+/)[0];
      const like = state.npcs.filter((x) => !x.archived && first.length >= 3 && x.name.toLowerCase().includes(first.slice(0, Math.max(3, first.length - 2)))).map((x) => `«${x.name}»`);
      return `НПС «${npcName}» не найден.` + (like.length ? ` Похожие: ${like.slice(0, 6).join(', ')} — укажи имя точно.` : '');
    }
    const npc = state.npcs[idx];
    if (npc.archived) return `НПС «${npc.name}» уже в архиве.`;
    // Не удаляем, а убираем в архив: персонаж может вернуться через сто ходов,
    // и его история, тайны и отношения должны уцелеть.
    npc.archived = true;
    // Ушедший насовсем не может оставаться «рядом» в сцене — иначе рассказчик продолжит его играть.
    const sc = state.scene;
    let note = '';
    if (sc && Array.isArray(sc.present) && !(sc.locked || []).includes('present')) {
      const before = sc.present.length;
      sc.present = sc.present.filter((p) => !(p.trim().toLowerCase() === npc.name.toLowerCase() || sameName(p, npc.name)));
      if (sc.present.length !== before) note = ' Убран и из списка «рядом».';
    }
    if (npc.bound) { delete npc.bound; note += ' Больше не «всегда с героем».'; }
    return `НПС «${npc.name}» убран в архив (вернётся, если снова появится в истории).${note}`;
  }
  // Персонаж из архива вернулся в историю — поднимаем.
  if (idx !== -1 && state.npcs[idx].archived) { delete state.npcs[idx].archived; }

  // Герой игрока — не НПС: его лист ведётся через block и update_hero.
  if (name !== 'remove_npc' && (state.characters || []).some((c) => sameName(c.name, npcName) || c.name.trim().toLowerCase() === String(npcName).trim().toLowerCase())) {
    return `Ошибка: «${npcName}» — герой игрока, а не НПС. Его меняют через block и update_hero. Не записано.`;
  }
  // «Дорн-караванщик» при уже известном «Дорн» — почти наверняка тот же человек.
  let nearNote = '';
  if (idx === -1) {
    const words = String(npcName).trim().toLowerCase().split(/[\s-]+/);
    // «Дорн-караванщик» при известном «Дорн».
    let near = words.length > 1 && state.npcs.find((x) => !/\s/.test(x.name.trim()) && x.name.trim().toLowerCase() === words[0]);
    // «Барона Кейна» при известном «Барон Кейн»: одно слово совпало, остальные — по началу.
    if (!near && words.length > 1) {
      const loose = (a, b) => { let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++; return p >= 3 && p >= Math.min(a.length, b.length) - 1; };
      near = state.npcs.find((x) => {
        const xw = x.name.trim().toLowerCase().split(/[\s-]+/);
        return xw.length === words.length && xw.every((w, i) => loose(w, words[i])) && xw.some((w, i) => sameWord(w, words[i]));
      });
    }
    if (near) nearNote = ` ВНИМАНИЕ: уже есть «${near.name}». Если это он — вызови npc с именем «${npcName}» и new_name «${near.name}»: записи сольются.`;
  }

  if (idx === -1 && name === 'create_npc' && !isUnnamedName(npcName)) {
    // Возможный дубль: уже есть безымянная запись («Девушка в красном плаще»),
    // а сейчас заводят того же человека под настоящим именем.
    const unnamed = state.npcs.filter((n) => !n.archived && isUnnamedName(n.name));
    const mine = [appearance, description, personality].filter(Boolean).join(' ');
    // Совпадение по внешности и описанию — сильный сигнал: предупреждаем и даём
    // второй раунд. Просто наличие безымянных — только справка, без лишнего запроса.
    const scored = unnamed
      .map((n) => ({ n, common: lookOverlap(mine + ' ' + npcName, [n.name, n.appearance, n.description, n.personality].join(' ')) }))
      .filter((x) => x.common.length >= 2)
      .sort((a, b) => b.common.length - a.common.length);
    if (scored.length) {
      const best = scored[0];
      var dupWarning = ` ВНИМАНИЕ: похоже на безымянную запись «${best.n.name}» (совпадает: ${best.common.slice(0, 5).join(', ')}…). ` +
        `Если это тот же человек — вызови npc с name «${best.n.name}» и new_name «${npcName}»: записи сольются, история сохранится.`;
    } else if (unnamed.length) {
      var dupWarning = ` Справка: без имени записаны «${unnamed.slice(-6).map((n) => n.name).join('», «')}» — если это кто-то из них, переименуй ту запись через new_name.`;
    }
  }

  if (idx === -1) {
    const npc = { id: randomUUID(), name: String(npcName).trim(), description: '', appearance: '', personality: '', attitude: '', status: '', history: '', wants: '', secret: '', quirk: '', links: '', traits: [], avatar: null };
    if (description !== undefined) npc.description = String(description);
    if (appearance !== undefined) npc.appearance = String(appearance);
    if (personality !== undefined) npc.personality = String(personality);
    if (Array.isArray(traits)) npc.traits = validTraits(state, traits);
    if (history !== undefined) npc.history = String(history);
    if (wants !== undefined) npc.wants = String(wants);
    if (secret !== undefined) npc.secret = String(secret);
    if (quirk !== undefined) npc.quirk = String(quirk);
    if (links !== undefined) npc.links = String(links);
    if (attitude !== undefined) npc.attitude = String(attitude);
    if (status !== undefined) npc.status = String(status);
    for (const [k, v] of Object.entries(VOICE_MAP)) if (v !== undefined) npc[k] = String(v);
    addSample(npc, voice_sample);
    if (mood !== undefined) { npc.mood = String(mood); npc.moodReason = String(mood_reason || ''); npc.moodTurn = state.turn || 0; }
    if (level) npc.competence = level;
    if (skillList) npc.skills = skillList;
    npc.locked = [];
    npc.updatedTurn = state.turn || 0;
    state.npcs.push(npc);
    return `Занесён НПС «${npc.name}»${npc.attitude ? ` (${npc.attitude})` : ''}.` +
      (typeof dupWarning === 'string' ? dupWarning : '') + nearNote;
  }

  let npc = state.npcs[idx];
  let mergedNote = '';
  // Переименование: персонаж был записан по описанию, теперь известно имя.
  const nameLocked = (npc.locked || []).includes('name');
  if (!nameLocked && newName && String(newName).trim() && String(newName).trim().toLowerCase() !== npc.name.toLowerCase()) {
    const target = String(newName).trim();
    const dup = findNpc(state, target);
    if (dup !== -1 && dup !== idx) {
      // Уже есть запись под настоящим именем — сливаем в неё описательную и работаем дальше с ней.
      const keep = state.npcs[dup];
      for (const f of ['description', 'appearance', 'personality', 'attitude', 'status', 'wants', 'secret', 'quirk', 'links', 'avatar']) {
        if (!keep[f] && npc[f]) keep[f] = npc[f];
      }
      if (npc.history && !(keep.history || '').includes(npc.history)) keep.history = keep.history ? `${keep.history} ${npc.history}` : npc.history;
      keep.traits = [...new Set([...(keep.traits || []), ...(npc.traits || [])])].slice(0, 5);
      keep.locked = [...new Set([...(keep.locked || []), ...(npc.locked || [])])];
      // Прежнее описательное имя помним: по нему ищутся ранние упоминания (кнопка ✨ в карточке).
      keep.aliases = [...new Set([...(keep.aliases || []), ...(npc.aliases || []), npc.name])].slice(-6);
      state.npcs.splice(idx, 1);
      npc = keep;
      mergedNote = ` Записи «${npcName}» и «${target}» объединены.`;
    } else {
      npc.aliases = [...new Set([...(npc.aliases || []), npc.name])].slice(-6);
      npc.name = target;
    }
  }
  const locked = Array.isArray(npc.locked) ? npc.locked : [];
  const skipped = [];
  const allow = (field, value) => {
    if (value === undefined) return false;
    if (locked.includes(field)) { skipped.push(field); return false; }
    return true;
  };
  if (allow('description', description)) npc.description = String(description);
  if (allow('appearance', appearance)) { if (String(appearance) !== (npc.appearance || '')) delete npc.portraitTags; npc.appearance = String(appearance); }
  if (allow('personality', personality)) npc.personality = String(personality);
  if (allow('traits', traits) && Array.isArray(traits)) npc.traits = validTraits(state, traits);
  if (allow('wants', wants)) npc.wants = String(wants);
  if (allow('quirk', quirk)) npc.quirk = String(quirk);
  if (allow('links', links)) npc.links = String(links);
  for (const [k, v] of Object.entries(VOICE_MAP)) if (allow('voice', v)) npc[k] = String(v);
  if (allow('voice', voice_sample)) addSample(npc, voice_sample);
  if (allow('competence', level)) npc.competence = level;
  if (allow('competence', skillList)) npc.skills = skillList;
  if (allow('mood', mood)) { npc.mood = String(mood); npc.moodReason = String(mood_reason || ''); npc.moodTurn = state.turn || 0; }
  // Тайна: пустая строка = раскрыта и снята. Иначе — обновлена.
  if (allow('secret', secret)) npc.secret = String(secret);
  if (allow('attitude', attitude)) npc.attitude = String(attitude);
  if (allow('status', status)) npc.status = String(status);
  if (allow('history', history) && String(history).trim()) {
    const add = String(history).trim();
    const prev = (npc.history || '').trim();
    // История накапливается: новое дописывается к прежнему, а не затирает его.
    if (!prev) npc.history = add;
    else if (!prev.includes(add)) npc.history = `${prev}; ${add}`;
  }
  npc.updatedTurn = state.turn || 0;
  if (skipped.length) {
    return `Обновлён НПС «${npc.name}». Поля закреплены игроком и не изменены: ${skipped.join(', ')}.` + mergedNote;
  }
  return `Обновлён НПС «${npc.name}»${npc.attitude ? ` (${npc.attitude})` : ''}${npc.status ? `, статус: ${npc.status}` : ''}.` + mergedNote;
}

// Применяет один вызов инструмента к состоянию. Возвращает строку-результат.
const KNOWN_TOOLS = new Set(['block', 'npc', 'nothing', 'create_block', 'update_block', 'remove_block',
  'create_npc', 'update_npc', 'remove_npc', 'record_lore', 'thread', 'update_hero', 'scene', 'event', 'practice']);

export function executeTool(name, args, state) {
  if (!KNOWN_TOOLS.has(name)) return `Ошибка: инструмента «${name}» нет. Доступны: block, npc, scene, event, thread, practice, update_hero, nothing.`;
  if (name === 'nothing') return 'Принято: без изменений.';
  // block / npc — единые инструменты вместо пар create/update (они всё равно
  // работали как «есть — обновить, нет — завести»). Старые имена остаются
  // рабочими: их могут прислать утёкшие вызовы или сохранённые промты.
  if (name === 'block') name = args && args.action === 'remove' ? 'remove_block' : 'create_block';
  if (name === 'npc') name = args && args.action === 'archive' ? 'remove_npc' : 'create_npc';
  if (NPC_TOOLS.includes(name)) return executeNpcTool(name, args, state);
  if (LORE_TOOLS.includes(name)) return executeLoreTool(args, state);
  if (THREAD_TOOLS.includes(name)) return executeThreadTool(args, state);
  if (HERO_TOOLS.includes(name)) return executeHeroTool(args, state);
  if (SCENE_TOOLS.includes(name)) return executeSceneTool(args, state);
  if (EVENT_TOOLS.includes(name)) return executeEventTool(args, state);
  if (name === 'practice') return executePracticeTool(args, state);

  const { type, name: blockName, value, max, description, character } = args || {};

  if (!BLOCK_TYPES.includes(type)) return `Ошибка: неизвестный тип блока "${type}".`;
  if (!blockName || !String(blockName).trim()) return 'Ошибка: не указано название блока.';

  const char = resolveCharacter(state, character);
  const blocks = char.blocks;
  let notes = '';
  let wantName = String(blockName).trim();
  if (type === 'status' && name !== 'remove_block') {
    const cat = catalogStatusName(state, wantName);
    if (cat && findIndex(blocks, type, wantName) === -1) { notes += ` (записано по каталогу как «${cat}»)`; wantName = cat; }
  }
  let idx = findIndex(blocks, type, wantName);
  // Удаление прощает неточности: «Отравлена» → каталожное «Отравлен», не тот type —
  // если по имени однозначно находится один блок, убираем его (и пишем, что нашли).
  if (name === 'remove_block' && idx === -1) {
    const cat = type === 'status' ? catalogStatusName(state, wantName) : null;
    if (cat && findIndex(blocks, type, cat) !== -1) { idx = findIndex(blocks, type, cat); notes += ` (по каталогу — «${cat}»)`; }
    else {
      const n = wantName.toLowerCase();
      const any = blocks.map((b, i) => [b, i]).filter(([b]) => b.name.trim().toLowerCase() === n || sameName(b.name, wantName));
      if (any.length === 1) { idx = any[0][1]; notes += ` (нашёлся как ${any[0][0].type}, а не ${type})`; }
    }
  }
  if (idx !== -1 && blocks[idx].name.trim().toLowerCase() !== wantName.toLowerCase() && name !== 'remove_block') {
    notes += ` (совпало с «${blocks[idx].name}»)`;
  }
  // Показатель: значение — число, в пределах шкалы; резкий скачок — повод перепроверить.
  if (type === 'stat' && name !== 'remove_block' && value !== undefined) {
    const prev = idx !== -1 ? blocks[idx] : null;
    const scaleMax = max !== undefined ? coerceNumber(max) : prev ? prev.max : undefined;
    const num = /\d/.test(String(value)) ? coerceNumber(value) : undefined;
    if (scaleMax != null && num === undefined) {
      return `Ошибка: у показателя «${wantName}» value должно быть числом (шкала до ${scaleMax}), пришло «${value}». Не записано.`;
    }
    if (num !== undefined && scaleMax != null) {
      const clamped = Math.max(0, Math.min(scaleMax, num));
      if (clamped !== num) { notes += ` (${num} вне шкалы 0..${scaleMax} — записано ${clamped})`; args = { ...args, value: String(clamped) }; }
      const old = prev ? coerceNumber(prev.value) : undefined;
      if (old !== undefined && scaleMax >= 5 && Math.abs(clamped - old) > scaleMax * 0.6) {
        notes += ` ВНИМАНИЕ: «${wantName}» изменилось сразу на ${clamped - old} из ${scaleMax}. Если в тексте не было такого удара или исцеления — исправь.`;
      }
    }
  }

  if (idx !== -1 && blocks[idx].locked) {
    return `Блок "${blocks[idx].name}" закреплён игроком — менять и удалять его нельзя. Оставь как есть.`;
  }
  // Закреплено только описание: числа и значение живут, а описание, имя и сам блок — нет.
  if (idx !== -1 && blocks[idx].descLocked && name === 'remove_block') {
    return `У блока "${blocks[idx].name}" игрок закрепил описание — удалять его нельзя. Значение менять можно.`;
  }
  const val = args && args.value !== undefined ? args.value : value;
  if (name === 'remove_block') {
    if (idx === -1) {
      // Подсказка для второго раунда: что на самом деле есть — у этого героя и у других.
      const key = wantName.toLowerCase().split(/\s+/)[0].slice(0, 4);
      const near = blocks.filter((b) => b.type === type || (key.length >= 3 && b.name.toLowerCase().includes(key)))
        .map((b) => `${b.name} (${b.type})`).slice(0, 12);
      const elsewhere = (state.characters || []).filter((c) => c !== char && (c.blocks || []).some((b) => b.name.trim().toLowerCase() === wantName.toLowerCase() || sameName(b.name, wantName)));
      return `У героя «${char.name}» блок "${blockName}" (${type}) не найден.` +
        (elsewhere.length ? ` Такой блок есть у: ${elsewhere.map((c) => c.name).join(', ')} — укажи character.` : '') +
        (near.length ? ` Есть: ${near.join(', ')}. Удаляй по точному названию.` : '');
    }
    const removed = blocks[idx].name;
    blocks.splice(idx, 1);
    return `Удалён блок "${removed}" у героя «${char.name}»${notes}.`;
  }

  if (idx === -1) {
    const block = { id: randomUUID(), type, name: wantName };
    if (type === 'status') block.sinceTurn = state.turn || 0; // чтобы статус на 1 ход успел сработать
    if (val !== undefined) block.value = String(val).trim();
    if (max !== undefined) block.max = coerceNumber(max);
    if (description) block.description = String(description);
    blocks.push(block);
    return `У героя «${char.name}» создан блок "${block.name}" (${type})${block.value ? `: ${block.value}` : ''}.${notes}`;
  }

  const block = blocks[idx];
  if (val !== undefined) block.value = String(val).trim();
  if (max !== undefined) block.max = coerceNumber(max);
  let descNote = '';
  if (description !== undefined) {
    if (block.descLocked) { if (String(description).trim() !== (block.description || '').trim()) descNote = ' Описание закреплено игроком — не изменено.'; }
    else block.description = String(description);
  }
  if (descNote) notes += descNote;
  return `У героя «${char.name}» обновлён блок "${block.name}" (${type})${block.value ? `: ${block.value}` : ''}.${notes}`;
}

// Набор инструментов для запроса: лишние описания — шум, снижающий точность остальных.
// Если игрок не разрешил дописывать справочник мира, record_lore не отправляем вовсе.
export function toolsFor(state) {
  const drop = new Set();
  if (state.loreAutoWrite !== true) drop.add('record_lore');
  return TOOL_DEFINITIONS.filter((t) => !drop.has(t.function.name));
}
