// Шаг учёта: отдельный запрос, который приводит листы, НПС, сцену, хронику
// и нити в соответствие с только что написанным фрагментом истории.

import { toolsFor, NOTHING_TOOL, executeTool, isUnnamedName } from './tools.js';
import { TRAIT_CATEGORIES } from './traits.js';
import { sceneForSync } from './scene.js';
import { chronicleForSync, isOverdue } from './chronicle.js';
import { callOpenRouter, parseLeakedToolCalls, toolModelOf } from './llm.js';
import { FIX_SIGNAL, journalEntry } from './journal.js';
import { whoShort, lastPlayerAction } from './narrator.js';

const NL = '\n';

// Снимок для учёта: с явными типами, чтобы «бухгалтер» не путался.
export function sheetForSync(character) {
  const items = character.blocks.map((b) => {
    const lock = b.locked ? ' 🔒' : b.descLocked ? ' 📌' : '';
    if (b.type === 'stat' && b.max != null) return `${b.name} ${b.value ?? '?'}/${b.max} [stat]${lock}`;
    if (b.value) return `${b.name}: ${b.value} [${b.type}]${lock}`;
    return `${b.name} [${b.type}]${lock}`;
  });
  const anyLocked = character.blocks.some((b) => b.locked);
  if (anyLocked) items.push('(🔒 — закреплено игроком, не менять и не удалять)');
  if (character.blocks.some((b) => !b.locked && b.descLocked)) items.push('(📌 — описание закреплено: значение менять можно, описание и сам блок — нет)');
  // Внешность и положение — чтобы update_hero не затирал прежнее вслепую.
  const locks = Array.isArray(character.locked) ? character.locked : [];
  const look = (character.appearance || '').trim();
  const about = [
    look ? `  внешность${locks.includes('appearance') ? ' 🔒' : ''}: ${look.length > 600 ? look.slice(0, 599) + '…' : look}` : '',
    character.social ? `  положение${locks.includes('social') ? ' 🔒' : ''}: ${character.social}` : '',
  ].filter(Boolean).join('\n');
  // Лист пуст — учётчику нужно описание героя, чтобы завести стартовый лист.
  const persona = !character.blocks.length && character.persona && character.persona.trim()
    ? `\n  описание героя: ${character.persona.trim().slice(0, 900)}` : '';
  return `${character.name}: ${character.blocks.length ? items.join('; ') : '(лист пуст)'}` + (about ? '\n' + about : '') + persona;
}

// Системный промт для ШАГА УЧЁТА («бухгалтер состояния»).
// Промт учёта собирается ПОД СЦЕНУ: включаются только те правила, которые
// применимы к текущему состоянию. Чем меньше шума, тем точнее работа модели.
// Может ли во фрагменте появиться новый персонаж. Только тогда учётчику нужны
// справочники черт и заготовок (≈1000 токенов) — в остальные ходы это шум.
const INTRO_WORDS = /(незнаком|некто|кто-то|какой-то|какая-то|какие-то|представил|зовут|назвал(ся|ась)|впервые|новенький|новенькая)/i;
export function mayIntroduceNpc(state, narration) {
  const text = String(narration || '');
  if (!text) return false;
  if (!(state.npcs || []).length) return true;
  if (INTRO_WORDS.test(text)) return true;
  const known = [
    ...(state.npcs || []).map((n) => n.name),
    ...(state.characters || []).map((c) => c.name),
    (state.scene && state.scene.location) || '',
  ].flatMap((n) => String(n).toLowerCase().split(/\s+/)).filter((w) => w.length >= 3).map((w) => w.slice(0, 4));
  // Слово с заглавной посреди фразы — вероятно имя. Незнакомое — повод показать справочники.
  const re = /[а-яёa-z,;:]\s+([А-ЯЁ][а-яё]{2,})/g;
  let m;
  while ((m = re.exec(text))) if (!known.includes(m[1].toLowerCase().slice(0, 4))) return true;
  return false;
}

// Прежняя инструкция учётчика (до v41) — оставлена для сравнения, включается в настройках.
function legacySyncHead(state) {
  const lines = [
    'Ты — учётчик состояния в текстовой RPG. На входе — текущее состояние и последний фрагмент истории. ' +
      'Вызови инструменты так, чтобы состояние отражало произошедшее.',
    '',
    'ГЛАВНОЕ ПРАВИЛО: записывай только то, что прямо прозвучало или явно следует из текста. ' +
      'Ничего не додумывай; о чём текст молчит — не трогай.',
    'Все нужные вызовы — одним ответом. Если записывать нечего — вызови nothing.',
    '',
    'ПОРЯДОК ВАЖНОСТИ (не успеваешь всё — делай сверху вниз):',
    '1. block — лист героя: предмет получен, потерян или израсходован; ранение и состояние; изменился показатель.',
    '2. scene — сменилось место; прошло время (elapsed_minutes: разговор ≈10, дорога по городу ≈60, ночь сна ≈480); ' +
      'кто пришёл или ушёл (present — полный список тех, кто физически рядом).',
    '3. npc — персонажи ЭТОГО фрагмента: отношение к герою (из поведения, не смягчай), status — где он и в каком состоянии, ' +
      'history — что произошло между ним и героем, одной строкой.',
    '4. event — то, что через сто ходов должно остаться правдой: обещание, долг, ложь (known_by — кто знает правду), ' +
      'раскрытая тайна, решение, смерть, факт о прошлом («здесь 7 лет»). Одна фраза с именами; не то, что уже есть в хронике. ' +
      'Назначенная встреча, приём, срок — type plan с when («в полдень», «завтра вечером»). ' +
      'ЗАКРЫВАЙ: обещание исполнено или нарушено, долг отдан, встреча состоялась или сорвалась, срок прошёл, факт перестал быть правдой — ' +
      'event {action:"close", id:"#N", outcome}. Перенесли — action update. Проверяй хронику каждый раз: висящее после события — ошибка.',
    '5. npc.voice_sample — персонаж сказал что-то характерное (шутка, словечко, интонация): одна реплика дословно.',
    '6. thread — появилась цель, загадка или конфликт, что тянется через сцены (open); продвинулся (update); решён или упущен (done/failed).',
  ];
  if (state.loreAutoWrite === true) lines.push('7. record_lore — новые важные сведения о мире (не о людях).');

  lines.push(
    '',
    'ЛИСТ ГЕРОЯ:',
    '- Показатели (stat) — числами: урон, усталость, траты уменьшают value; отдых, лечение, плата увеличивают. В пределах 0..max.',
    '- Новый показатель заводи, когда появилось то, что стоит измерять и что будет меняться: «Рассудок», «Репутация», «Заряд амулета». Разово упомянутое — нет.',
    '- Умение (ability, value — новичок/ученик/опытный/мастер) заводи, когда у героя проявилась или появилась устойчивая компетенция: обучился, давно практикует, это его ремесло. Разовое действие («открыл дверь») — не умение. Рост уровня от бросков считает код.',
    '- Герой тренировался или учился уже записанному умению — practice (у наставника — kind lesson).',
    '- Состояния — по названиям из каталога ниже, их эффекты применит код. Вылеченное — block action remove; истёкшие код снимет сам.',
    '- Инвентарь честно: отдано, потеряно, сломано, израсходовано, осталось недоступным — block action remove.',
    '- Внешность героя (update_hero) — только если она в тексте изменилась надолго: шрам, стрижка, превращение. ' +
      'Деталь из описания сцены («руки в грязи», «волосы растрепались») — не перемена. ' +
      'Изменилась деталь — appearance_change (допишется); облик сменился почти целиком — appearance полностью, на основе прежнего из данных.',
    '',
    'ПЕРСОНАЖИ (npc):',
    '- Безымянный, но значимый (с ним говорили, он что-то сделал, он ещё появится) — заводи по описанию: ' +
      'name «Девушка в красном плаще», appearance — всё, что о нём сказано. Когда прозвучит имя — та же запись с new_name.',
    '- Заноси значимых, не массовку. Передавай только изменившиеся поля. ' +
      'description, appearance, personality, links заменяются целиком — пиши их с учётом прежнего; history дописывается сама.',
    '- description — только постоянное (роль, происхождение, родня); события — в history, текущее положение — в status.',
    '- mood + mood_reason — когда настроение заметно сменилось и ясно почему. voice_masks / voice_taboos — когда это стало видно.',
    '- Ушёл из истории насовсем — npc action archive (карточка сохранится).',
    '',
    'ПРИМЕР. Фрагмент: «Стражник Ольт швыряет тебе флягу: — Пей, пока я добрый. Глоток — и рана на плече саднит меньше. ' +
      'Через час вы у городских ворот.» Здоровье было 5/10. Вызовы:',
    '  block {type:"item", name:"Фляга"}',
    '  block {type:"stat", name:"Здоровье", value:"6"}',
    '  scene {location:"У городских ворот", elapsed_minutes:60}',
    '  npc {name:"Ольт", attitude:"грубовато дружелюбен", history:"дал герою флягу", voice_sample:"Пей, пока я добрый."}',
    'Не нужны: event (через сто ходов это не важно), thread (новой цели нет).',
  );

  return lines;
}

// Техническая инструкция учётчика: алгоритм, карта «событие → инструмент», связки
// последствий и формат аргументов. Цель — полнота: каждая категория проверяется
// каждый ход, но записывается только подтверждённое текстом.
function technicalSyncHead(state) {
  const lore = state.loreAutoWrite === true;
  return [
    'РОЛЬ: учётчик состояния текстовой RPG. ВХОД: данные мира и новый фрагмент истории. ' +
      'ВЫХОД: вызовы инструментов, после которых данные = мир после фрагмента. Ты не рассказчик: ничего не продолжаешь и не придумываешь.',
    '',
    'ИСТОЧНИК ИСТИНЫ: фрагмент и действие игрока. Записывай то, что произошло или однозначно следует. ' +
      'Молчание текста — не событие: не удаляй предметы и не снимай состояния только потому, что о них не сказано.',
    '',
    'АЛГОРИТМ (выполни молча, выведи только вызовы):',
    'A. Разбей фрагмент на события. Для каждого найди ВСЕ затронутые объекты по КАРТЕ.',
    'B. Сверь с данными: ЛИСТЫ, СЦЕНА, НПС, НИТИ, ХРОНИКА (#номера). Что это событие исполняет, отменяет или меняет из уже записанного?',
    'C. Проверь СВЯЗКИ — одно событие часто требует нескольких вызовов.',
    'D. Выведи все вызовы одним ответом. Изменений нет — один nothing.',
    'Проверяй все категории КАРТЫ на каждом ходу. Пропущенное изменение — ошибка; лишняя или выдуманная запись — тоже ошибка.',
    '',
    'КАРТА (событие → вызов):',
    '- предмет получен / отдан / потерян / израсходован / сломан → block type:item (set | action:remove); количество — в value',
    '- урон, лечение, трата, отдых, изменение измеряемого → block type:stat, value — НОВОЕ число в 0..max (не разница)',
    '- ранение, яд, болезнь, состояние с эффектом → block type:status, имя из КАТАЛОГА; вылечено → action:remove; истечение по времени снимает код',
    '- обучение, ремесло, давняя практика → block type:ability, value: новичок|ученик|опытный|мастер. Разовое действие — не умение; рост от бросков считает код',
    '- герой тренировался или учился умению, которое уже есть в листе → practice (kind:lesson — у наставника); применение в деле — не практика',
    '- отношение группы или фракции к герою → block type:relationship',
    '- внешность или положение героя изменились надолго → update_hero (appearance_change | social). Грязь, растрёпанность — не перемена',
    '- место сменилось, прошло время, кто-то пришёл или ушёл → scene. elapsed_minutes: реплика 1–5, разговор ≈10, схватка ≈5, путь по городу ≈60, ночь ≈480. ' +
      'present — ПОЛНЫЙ список НПС физически рядом',
    '- значимый НПС действовал, говорил, изменился → npc (только изменившиеся поля, см. ПОЛЯ НПС)',
    '- обещание, долг, ложь, раскрытая тайна, решение, смерть, факт о прошлом → event action:add (type; known_by — кто знает правду)',
    '- назначена встреча или срок → event add type:plan + when («в полдень», «завтра вечером»)',
    '- обязательство исполнено / нарушено / снято, встреча прошла, факт устарел → event action:close id:"#N" outcome:done|broken|past; перенесли → action:update',
    '- новая цель, загадка или конфликт на несколько сцен → thread open; продвинулось → update + progress; решено → done; упущено → failed',
    ...(lore ? ['- новые устойчивые сведения о мире (законы, обычаи, организации — не о людях) → record_lore'] : []),
    '',
    'ШКАЛА — текст редко называет числа; перевести последствие в число по шкале — это учёт, а не выдумка. Доля от max показателя:',
    '- ушиб, царапина −5–10%; рана, сильный удар −15–25%; тяжёлая рана −35–50%; на волосок от смерти — почти 0',
    '- усталость, страх, трата сил — по тому же принципу для своих показателей (Выносливость, Рассудок, Мана…)',
    '- отдых час +5–10%; еда и тепло +5–10%; ночь сна +30–50% (без свежих ран — до max); перевязка, лечение, зелье +15–30%',
    '- деньги: цена названа — вычти её; не названа — разумная для мира (кружка эля — медяки, ночлег — несколько монет)',
    '- одноразовое использовано (стрела, факел, зелье, бинт, еда) — уменьши количество в value или remove',
    'Есть подходящий показатель — меняй его, а не заводи новый. Нет показателя, а последствие весомое (Здоровье при ранении) — заведи.',
    '',
    'ПОЛЯ НПС: attitude — к герою, по ФАКТИЧЕСКОЙ реакции НПС, не по тону героя; status — где он и в каком состоянии сейчас; ' +
      'history — что произошло между ним и героем, одна строка (дописывается сама); mood + mood_reason — смена настроения с причиной; ' +
      'wants — новая цель; links — связи с другими НПС (заменяется целиком); secret — тайна; voice_sample — характерная реплика дословно; ' +
      'competence (обычный|профессионал|мастер) + skills (1–3 умения) — у значимых с ремеслом: следователь, наёмник, вор, лекарь; ' +
      'description / appearance / personality — постоянное, заменяется целиком: пиши с учётом записанного.',
    'НПС: заноси значимых, не массовку. Безымянного значимого — по описанию («Девушка в красном плаще»); прозвучало имя — та же запись + new_name. ' +
      'Просто вышел из сцены — scene.present и status; action:archive — только если ушёл из истории насовсем.',
    '',
    'СВЯЗКИ (проверь вторую половину, когда случилась первая):',
    '- заплатил / вернул долг → block (деньги) + event close #N + npc (если сменилось отношение)',
    '- отдал или получил предмет → block (item) + npc history',
    '- ранен → block stat + block status, если в КАТАЛОГЕ есть подходящее',
    '- НПС ушёл → scene.present без него + npc status',
    '- тайна раскрыта → event type:reveal (known_by) + npc',
    '- персонаж солгал или скрыл правду (даже если герой это заметил) → event type:lie, known_by — кто знает правду; не только npc и thread',
    '- прошло время → scene elapsed_minutes; в ХРОНИКЕ проверь записи с ⚠',
    '- дал обещание → event add promise; выполнил → event close',
    '',
    'АРГУМЕНТЫ: имена и названия — точно как в данных; числа — числами; один вызов — одна сущность; nothing — только когда других вызовов нет.',
    'ЗАПРЕЩЕНО: дублировать записанное; менять закреплённое (🔒); заводить нить из обычного разговора; переписывать неизменившиеся поля.',
    '',
    'ПРИМЕР. Данные: Кошель 35 золотых; ХРОНИКА #3 [долг] Ян должен Ольту 20 золотых; рядом: Ольт. ' +
      'Фрагмент: «Ты отсчитываешь Ольту двадцать золотых. — Держишь слово, — впервые улыбается он и уходит.» Вызовы:',
    '  block {type:"item", name:"Кошель", value:"15 золотых"}',
    '  event {action:"close", id:"#3", outcome:"done"}',
    '  npc {name:"Ольт", attitude:"уважает героя", status:"ушёл из таверны", history:"герой вернул долг"}',
    '  scene {present:[], elapsed_minutes:5}',
    'Не нужны: thread (новой цели нет), event add (новых фактов нет).',
    '',
  ];
}

export function composeSyncSystem(state, narration = '') {
  const npcs = (state.npcs || []).filter((n) => !n.archived);
  const anyLocked = npcs.some((n) => (n.locked || []).length) ||
    (state.characters || []).some((c) => (c.blocks || []).some((b) => b.locked));
  const anyUnnamed = npcs.some((n) => isUnnamedName(n.name));
  const newcomer = mayIntroduceNpc(state, narration);

  // Порядок важен для кэша провайдера (DeepSeek, Gemini, Claude): одинаковое
  // начало запроса от хода к ходу оплачивается со скидкой. Поэтому сначала —
  // всё постоянное, в конце — то, что меняется от хода к ходу.
  const lines = state.syncPromptStyle === 'legacy' ? legacySyncHead(state) : technicalSyncHead(state);

  const cat = state.statusCatalog || [];
  if (cat.length) {
    lines.push('', 'КАТАЛОГ СОСТОЯНИЙ: ' + cat.map((d) => {
      const fx = [];
      if (d.rollMod) fx.push(`${d.rollMod > 0 ? '+' : ''}${d.rollMod} к броскам`);
      if (d.tick) fx.push(`${d.tick.stat} ${d.tick.delta > 0 ? '+' : ''}${d.tick.delta}/ход`);
      if (d.duration) fx.push(`${d.duration} х.`);
      return fx.length ? `${d.name} (${fx.join(', ')})` : d.name;
    }).join('; '));
  }

  // ---- дальше — меняется от хода к ходу ----
  const extra = [];
  if (anyUnnamed) extra.push('- Персонаж был записан по описанию, а теперь названо имя → npc с прежним именем и new_name, НЕ новая запись.');
  if (anyLocked) extra.push('- Закреплённое игроком (🔒, «закреплено») не меняй.');
  const manyStatuses = (state.characters || []).some((c) => c.blocks.filter((b) => b.type === 'status').length > 4);
  if (manyStatuses) extra.push('- Состояний много: прошедшие убирай, взаимоисключающие не держи вместе, похожие объединяй.');
  const emptyHeroes = (state.characters || []).filter((c) => (c.present !== false || c.id === state.activeCharacterId) && !(c.blocks || []).length);
  if (emptyHeroes.length) {
    extra.push(`- ЛИСТ ПУСТ у: ${emptyHeroes.map((c) => c.name).join(', ')}. Заведи лист сейчас — здесь можно опираться на ОПИСАНИЕ ГЕРОЯ из данных, ` +
      'не только на фрагмент: 1–3 показателя по жанру (Здоровье и то, что важно в этом мире), умения из его ремесла и прошлого (с уровнем), ' +
      'то, что при нём по описанию и тексту. ' + ((state.turn || 0) > 1 ? 'История уже идёт — бери положение героя на СЕЙЧАС, а не стартовое. ' : '') +
      'Мелочей и выдуманных подробностей не добавляй.');
  }
  if (extra.length) lines.push('', 'СЕЙЧАС ОСОБО:', ...extra);

  if (newcomer) {
    lines.push(
      '',
      'НОВЫЙ ПЕРСОНАЖ — заводи с description, attitude и wants (чего хочет сейчас — без этого не заводи). ' +
        'quirk — одна странность, лучше противоречащая черте. traits — 2–4 ярлыка из списка ниже, из разных категорий. ' +
        'secret — значимым. voice_style / voice_humor / voice_habits — по тому, как он реально говорил. links — связи с другими НПС. ' +
        'Есть ремесло — competence и skills (следователь-мастер: «следствие, допрос»; стражник: профессионал, «стража»).',
    );
    const pool = state.traitPool || [];
    if (pool.length) {
      lines.push('ЧЕРТЫ:');
      for (const c of TRAIT_CATEGORIES) {
        const inCat = pool.filter((t) => t.cat === c.id).map((t) => t.label);
        if (inCat.length) lines.push(`${c.label}: ${inCat.join(', ')}`);
      }
    }
    const seeds = state.seedPool || {};
    if ((seeds.quirks || []).length || (seeds.secrets || []).length) {
      lines.push('ЗАГОТОВКИ — бери отсюда или придумывай в том же духе:');
      if (seeds.quirks?.length) lines.push('Изюминки: ' + seeds.quirks.join(' | '));
      if (seeds.secrets?.length) lines.push('Тайны: ' + seeds.secrets.join(' | '));
      const taken = [...new Set(npcs.flatMap((n) => [n.quirk, n.secret]).filter(Boolean).map((x) => x.trim()))];
      if (taken.length) lines.push('Уже занято (не повторять): ' + taken.join(' | '));
    }
  }
  return lines.join(NL);
}

// ШАГ 2 — учёт. Отдельный фокусный запрос, не попадает в основную историю.
// Стоит ли вообще запускать проход учёта. Если рассказчик ничего не сказал
// или ход совсем короткий и в нём нет ни одного признака перемены —
// запрос с полным набором инструментов будет пустой тратой.
export function syncWorthwhile(state, narration) {
  const text = (narration || '').trim();
  if (!text) return false;

  // По умолчанию учёт ИДЁТ: пропустить изменение хуже, чем сделать лишний запрос.
  // Пропускаем только заведомо пустые ходы: короткая атмосферная зарисовка,
  // без прямой речи, без упоминания знакомых персонажей и без чисел.
  if (text.length >= 60) return true;
  if (/["«»]/.test(text)) return true;                    // есть диалог
  if (/\d/.test(text)) return true;                       // есть числа
  const lower = text.toLowerCase();
  const npcMentioned = (state.npcs || []).some((n) => {
    const first = n.name.toLowerCase().split(/\s+/)[0];
    return first && first.length >= 3 && lower.includes(first);
  });
  if (npcMentioned) return true;

  return false;
}

// ШАГ 2 — учёт. Отдельный фокусный запрос, не попадает в основную историю.
// ---- Проверка полноты после первого раунда (код, без лишнего запроса к модели) ----
// Ищем во фрагменте явные признаки событий, на которые не последовало ни одного
// подходящего вызова. Только тогда — второй раунд с конкретными вопросами.
// Признаки консервативные: ложная тревога стоит лишнего запроса, пропуск — дыры в учёте.
// Конец слова — (?!\p{L}) с флагом u: обычный \b в JS кириллицу не видит («рана\b» не находилось никогда).
const RE_PAY = /(заплат|(?<!\p{L})плат(ишь|ит|ил|ила|ят|и)(?!\p{L})|расплат|выплат|отсчит|отда(л|ёшь|ешь|ю|ла)(?!\p{L})|верну(л|ла|ть|ёшь)|возвраща(ет|ешь|ют|ю)(?!ся)(?!\p{L})|отдаёт|купи(л|ла|шь)|прода(л|ла|ёшь)|подобра(л|ла)|потеря(л|ла)|выпи(л|ла|ваешь)|съе(л|ла|даешь)|израсход|сломал|разби(л|лась)|получи(л|ла|шь)|вручи)/iu;
const RE_HURT = /(ранен|ранил|кровь|кровоточ|порез|ожог|удар(ил|ом)|сломал.{0,10}(рук|ног|рёбр)|теряешь сознани|отрав|яд(?!\p{L})|исцел|залечи|перевяз|(?<!\p{L})ран(а|у|ы|е|ой|ами|ах)(?!\p{L})|вылечи|лечени|зашива|зашил)/iu;
const RE_TIME = /(через (час|полчаса|несколько|пару|минут|день)|прошл[оа] |проходит (час|полчаса|время|несколько|четверть)|спустя|к (утру|вечеру|ночи|полудню|рассвету)(?!\s+(будет|обещ|прояснит|распогодит))|наступ(ил|ает) (вечер|ночь|утро|рассвет)|до (утра|рассвета|вечера)|всю ночь|выспал|засыпаешь)/i;
const RE_LEAVE = /(уход(ит|ят)|уш(ёл|ла|ли)|выход(ит|ят)|вышл?(а|и)?(?!\p{L})|покида(ет|ют)|покинул|скрыл(ся|ась|ись)|исчез|удалил(ся|ась)|прощается)/iu;
const RE_REST = /(отдыха|отдохну|передохну|спишь|уснул|засыпа|выспал|ночлег|поел|поешь|ужина|завтрака|обеда|согрел|измотан|выбил(ся|ась) из сил|задыха|устал|изнем|пот гр|еле стоишь)/i;
const RE_USE = /(выстрел|стреля|пускаешь стрел|зажига|факел (гаснет|догорел)|выпиваешь зелье|пьёшь зелье|глотаешь зелье|бинт|перевязыва|последн(юю|ий|ее) (стрел|патрон|зарядк|монет)|кончил(ись|ся)|израсход|сломал(ся|ась|ось)|разбил(ся|ась|ось))/i;
const RE_TRAIN = /(тренир|упражня|отрабатыва|оттачива|учишься|училс|училась|урок|наставни|учитель|упражнени|практикуешь|спарринг)/i;
const RE_DONE = /(отда|верну|заплат|выплат|расплат|отсчит|долг|сдержал|выполн|исполн|обещанн|состоял|пришёл на встречу|явил|принял(а)? тебя|аудиенц|при[её]м)/i;
// calls — [{ name, args }]. По блокам смотрим и на тип: записали деньги, но не рану —
// про рану всё равно напомним. Вызов без аргументов (старое имя) считаем покрывающим всё.
export function completenessHints(state, narration, calls) {
  const text = String(narration || '');
  const low = text.toLowerCase();
  const used = new Set(calls.map((c) => c.name));
  const BLOCK_NAMES = ['block', 'create_block', 'update_block', 'remove_block'];
  const blockCalls = calls.filter((c) => BLOCK_NAMES.includes(c.name));
  const blockTouched = (...types) => blockCalls.some((c) => !c.args || !c.args.type || types.includes(c.args.type));
  // Деньги бывают и предметом («Кошель»), и показателем («Золото 35/100»).
  const MONEY = /(золот|серебр|медь|медяк|монет|деньг|кошел|кошёл|кредит|гульден|талер|крон|рубл|доллар)/i;
  const moneyTouched = () => blockCalls.some((c) => !c.args || !c.args.type || c.args.type === 'item' || (c.args.type === 'stat' && MONEY.test(c.args.name || '')));
  const has = (n) => used.has(n) || (n === 'npc' && ['create_npc', 'update_npc', 'remove_npc'].some((x) => used.has(x)));
  const hints = [];
  // Лист — это герой: «с ожогом на шее» у незнакомца или «купец платит стражнику» — не повод.
  // Признак засчитываем, если в той же или предыдущей фразе речь о герое.
  const heroName = (state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0] || {}).name || '';
  const sentences = text.split(/(?<=[.!?…»])\s+/);
  const heroFirst = heroName.trim().split(/\s+/)[0].toLowerCase();
  const heroStem = heroFirst.length > 4 ? heroFirst.slice(0, -1) : heroFirst; // «Кейна» = «Кейн», «Яна» = «Ян»
  const HERO_REF = /(?<!\p{L})(ты|тебя|тебе|тобой|тво(й|я|ё|е|и|его|ей|их|ём|ем|им|ю|ими)|вы|вас|вам|вами|ваш(а|е|и|его|ей|их|ем|им|у|ими)?)(?!\p{L})|(?<!\p{L})(ешь|ёшь|ишь)(?!\p{L})/iu;
  const VERB_2ND = /\p{L}(ешь|ёшь|ишь|ешься|ишься|ете|ёте|ите)(?!\p{L})/u;
  const refersHero = (s) => HERO_REF.test(s) || VERB_2ND.test(s) || (heroStem.length >= 2 && new RegExp(`(?<!\\p{L})${heroStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(s));
  const aboutHero = (re) => sentences.some((s, i) => re.test(s) && (refersHero(s) || (i > 0 && refersHero(sentences[i - 1]))));
  const stemOf = (name) => { const w = String(name).toLowerCase().split(/\s+/).find((x) => x.length >= 3) || ''; return w.length > 5 ? w.slice(0, w.length - 2) : w.slice(0, 4); };
  const hero = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const sheet = hero ? (hero.blocks || []).filter((b) => b.type === 'stat' || b.type === 'item')
    .map((b) => b.type === 'stat' ? `${b.name} ${b.value ?? '?'}${b.max != null ? '/' + b.max : ''}` : `${b.name}${b.value ? ': ' + b.value : ''}`).slice(0, 14).join(', ') : '';
  const sheetNote = sheet ? ` Сейчас в листе: ${sheet}.` : ' Лист пуст.';
  if (!moneyTouched() && aboutHero(RE_PAY)) hints.push('Во фрагменте платят, отдают, получают или тратят — лист героя (деньги, предметы) не менялся.' + sheetNote);
  if (!blockTouched('stat', 'status') && aboutHero(RE_HURT)) hints.push('Во фрагменте ранение или лечение — показатели и состояния героя не менялись (переведи по ШКАЛЕ).' + sheetNote);
  if (!blockTouched('stat', 'status') && !aboutHero(RE_HURT) && aboutHero(RE_REST)) hints.push('Во фрагменте отдых, сон, еда или трата сил — показатели героя не менялись (по ШКАЛЕ).' + sheetNote);
  if (!blockTouched('item') && !aboutHero(RE_PAY) && aboutHero(RE_USE)) hints.push('Во фрагменте израсходован или использован предмет — инвентарь не менялся.' + sheetNote);
  const heroSkills = ((state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0] || {}).blocks || []).filter((b) => b.type === 'ability');
  if (heroSkills.length && !used.has('practice') && aboutHero(RE_TRAIN)) {
    hints.push(`Во фрагменте герой тренировался или учился — опыт умению не начислен (practice). Умения: ${heroSkills.map((b) => b.name).join(', ')}.`);
  }
  if (!has('scene') && RE_TIME.test(text)) hints.push('Во фрагменте прошло заметное время — scene не вызван (elapsed_minutes).');
  const present = (state.scene && state.scene.present) || [];
  if (!has('scene') && RE_LEAVE.test(text)) {
    const gone = present.filter((p) => { const st = stemOf(p); return st.length >= 3 && low.includes(st); });
    if (gone.length) hints.push(`Похоже, кто-то ушёл (${gone.join(', ')}) — scene.present не обновлён.`);
  }
  if (!has('event')) {
    const ev = state.events || [];
    const open = ev.map((e, i) => [e, i + 1]).filter(([e]) => e.status === 'open' && ['promise', 'debt', 'plan'].includes(e.type));
    const hero = (state.characters.find((c) => c.id === state.activeCharacterId) || {}).name || '';
    const mentioned = (p) => p.toLowerCase() !== hero.toLowerCase() && String(p).toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
      .some((w) => low.includes(w.length > 5 ? w.slice(0, w.length - 2) : w.slice(0, 4)));
    const touched = open.filter(([e]) => (e.participants || []).some(mentioned) && RE_DONE.test(text));
    for (const [e, n] of touched.slice(0, 3)) hints.push(`ХРОНИКА #${n} «${e.text}» — не исполнено ли это сейчас? Если да — event close.`);
    if (!touched.length && ev.some((e) => isOverdue(e, state.scene))) hints.push('В ХРОНИКЕ есть записи с ⚠ (срок прошёл) — закрой или обнови их.');
  }
  return hints;
}

const RE_LOSS = /(сгорел|разруш|отобрал|отнял|конфиск|обокрал|украл|обчистил|ограбил|пропал[аио]? (вс|тво|ваш)|лишил(ся|ась|ись))/i;
const RE_HERO_LEFT = /(покидаешь|покидаете|покидаем|уезжаешь|уезжаете|съезжаешь|переезжаешь|перебираешься|сбегаешь|бежишь из|навсегда|больше не вернёшь|больше не вернётесь|ты ушёл|ты ушла|вы ушли)/i;
const RE_LEFT_3RD = '(покида|покинул|уезжа|уехал|съеха|переезж|перебрал|сбежал)';
export function heroLostPlace(narration, hero) {
  const text = String(narration || '');
  if (RE_LOSS.test(text) || RE_HERO_LEFT.test(text)) return true;
  // Повествование от третьего лица: имя героя рядом с глаголом ухода.
  const first = String(hero?.name || '').trim().split(/\s+/)[0];
  if (first.length < 3) return false;
  const esc = first.slice(0, Math.max(3, first.length - 1)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${esc}[\\p{L}]*[^.!?…]{0,40}${RE_LEFT_3RD}`, 'iu').test(text);
}

export async function syncState(state, apiKey, narration, journal = [], { model = null, timer = null } = {}) {
  const active = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const sheets = state.characters.filter((c) => c.present !== false || c.id === state.activeCharacterId).map(sheetForSync).join('\n');

  // Подсказки по гигиене — только когда есть повод.
  const hints = state.characters
    .map((c) => ({ name: c.name, n: c.blocks.filter((b) => b.type === 'status').length }))
    .filter((x) => x.n > 6)
    .map((x) => `У героя «${x.name}» накопилось ${x.n} состояний — убери устаревшие, объедини похожие.`);
  // Инвентарь — только когда ГЕРОЙ уехал насовсем или лишился вещей. «Ольт уходит» — не повод:
  // раньше это слово запускало подсказку, и учётчик мог стереть вещи героя.
  const items = (active?.blocks || []).filter((b) => b.type === 'item');
  if (items.length > 3 && heroLostPlace(narration, active)) {
    hints.push('Похоже, герой покинул место надолго или лишился вещей — проверь инвентарь: ' + items.map((b) => b.name).join(', ') +
      '. Убери (block action remove) только то, что по тексту пропало или осталось там; при обычном переходе вещи остаются при герое.');
  }
  const liveNpcs = (state.npcs || []).filter((n) => !n.archived);
  if (liveNpcs.length > 12) hints.push(`Знакомых НПС уже ${liveNpcs.length} — тех, кто ушёл из истории, убери в архив (npc action archive).`);
  const hygiene = hints.length ? '\n\nОБРАТИ ВНИМАНИЕ: ' + hints.join(' ') : '';

  // НПС: кто в сцене или во фрагменте — подробно, с текущими полями (иначе
  // «пиши целиком с учётом прежнего» невыполнимо); остальные — одной строкой.
  const lowerNarr = String(narration || '').toLowerCase();
  const presentList = ((state.scene && state.scene.present) || []).map((x) => x.toLowerCase());
  // Давно не появлявшиеся (и не упомянутые сейчас) — только по имени: учётчику этого хватает,
  // чтобы не заводить дубль, а их карточки на долгой игре раздували запрос.
  const turnNow = state.turn || 0;
  const fadedNpc = (n) => {
    const first = n.name.toLowerCase().split(/\s+/)[0];
    if (n.bound || (first.length >= 3 && lowerNarr.includes(first.length > 5 ? first.slice(0, -1) : first))) return false;
    if (presentList.some((p) => p.includes(first) || n.name.toLowerCase().includes(p))) return false;
    const last = n.lastSeen ? n.lastSeen.turn : n.updatedTurn;
    return Number.isFinite(last) && turnNow - last > 30;
  };
  const fadedNames = liveNpcs.filter(fadedNpc).map((n) => n.name);
  const npcLines = liveNpcs.length
    ? liveNpcs.filter((n) => !fadedNpc(n)).map((n) => {
        const first = n.name.toLowerCase().split(/\s+/)[0];
        const inScene = n.bound || (first.length >= 3 && lowerNarr.includes(first.length > 5 ? first.slice(0, -1) : first)) ||
          presentList.some((p) => p.includes(first) || n.name.toLowerCase().includes(p));
        const lockNote = (n.locked || []).length ? ` [закреплено игроком: ${n.locked.join(', ')}]` : '';
        if (!inScene) {
          const who = whoShort(n, 60);
          return `${n.name}${who ? ` (${who})` : ''} — отношение: ${n.attitude || '—'}${n.status ? '; статус: ' + n.status : ''}${lockNote}`;
        }
        const depth = [n.wants ? `хочет: ${n.wants}` : '', n.secret ? `скрывает: ${n.secret}` : '', n.quirk ? `изюминка: ${n.quirk}` : '', n.links ? `связи: ${n.links}` : ''].filter(Boolean);
        const current = [n.description ? `описание: ${n.description}` : '', n.appearance ? `внешность: ${n.appearance}` : '', n.personality ? `характер: ${n.personality}` : '',
          n.voiceStyle ? `голос: ${n.voiceStyle}; образцов реплик: ${(n.voiceSamples || []).length}` : '', n.mood ? `настроение: ${n.mood}` : ''].filter(Boolean);
        const empty = [];
        if (!n.description || !n.description.trim()) empty.push('описание');
        if (!n.personality || !n.personality.trim()) empty.push('характер');
        if (!n.wants || !n.wants.trim()) empty.push('желание');
        if (!n.voiceStyle || !n.voiceStyle.trim()) empty.push('голос');
        return `${n.name} — отношение: ${n.attitude || '—'}; статус: ${n.status || '—'}${n.bound ? ' (всегда с героем)' : ''}${lockNote}` +
          (depth.length ? `\n    ${depth.join('; ')}` : '') +
          (current.length ? `\n    записано: ${current.join(' | ')}` : '') +
          (empty.length ? `\n    пусто: ${empty.join(', ')} — заполни, только если это видно из фрагмента` : '');
      }).join('\n') + (fadedNames.length ? `\nДавно не появлялись: ${fadedNames.join(', ')}.` : '')
    : '(пока никого)';
  const action = lastPlayerAction(state);

  const openThreads = (state.threads || []).filter((t) => t.status === 'open');
  const closedThreads = (state.threads || []).filter((t) => t.status !== 'open').slice(-6);
  let threadsNote = openThreads.length
    ? '\n\nОТКРЫТЫЕ НИТИ (обновляй по этим названиям, не заводи похожих):\n' +
      openThreads.map((t) => `${t.title}${t.progress ? ' — ' + t.progress : ''}`).join('\n')
    : '';
  if (closedThreads.length) {
    threadsNote += '\n\nЗАКРЫТЫЕ НИТИ (не заводи заново): ' +
      closedThreads.map((t) => `${t.title} (${t.status === 'done' ? 'решена' : 'упущена'})`).join('; ');
  }
  // Безымянные: если во фрагменте может прозвучать имя, показываем их целиком —
  // внешность, описание, где виделись, — и предыдущий фрагмент. Иначе связать
  // «рыжую в красном плаще» с «Меня зовут Лира» учётчику не с чем.
  let unnamedNote = '';
  const unnamed = liveNpcs.filter((n) => isUnnamedName(n.name))
    .sort((a, b) => (b.updatedTurn || 0) - (a.updatedTurn || 0)).slice(0, 6);
  if (unnamed.length && mayIntroduceNpc(state, narration)) {
    const cut = (t, k) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > k ? x.slice(0, k - 1) + '…' : x; };
    unnamedNote = '\n\nЗАПИСАНЫ БЕЗ ИМЕНИ — если во фрагменте названо имя кого-то из них, вызови npc с ИМЕНЕМ ЭТОЙ ЗАПИСИ и new_name, а не заводи нового:\n' +
      unnamed.map((n) => `${n.name}: ` + [
        n.appearance ? `внешность — ${cut(n.appearance, 220)}` : '',
        n.description ? `кто — ${cut(n.description, 140)}` : '',
        n.status ? `где — ${cut(n.status, 80)}` : '',
        n.history ? `было — ${cut(n.history, 140)}` : '',
        `последний раз — ход ${n.updatedTurn || 0}`,
      ].filter(Boolean).join('; ')).join('\n');
    // Предыдущий фрагмент рассказа — только для опознания, не для повторного учёта.
    const narrNorm = String(narration || '').trim();
    const prev = [...(state.messages || [])].reverse().find((m) => m.role === 'assistant' && !m.ooc &&
      typeof m.content === 'string' && m.content.trim() && !narrNorm.includes(m.content.trim().slice(0, 80)) && !m.content.includes(narrNorm.slice(0, 80)));
    if (prev) {
      const t = prev.content.trim();
      unnamedNote += '\n\nПРЕДЫДУЩИЙ ФРАГМЕНТ — только чтобы узнать, кто есть кто. Всё из него уже учтено: НЕ записывай его заново.\n' +
        (t.length > 1400 ? '…' + t.slice(-1399) : t);
    }
  }

  const chronNote = chronicleForSync(state.events || [], state.scene);
  const archived = (state.npcs || []).filter((n) => n.archived).map((n) => n.name);
  const archiveNote = archived.length ? `\n\nВ АРХИВЕ (вернётся сам, если снова появится — просто npc по имени): ${archived.join(', ')}` : '';
  const userContent =
    'ПОСЛЕДНИЙ ФРАГМЕНТ ИСТОРИИ:' +
    (action ? `\nДействие игрока (${active ? active.name : '—'}): ${action}` : '') +
    `\nРассказчик: ${narration}` +
    '\n\n' + sceneForSync(state.scene) +
    '\n\nЛИСТЫ ГЕРОЕВ:\n' + sheets +
    '\n\nНПС:\n' + npcLines + archiveNote + unnamedNote +
    threadsNote +
    (chronNote ? '\n\n' + chronNote : '') +
    hygiene;

  const messages = [
    { role: 'system', content: composeSyncSystem(state, narration) },
    { role: 'user', content: userContent },
  ];
  const tools = [...toolsFor(state), NOTHING_TOOL];

  // Раунд 1 — обязательный вызов (либо изменения, либо nothing), чтобы модель
  // не «молчала» вместо работы. Раунд 2 — только если инструменты ответили
  // ошибкой/предупреждением или ответ оборвался: иначе подсказки инструментов
  // («это дубль», «нить закрыта») уходили в пустоту.
  for (let round = 0; round < 2; round++) {
    const data = await callOpenRouter({
      purpose: `учётчик, раунд ${round + 1}`,
      model: model || toolModelOf(state), messages, apiKey, tools, temperature: 0.2, timer,
      toolChoice: round === 0 ? 'required' : 'auto',
    });
    const msg = data?.choices?.[0]?.message;
    if (!msg) break;
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const leaked = parseLeakedToolCalls(msg.content);
      for (const c of leaked) {
        journal.push(journalEntry(c.name, c.args, executeTool(c.name, c.args, state), round + 1, { leaked: true }));
      }
      // Обязательный вызов, а модель ответила прозой — в журнале это должно быть видно,
      // иначе выглядит как «записывать нечего».
      if (round === 0 && !leaked.length) {
        const said = String(msg.content || '').trim();
        journal.push({ name: 'ответ без вызовов', args: {}, result: 'Учётчик ответил текстом вместо вызовов — ничего не записано.' + (said ? ` Ответ: «${said.slice(0, 200)}»` : ''), round: 1, warn: true, check: true });
      }
      break;
    }
    messages.push(msg);
    let needsFix = false;
    for (const call of calls) {
      let args = {};
      let result;
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { result = 'Ошибка: аргументы не разобрать — некорректный JSON.'; }
      if (result === undefined) result = executeTool(call.function.name, args, state);
      journal.push(journalEntry(call.function.name, args, result, round + 1));
      if (FIX_SIGNAL.test(result)) needsFix = true;
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    const cut = data?.choices?.[0]?.finish_reason === 'length';
    if (round > 0) break;
    // Второй раунд — один на всё: исправить ошибки, дописать оборванное, добрать пропущенное.
    const parts = [];
    if (needsFix) parts.push('Часть вызовов вернула ошибку или предупреждение — смотри ответы выше. Исправь это; остальное уже применено.');
    if (cut) parts.push('Ответ оборвался. Допиши недостающие вызовы; сделанные не повторяй.');
    if (!cut) {
      const parsed = calls.map((c) => { try { return { name: c.function?.name, args: JSON.parse(c.function?.arguments || '{}') }; } catch { return { name: c.function?.name }; } });
      const gaps = completenessHints(state, narration, parsed);
      if (gaps.length) {
        journal.push({ name: 'проверка полноты', args: {}, result: gaps.join(' '), round: 1, warn: true, check: true });
        parts.push('ПРОВЕРКА ПОЛНОТЫ. Возможно, пропущено:\n- ' + gaps.join('\n- ') + '\nДобавь только недостающие вызовы; сделанное не повторяй.');
      }
    }
    if (!parts.length) break;
    messages.push({ role: 'user', content: parts.join('\n\n') + '\nЕсли исправлять и добавлять нечего — вызови nothing.' });
  }
  return journal;
}

// Учёт для текста, появившегося вне обычного хода (например, «Договорить»).
// force — не судить по длине: дописанный хвост короткий, но в нём может быть находка.
export async function syncNarration({ state, apiKey, narration, force = false }) {
  const journal = [];
  const timer = [];
  if (state.stateSync === false || !String(narration || '').trim() || (!force && !syncWorthwhile(state, narration))) return { status: 'skipped', calls: journal, timing: timer };
  try {
    await syncState(state, apiKey, narration, journal, { timer });
    return { status: 'done', calls: journal, timing: timer };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e).slice(0, 200), calls: journal, timing: timer };
  }
}

// Повторный учёт хода (кнопка «переучесть»): мир уже откачен к состоянию
// до учёта, текст хода — как есть (возможно, исправленный игроком).
export async function resyncNarration({ state, apiKey, narration, model }) {
  const journal = [];
  const used = (model && model.trim()) || toolModelOf(state);
  const timer = [];
  try {
    await syncState(state, apiKey, narration, journal, { model: used, timer });
    return { status: 'done', calls: journal, model: used, resynced: true, timing: timer };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e).slice(0, 200), calls: journal, model: used, resynced: true, timing: timer };
  }
}
