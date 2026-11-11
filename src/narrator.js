// Шаг рассказа: системный промт рассказчика (мир, сцена, герои, НПС, хроника,
// лорбук) и сам запрос — с броском кубика, если он включён.

import { partyOf } from './relations.js';
import { viewMessages, stamp } from './lines.js';
import { ROLL_TOOL, toolsFor, executeTool, resolveCharacterFor } from './tools.js';
import { rollCheck, describeRoll } from './dice.js';
import { traitModifier } from './traits.js';
import { competenceMod } from './skills.js';
import { statusRollMod, describeStatus, statusCatalogOf } from './statuses.js';
import { recordRoll } from './progress.js';
import { sceneBlock } from './scene.js';
import { chronicleBlock } from './chronicle.js';
import { callOpenRouter, stripToolMarkup, applyLeakedCalls } from './llm.js';
import { journalEntry } from './journal.js';

const MAX_TOOL_ROUNDS = 6;

// Сложность — про мир: везение, цену ошибок, опасность. Отношение персонажей к герою от неё
// не зависит (раньше «Беспощадный» требовал враждебности по умолчанию — получалась карикатура,
// а «Обычный» без указаний скатывался в услужливость; см. PEOPLE_RULES).
const DIFFICULTY_DIRECTIVES = {
  story:
    'Уровень сложности: МЯГКИЙ.\n' +
    '- Удача: мир скорее на стороне героя, случай нередко выручает.\n' +
    '- Цена ошибки: неудачи откатывают назад, но не ломают историю; потери восполнимы.\n' +
    '- Опасность: угрозы настоящие, но гибель героя почти исключена — вместо неё плен, ранение, бегство.',
  normal:
    'Уровень сложности: ОБЫЧНЫЙ.\n' +
    '- Удача: случай нейтрален, совпадения не подыгрывают ни герою, ни против него.\n' +
    '- Цена ошибки: необдуманные действия дают ощутимые последствия — раны, траты, упущенные возможности.\n' +
    '- Опасность: смерть возможна только после явного смертельного риска, который герой выбрал сам.',
  hard:
    'Уровень сложности: СУРОВЫЙ.\n' +
    '- Удача: удобных совпадений в пользу героя не бывает; что не подготовлено, то идёт не так.\n' +
    '- Цена ошибки: последствия весомые и надолго — раны заживают медленно, потерянное не возвращается само.\n' +
    '- Опасность: бой и риск реально могут стоить жизни; не смягчай исход, если он логичен.',
  brutal:
    'Уровень сложности: БЕСПОЩАДНЫЙ.\n' +
    '- Удача: никаких спасений в последний миг и сюжетного иммунитета.\n' +
    '- Цена ошибки: рискованное и необдуманное часто проваливается; потери, увечья и срыв целей — обычное дело.\n' +
    '- Опасность: смерть героя — возможный исход любой серьёзной схватки или авантюры.',
};

// Короткое напоминание в конце хода для суровых режимов (рычаг рекентности) — только про мир.
const DIFFICULTY_REMINDER = {
  hard: '[Напоминание: суровый режим — совпадения не подыгрывают герою, последствия весомые и надолго.]',
  brutal: '[Напоминание: беспощадный режим — никаких спасений в последний миг, провал и потери возможны всегда.]',
};

// Как ведут себя люди мира — одинаково на любой сложности. Без этого модели по умолчанию
// услужливы: каждый встречный идёт навстречу и сам ищет компромисс.
const PEOPLE_RULES =
  'ЛЮДИ ЭТОГО МИРА (на любой сложности):\n' +
  '• У каждого свои дела и свой интерес в разговоре; герой для них — один из многих, не центр мира. Персонаж действует в своих интересах.\n' +
  '• С незнакомцем — вежливо и по-деловому: не тепло и не враждебно. Тепло, доверие и неприязнь вырастают из характера персонажа, его истории и поступков героя.\n' +
  '• Помощь, сведения, уступка, риск ради героя чего-то стоят — денег, услуги, времени, доверия. Даром — только когда это выгодно самому персонажу, в его характере или он чем-то обязан. Персонаж называет свою цену.\n' +
  '• Персонаж вправе отказать, поставить условие, поторговаться, потянуть время, сказать полуправду, если ему так выгоднее. Компромисс — итог торга, а не первая реакция; не уступай только потому, что просит игрок.\n' +
  '• Это не вражда: без причины не хамят, не нападают и не мешают из вредности; обычная вежливость и здравый смысл остаются. Давление, угрозы, ложь героя — реакция по характеру: кто испугается, кто упрётся, кто запомнит.';

// Кто это — коротко, для однострочной записи отсутствующего НПС: первая фраза
// описания, не длиннее ~80 знаков, по границе слова. Иначе рассказчик помнит
// только имя и не знает, что «Эдмунд» — брат-близнец героини.
export function whoShort(n, limit = 80) {
  const d = String(n.description || '').replace(/\s+/g, ' ').trim();
  if (!d) return '';
  let first = d.split(/(?<=[.!?…])\s/)[0].replace(/[.!?…]+$/, '');
  if (first.length > limit) first = first.slice(0, limit).replace(/[\s,;:—-]+\S*$/, '') + '…';
  return first;
}

// ---- Лорбук ----
// Записи подставляются в контекст только когда их ключи упомянуты в недавних
// ходах — так мир не занимает контекст целиком.

export { keyMatches } from './narrator-keys.js';
import { codexBlock, renderCodex, hasCodex, LOOKUP_TOOL, lookupCodex } from './codex.js';


const NARRATION_DIRECTIVES = {
  third:
    'ЛИЦО ПОВЕСТВОВАНИЯ: третье. Описывай героя со стороны, по имени и в третьем лице («Кейн шагнул к двери»). ' +
    'Не обращайся к игроку напрямую.',
  second_ty:
    'ЛИЦО ПОВЕСТВОВАНИЯ: второе, на «ты». Обращайся к активному герою напрямую и неформально ' +
    '(«ты шагаешь к двери», «холод обжигает тебе руки»).',
  second_vy:
    'ЛИЦО ПОВЕСТВОВАНИЯ: второе, на «вы». Обращайся к активному герою напрямую и уважительно ' +
    '(«вы шагаете к двери», «холод обжигает вам руки»). Держи это обращение последовательно во всём тексте.',
};

// Снимок для повествования: "Здоровье 55/100; Отравлен; Факел".
function sheetSnapshot(character, catalog) {
  if (!character.blocks.length) return 'лист пуст';
  return character.blocks
    .map((b) => {
      if (b.type === 'status') return describeStatus(catalog || [], b);
      if (b.type === 'stat' && b.max != null) return `${b.name} ${b.value ?? '?'}/${b.max}`;
      if (b.value) return `${b.name} — ${b.value}`;
      return b.name;
    })
    .join('; ');
}

function threadsBlock(state) {
  const open = (state.threads || []).filter((t) => t.status === 'open');
  if (!open.length) return '';
  let s = '=== ОТКРЫТЫЕ НИТИ ===\n';
  s += 'Это то, что тянется через историю. Не давай нитям провисать: время от времени подбрасывай зацепку, ' +
    'напоминание или осложнение по одной из них. Не решай их за игрока.\n';
  s += open.map((t) => {
    let line = `• ${t.title}`;
    if (t.progress) line += ` — ${t.progress}`;
    if (t.notes) line += `\n  Известно: ${tailItems(t.notes, 4, 400)}`;
    return line;
  }).join('\n');
  return s;
}

function heroesBlock(state) {
  const active = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  // В контекст идёт только тот, кем играют, и спутники, отмеченные как
  // присутствующие. Остальные заведены «про запас» и в истории их нет.
  const inScene = partyOf(state);
  const companions = inScene.filter((c) => c.id !== active?.id);

  let s = '=== ГЕРОЙ ===\n';
  s += `Игрок управляет героем: ${active ? active.name : '—'}.`;
  if (companions.length) {
    s += ` Рядом с ним: ${companions.map((c) => c.name).join(', ')}.`;
  } else {
    s += ' Он один — других играбельных героев в истории сейчас нет, не упоминай их.';
  }
  for (const c of inScene) {
    s += `\n\n• ${c.name}${active && c.id === active.id ? ' (активный)' : ''}`;
    if (c.persona && c.persona.trim()) s += `\n  ${c.persona.trim()}`;
    const card = [];
    if (c.aliases && c.aliases.length) card.push(`прежде звался: ${c.aliases.join(', ')} — кто знал его раньше и не слышал о перемене, зовёт по-старому`);
    if (c.race && c.race.trim()) card.push(`раса: ${c.race.trim()}`);
    if (c.social && c.social.trim()) card.push(`положение: ${c.social.trim()}`);
    if (card.length) s += `\n  ${card.join('; ')}`;
    if (c.appearance && c.appearance.trim()) s += `\n  Внешность: ${c.appearance.trim()}`;
    const changes = (c.appearanceLog || []).filter((e) => e && e.text);
    if (changes.length) {
      s += '\n  Недавние перемены (внешность, раса, имя — о них знают только видевшие): ' + changes.map((e) =>
        `«${e.text}» — ход ${e.turn}, видели: ${e.seenBy && e.seenBy.length ? e.seenBy.join(', ') : 'никто из НПС'}`).join('; ');
    }
    s += `\n  Лист: ${sheetSnapshot(c, statusCatalogOf(state))}`;
  }
  if (inScene.some((c) => (c.blocks || []).some((b) => b.type === 'ability'))) {
    s += '\n\nУМЕНИЯ — НЕ ТОЛЬКО БОНУС К БРОСКУ. Это ещё и то, что герой замечает, понимает и умеет без проверки: ' +
      'медик по ране поймёт, чем и когда её нанесли; взломщик с одного взгляда оценит замок; фехтовальщик узнает школу противника. ' +
      'Давай такие сведения и возможности сам, когда умение уместно. Без подходящего умения — только то, что видно любому, ' +
      'а сложное действие требует проверки. Уровень умения задаёт глубину: новичок — общее, мастер — тонкости.';
  }
  if (heroMultiplayer(state)) {
    const others = state.characters.filter((c) => c.id !== active?.id);
    s += '\n\nНЕСКОЛЬКО ГЕРОЕВ. Игрок ведёт историю то за одного героя, то за другого. В истории каждый ход помечен: [Ход за героя …], ' +
      'а чужие эпизоды — [Эпизод героя …]. «Ты» в каждом фрагменте — тот герой, за которого был ход.\n' +
      `Сейчас «ты» — ${active ? active.name : 'активный герой'}. Не переноси на него то, что случилось с другими: раны, предметы, ` +
      'знакомства, обещания, увиденное и услышанное. Он знает о чужих эпизодах, только если был рядом или ему рассказали в сцене. ' +
      'НПС из чужого эпизода не знают его, если не встречали. Свой ответ пометкой не начинай.';
    const where = others.filter((c) => c.scene && c.scene.location).map((c) => `${c.name} — последний раз: ${c.scene.location}`);
    if (where.length) s += '\n' + where.join('; ') + '.';
  }
  return s;
}

// Накопительное поле («было с героем», заметки нити) растёт всю игру — в промт идут последние пункты.
// Полностью оно хранится в карточке; давнее и так есть в предыстории и хронике.
export function tailItems(text, n, maxChars) {
  const items = String(text || '').split(/;\s+/).map((x) => x.trim()).filter(Boolean);
  let out = items.length > n ? ['…', ...items.slice(-n)] : items;
  let joined = out.join('; ');
  while (joined.length > maxChars && out.length > 2) { out = ['…', ...out.slice(2)]; joined = out.join('; '); }
  return joined.length > maxChars ? '…' + joined.slice(-maxChars) : joined;
}

const RECENT_NPC_TURNS = 30; // сколько ходов НПС остаётся «на виду» после последней встречи

function npcBlock(state) {
  const npcs = (state.npcs || []).filter((n) => !n.archived);
  if (!npcs.length) return '';

  // Полная карточка — только тем, кто в недавних ходах; остальным одна строка.
  // Иначе с богатыми карточками контекст пухнет на каждом персонаже.
  const recent = viewMessages(state).slice(-6)
    .filter((m) => typeof m.content === 'string')
    .map((m) => m.content.toLowerCase()).join('\n');
  const present = (state.scene && state.scene.present || []).map((x) => x.toLowerCase());
  const inScene = (n) => {
    const first = n.name.toLowerCase().split(/\s+/)[0];
    if (n.bound) return true; // спутник, голос в голове — всегда с героем
    if (npcs.length <= 5) return true;
    // Сцена ведётся — список «рядом» и есть ответ, кто в сцене.
    if (present.length) return present.some((p) => p.includes(first) || n.name.toLowerCase().includes(p));
    // Сцены ещё нет — запасной способ: упоминался в недавних ходах.
    return first.length >= 3 && recent.includes(first);
  };

  let s = '=== ВСТРЕЧЕННЫЕ ПЕРСОНАЖИ (НПС) ===\n';
  s += 'Держи их характеры, знания и отношение к игроку консистентными. ' +
    'Говори за каждого его собственным голосом: следуй записанному характеру и манере речи, ' +
    'персонажи не должны звучать одинаково.\n' +
    'КАК ИГРАТЬ ПЕРСОНАЖА: у него есть своё желание — он двигает его в каждой сцене, ' +
    'герой для него помеха или средство, а не центр мира. Если есть тайна — НЕ раскрывай её, ' +
    'играй через оговорки, странные реакции, недомолвки; герой может заметить неладное, ' +
    'если присмотрится (это повод для проверки «Проницательность»). Изюминка — не упоминай, а показывай. ' +
    'Тайна — это то, что персонаж прячет ради СЕБЯ; она не повод утаивать имена, адреса и сведения, ' +
    'которые герою нужны для дела и которые персонаж сам заинтересован сообщить.\n';

  // На долгой игре знакомых десятки. Строку получает тот, кто рядом, недавно встречался,
  // упомянут в последних ходах или связан с открытым обязательством; остальные — только по имени.
  const turn = state.turn || 0;
  const owes = new Set((state.events || []).filter((e) => e.status === 'open' && ['promise', 'debt', 'plan'].includes(e.type))
    .flatMap((e) => e.participants || []).map((x) => String(x).toLowerCase().split(/\s+/)[0]));
  const relevant = (n) => {
    const first = n.name.toLowerCase().split(/\s+/)[0];
    if (inScene(n)) return true;
    const last = n.lastSeen ? n.lastSeen.turn : n.updatedTurn;
    if (Number.isFinite(last) && turn - last <= RECENT_NPC_TURNS) return true;
    if (first.length >= 3 && recent.includes(first)) return true;
    return owes.has(first);
  };
  const shown = npcs.filter(relevant);
  const faded = npcs.filter((n) => !relevant(n));

  s += shown.map((n) => {
    let line = `• ${n.name}`;
    const meta = [];
    if (n.bound) meta.push('ВСЕГДА С ГЕРОЕМ — не в списке присутствующих, но в каждой сцене: слышит, видит, вставляет реплики');
    if (n.attitude) meta.push(`отношение: ${n.attitude}`);
    if (n.race) meta.push(`народ: ${n.race}`);
    if (n.status) meta.push(`статус: ${n.status}`);
    // Давно не виделись — значит, не знает, что с героем было потом.
    const here = (state.scene && state.scene.present || []).some((p) => p.toLowerCase().split(/\s+/)[0] === n.name.toLowerCase().split(/\s+/)[0]);
    // Несколько героев: отношения у каждого свои — с этим героем персонаж мог и не встречаться.
    const stranger = state.characters.length > 1 && !here && !n.bound && !n.lastSeen && !n.attitude && !n.history;
    if (stranger) meta.push('с этим героем не встречался — не знает его в лицо и ничего ему не должен');
    else if (n.lastSeen && !here && !n.bound) meta.push(`последняя встреча с героем: день ${n.lastSeen.day} (ход ${n.lastSeen.turn})`);
    // Старые партии: встреч ещё не отмечали — хотя бы когда персонаж последний раз был в деле.
    else if (!n.lastSeen && !here && !n.bound && n.updatedTurn && (state.turn || 0) - n.updatedTurn >= 5) meta.push(`последний раз в истории: ход ${n.updatedTurn}`);
    if (meta.length) line += ` — ${meta.join('; ')}`;
    if (!inScene(n)) {
      const who = whoShort(n);
      return line + (who ? ` · ${who}` : '') + (n.quirk ? ` (${n.quirk})` : '');
    }

    if (n.description) line += `\n  ${n.description}`;
    if (n.appearance) line += `\n  Внешность: ${n.appearance}`;
    if (n.traits && n.traits.length) line += `\n  Черты: ${n.traits.join(', ')}`;
    if (n.competence && n.competence !== 'обычный') line += `\n  Умелость: ${n.competence}${(n.skills || []).length ? ' — ' + n.skills.join(', ') : ''} (против этого героя проверки труднее)`;
    else if ((n.skills || []).length) line += `\n  Умеет: ${n.skills.join(', ')}`;
    if (n.personality) line += `\n  Характер и речь: ${n.personality}`;
    if (n.quirk) line += `\n  Изюминка: ${n.quirk}`;
    if (n.wants) line += `\n  ХОЧЕТ: ${n.wants}`;
    // «Играет сам»: тайну знает только он — рассказчику её не показываем, проболтаться нечем.
    if (n.secret && n.self) line += '\n  СКРЫВАЕТ: что-то своё — что именно, знает только он сам. Не выдумывай и не раскрывай за него.';
    else if (n.secret) line += `\n  СКРЫВАЕТ (герой не знает): ${n.secret}`;
    if (n.links) line += `\n  Связи: ${n.links}`;
    if (n.history) line += `\n  Было с героем: ${tailItems(n.history, 4, 500)}`;
    const voice = [n.voiceStyle ? `манера: ${n.voiceStyle}` : '', n.voiceHumor ? `юмор: ${n.voiceHumor}` : '', n.voiceHabits ? `привычки: ${n.voiceHabits}` : ''].filter(Boolean);
    if (voice.length) line += `\n  ГОЛОС — ${voice.join('; ')}`;
    if (n.voiceMasks) line += `\n  Как прячет чувства: ${n.voiceMasks}`;
    if (n.voiceTaboos) line += `\n  В речи никогда: ${n.voiceTaboos}`;
    if (Array.isArray(n.voiceSamples) && n.voiceSamples.length) {
      line += `\n  Как звучит (образцы интонации, НЕ повторяй дословно): ` + n.voiceSamples.slice(-3).map((s) => `«${s}»`).join(' ');
    }
    if (n.mood) line += `\n  НАСТРОЕНИЕ СЕЙЧАС: ${n.mood}${n.moodReason ? ` — потому что ${n.moodReason}` : ''}. Оно держится, пока нет причины измениться; характер при этом не исчезает.`;
    return line;
  }).join('\n');
  if (faded.length) {
    s += `\nДавно не появлялись (подробности вернутся, когда снова встретятся; о недавних событиях с героем они не знают): ${faded.map((n) => n.name).join(', ')}.`;
  }
  return s;
}


// Решения персонажей, которые «играют сами» (src/voices.js), — на один ход, в конце запроса.
function voicesBlock(state) {
  const voices = state._voices || [];
  if (!voices.length) return '';
  let s = '=== ПЕРСОНАЖИ, КОТОРЫЕ РЕШИЛИ САМИ ===\n' +
    'Этих персонажей в этот ход сыграл отдельный исполнитель — у него их память и тайны. Впиши их решение в сцену как есть: ' +
    'намерение не меняй, реплику приведи близко к тексту (можно разбить ремарками и продолжить в том же духе, если разговор идёт дальше). ' +
    'Что персонаж скрывает, ты не знаешь — покажи только то, что заметно снаружи. Исход действий героя и проверок по-прежнему решаешь ты; ' +
    'если действие героя до персонажа не дошло — реплику опусти. ' +
    'Это поступки и слова самих персонажей, не героя: не приписывай их герою и не вкладывай ему в уста.\n';
  s += voices.map((v) => {
    const bits = [];
    if (v.decision) bits.push(`делает: ${v.decision}`);
    if (v.line) bits.push(`его слова: «${v.line}»`);
    if (v.tell) bits.push(`снаружи заметно: ${v.tell}`);
    return `• ${v.name} (персонаж, не герой) — ${bits.join('; ')}`;
  }).join('\n');
  return s;
}

// Системный контекст для ШАГА РАССКАЗА.
// В двухпроходном режиме рассказчику инструменты недоступны — раздел базового
// промта про управление листами тогда только противоречит хвосту. Убираем его.
function narratorPrompt(state, withTools) {
  const p = String(state.systemPrompt || '').trim();
  if (withTools) return p;
  const i = p.search(/^Управление листами героев:/m);
  return i === -1 ? p : p.slice(0, i).trim();
}

export function composeStorySystem(state, opts = {}) {
  return storyPromptSections(state, opts).map((s) => s.text).join('\n\n');
}

// Раскладка запроса. «cache» (по умолчанию): неизменное (правила, мир, сценарий, предыстория) —
// системным сообщением в начале, изменчивое (кодекс, сцена, листы, НПС) — в конце, перед ходом игрока.
// Тогда начало запроса и вся история совпадают от хода к ходу, и провайдер берёт их из кэша.
// «classic» — как было: всё одним системным сообщением (оно менялось каждый ход, и кэш не работал).
export const promptLayoutOf = (state) => (state.promptLayout === 'classic' ? 'classic' : 'cache');

const LATE_OPEN = '[СОСТОЯНИЕ МИРА НА ЭТОТ ХОД — служебные данные для рассказчика. Игрок этого не писал; не пересказывай и не цитируй их, а опирайся на них.]';
const LATE_CLOSE = '[КОНЕЦ СЛУЖЕБНЫХ ДАННЫХ]';

// Запрос по частям: system — постоянная часть, late — блок состояния для конца запроса ('' в прежней раскладке).
export function storyRequestParts(state, opts = {}) {
  const layout = promptLayoutOf(state);
  const sections = storyPromptSections(state, { ...opts, layout });
  if (layout === 'classic') return { system: sections.map((s) => s.text).join('\n\n'), late: '' };
  const system = sections.filter((s) => !s.late).map((s) => s.text).join('\n\n');
  const late = sections.filter((s) => s.late).map((s) => s.text).join('\n\n');
  return { system, late: late ? `${LATE_OPEN}\n\n${late}\n\n${LATE_CLOSE}` : '' };
}

// Сообщения запроса рассказчику: система + история + (в раскладке «cache») состояние мира и заметки
// в последней реплике игрока. В сохранённую историю блок состояния не попадает.
export function storyMessages(state, opts = {}, notes = []) {
  const { system, late } = storyRequestParts(state, opts);
  const messages = [{ role: 'system', content: system }, ...labelHeroes(state, viewMessages(state))];
  const last = messages[messages.length - 1];
  const extra = notes.filter(Boolean).join('\n');
  if (last && last.role === 'user' && typeof last.content === 'string') {
    let content = last.content;
    if (late) content = `${late}\n\nХОД ИГРОКА:\n${content}`;
    if (extra) content += `\n\n${extra}`;
    messages[messages.length - 1] = { ...last, content };
  } else if (late) {
    messages.push({ role: 'user', content: late + (extra ? `\n\n${extra}` : '') });
  }
  return messages;
}

// Промт рассказчика по разделам — для сборки и для разбора размера в «Диагностике».
// layout 'cache' — постоянные разделы первыми, изменчивые помечены late (уйдут в конец запроса).
export function storyPromptSections(state, { withTools = false, layout = 'classic' } = {}) {
  const parts = [];
  const cache = layout === 'cache';
  const add = (label, text, late = false) => { if (text) parts.push(cache ? { label, text, late } : { label, text }); };
  add('Промт рассказчика (настройки)', narratorPrompt(state, withTools));
  if (state.worldPrompt && state.worldPrompt.trim()) add('Мир', '=== МИР ===\n' + state.worldPrompt.trim());
  if (state.scenarioPrompt && state.scenarioPrompt.trim()) add('Сценарий', '=== СЦЕНАРИЙ ===\n' + state.scenarioPrompt.trim());
  if (state.summary && state.summary.trim()) {
    add('Предыстория', '=== ПРЕДЫСТОРИЯ (что уже произошло) ===\n' + state.summary.trim());
  }
  add('Кодекс мира', codexBlock(state), true);
  add('Нити', threadsBlock(state), true);
  const chron = chronicleBlock(state.events || [], {
    sceneNames: [
      ...partyOf(state).map((c) => c.name),
      ...((state.scene && state.scene.present) || []),
      ...(state.npcs || []).filter((n) => n.bound && !n.archived).map((n) => n.name),
    ],
    recentText: viewMessages(state).slice(-4).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'),
    scene: state.scene,
  });
  add('Хроника (выборка)', chron, true);
  add('Сцена', sceneBlock(state.scene, state), true);
  add('Герои', heroesBlock(state), true);
  add('НПС', npcBlock(state), true);
  add('Решения персонажей', voicesBlock(state), true);

  // Финальный блок — самый весомый: он ближе всего к генерации.
  const directive = DIFFICULTY_DIRECTIVES[state.difficulty] || DIFFICULTY_DIRECTIVES.normal;
  let tail = '=== КАК ВЕСТИ ЭТОТ ХОД ===\n' + directive + '\n\n';
  if (withTools) {
    tail +=
      'Строго веди учёт состояния: любое ранение, получение или трата предмета, изменение показателя или ' +
      'отношений сразу отражай вызовом инструмента над листом нужного героя (указывай character — имя героя). ' +
      'Лучше вызвать инструмент лишний раз, чем оставить лист неактуальным.';
  } else {
    tail +=
      `Веди только повествование. Опирайся на состояние ${cache ? 'мира (служебный блок перед ходом игрока)' : 'выше'}, но не описывай игровую механику ` +
      'и не пиши служебных пометок — учёт инвентаря, статусов и характеристик ведёт отдельная система. ' +
      'На этом шаге инструменты недоступны: НЕ выводи никаких вызовов инструментов, тегов invoke/function/tool_call ' +
      'и любой служебной разметки — только художественный текст истории.';
  }
  tail += '\n\n' + PEOPLE_RULES;
  tail += '\n\n' + (NARRATION_DIRECTIVES[state.narration] || NARRATION_DIRECTIVES.second_ty) +
    ' Это указание имеет приоритет: если выше в промте рассказчика сказано иначе, следуй именно этому.';
  tail += ' Пиши только на русском языке, живым и естественным слогом, без иностранных слов и без дословных повторов. ' +
    '\n\nЖИВАЯ РЕЧЬ И ХАРАКТЕР:\n' +
    '• Диалог — устная речь, а не литература: допустимы недосказанность, перебивания, оговорки, смена темы, насмешка, ответ не на тот вопрос. ' +
    'Запрещены: искусственно драматичные рубленые фразы («Нет. Не выход. Ловушка.»), повторяющиеся риторические конструкции, напыщенность, афоризмы, ' +
    'и одинаково правильная, вежливая, эмоционально зрелая речь у всех. Персонаж может быть груб, глуп, легкомыслен, вульгарен, непоследователен — если он такой.\n' +
    '• Не каждая реплика обязана двигать сюжет или нести информацию. Персонаж вправе заговорить первым, пошутить, пожаловаться, заметить нелепость, ' +
    'отвлечься на хорошенькую трактирщицу, рассказать историю — когда ситуация к этому располагает. Болтовня, флирт, ссора, неловкость — полноценные сцены.\n' +
    '• Характер НПС не выцветает с ходами. Серьёзные события меняют настроение, но не стирают юмор, манеру и словечки. ' +
    'Одно и то же чувство каждый выражает по-своему: один прячет страх за сарказмом, другой начинает командовать, третий замолкает — смотри «как прячет чувства» в карточке.\n' +
    '• Настроение имеет причину и инерцию: обиду не забывают через две реплики, но и игривость не исчезает оттого, что десять ходов были серьёзными.\n' +
    '• Образцы реплик в карточке — камертон, не цитатник: держи интонацию, придумывай новое. Не повторяй шутки и обороты; не делай каждую реплику остроумной — ' +
    'меткая шутка на фоне обычного разговора бьёт сильнее, чем фейерверк.\n\n' +
    'АВТОРСКИЙ ТЕКСТ БЕЗ ШТАМПОВ:\n' +
    '• Без противопоставлений «не X, а Y» («Это был не страх. Это было узнавание», «не просто взгляд — обещание») — сразу Y. ' +
    'В репликах тоже: так может говорить разве что один персонаж, если это его манера, а не все подряд.\n' +
    '• Не объясняй, что всё значит («жест говорил больше слов», «что-то в его взгляде»): покажи деталь, вывод — за игроком.\n' +
    '• Не заканчивай абзац или ответ афоризмом («в этой тишине была вся правда»): последней фразой — событие или конкретная деталь.\n' +
    '• Фраза, которую можно без изменений перенести в любую сцену («тишина повисла», «воздух был тяжёлым»), — пустая: замени деталью этого места.\n\n' +
        'НЕПРОТИВОРЕЧИВОСТЬ (обязательно): прежде чем назвать любой конкретный факт — возраст, срок, число, ' +
    'родство, расстояние, время — сверься с карточками персонажей, сведениями о мире, предысторией, ' +
    'описаниями персонажей и недавними ходами. Если факт уже прозвучал, повтори его ТОЧНО так же. ' +
    'Не придумывай новых чисел и сроков там, где они уже названы, и следи, чтобы они не противоречили друг другу ' +
    '(например, кто здесь дольше, кто старше, сколько времени прошло). ' +
    'Если точное ЧИСЛО или СРОК неизвестны — лучше выразиться неопределённо («давно», «несколько лет»), чем назвать новое число.\n\n' +
    'ИМЕНА — исключение из этой осторожности: имена придумывай смело и сразу. Каждый новый персонаж, место, ' +
    'заведение или цель задания получают конкретное имя в тот момент, когда по сюжету оно должно быть известно: ' +
    'заказчик называет цель по имени, вывеска читается, стражник представляется, в письме стоит подпись. ' +
    'Не прячься за «тот человек», «некто», «цель» и не заставляй героя выпрашивать имя, если у говорящего нет ' +
    'причины его скрывать. Раз придумав имя — держись его. Скрывать имя можно только когда это сознательный ход ' +
    'персонажа или условие сюжета, и тогда покажи, что он скрывает его нарочно.\n\n' +
    'ПОСЛЕДСТВИЯ ДЛЯ ЛИСТА (обязательно): когда с героем что-то происходит телесно или в кармане — называй это так, чтобы было что записать. ' +
    'Рана — какая и насколько серьёзна; трата — сколько заплачено; предмет — израсходован, сломан, отдан или подобран; ' +
    'отдых и лечение — что именно восстановило силы. Не цифрами из листа, а ясными словами в тексте сцены.\n\n' +
    'ГЕРОЙ ПРИНАДЛЕЖИТ ИГРОКУ:\n' +
    '• Решения, слова, мысли и чувства героя задаёт игрок. Заявленное действие разыгрывай — заявленную реплику можно развернуть в прямую речь, — ' +
    'но не добавляй герою новых решений, обещаний, признаний и поступков, которых игрок не заявлял.\n' +
    '• Не проматывай за игрока выбор: дошёл до развилки или опасности — остановись там, а не решай за него и не описывай, чем всё кончилось.\n' +
    '• Игрок вправе заняться своим: зацепки по нитям предлагай, но не тяни его к ним силой и не наказывай за отказ.\n\n' +
    'ОФОРМЛЕНИЕ: только проза и реплики. Без заголовков, списков, жирного шрифта и пояснений от себя. ' +
    'Не предлагай в конце варианты действий («1. … 2. …», «Что ты будешь делать?») — игрок решит сам.\n\n' +
    'ЖИВАЯ СЦЕНА (обязательно):\n' +
    '• Игрок заявляет НАМЕРЕНИЕ, исход решаешь ты. Если игрок пишет «это было несложно», «мне поверили», «провёл вечер как положено» — ' +
    'это заявка, а не факт: разыграй её, а где исход не предрешён — запроси проверку. Перевоплощение, обман, убеждение среди ' +
    'внимательных людей — всегда проверка.\n' +
    '• Где есть люди — есть речь. В каждой сцене с персонажами хотя бы один живой обмен репликами прямой речью, с именами говорящих. ' +
    'Пересказ «он представился, они поговорили» вместо реплик — запрещён.\n' +
    '• «Провожу два часа», «осматриваюсь», «жду» — не повод для одной атмосферы: в таком отрезке что-то происходит — ' +
    'вопрос, чей-то интерес, осложнение, находка. Но событие — не обязательно опасность: спокойный разговор у костра, ' +
    'в котором спутник сказал то, чего раньше не говорил, — тоже событие. Не гони сюжет ради темпа; два тихих хода подряд допустимы, три — нет.\n' +
    '• Заканчивай ход не настроением, а точкой, где игроку есть что решить: событие, действие или решение персонажа, условие, угроза, пауза. Это не обязательно вопрос — не заканчивай каждый ответ вопросом к герою.\n' +
    '• Не переспрашивай решённое: если герой согласился или решил, никаких «уверен? точно? согласен?» — сразу действие и последствия. Персонаж спрашивает, только когда ему правда нужен ответ.\n' +
    '• В реплике через тире называй говорящего авторской ремаркой в той же строке («— …, — сказала Рита») — ' +
    'при первой реплике и при каждой смене говорящего. Безымянные «— сказал он» на три абзаца запрещены.\n' +
    '• Исключение — тишина по делу: слежка, скрытность, одиночество, подготовка. Там речь не нужна, но событие или наблюдение, ' +
    'меняющее положение героя, — всё равно нужно.';
  const direction = state.directorNote && state.directorNote.trim()
    ? 'НАПРАВЛЕНИЕ ОТ ИГРОКА (приоритет выше сценария — это то, куда он хочет вести историю; ' +
      'веди к этому через события и персонажей, не объявляя вслух): ' + state.directorNote.trim()
    : '';
  // Направление игрок меняет на ходу — в экономной раскладке оно идёт в конце, с состоянием мира.
  if (direction && !cache) tail += '\n\n' + direction;
  tail += '\n\nЗНАНИЕ ПЕРСОНАЖЕЙ: НПС знает о героях только то, что видел сам или услышал в сцене. Перемены во внешности, раны и события ' +
    'после его последней встречи с героем ему неизвестны — он не может о них говорить, пока не увидит или ему не расскажут (и тогда это слух с источником). ' +
    'Мотив из прошлых ходов (сон, ночь, примета) не повод для реплик сейчас: персонажи говорят о том, что происходит в этой сцене.';
  const tone = toneReminder(state);
  if (tone) {
    // Раньше здесь требовалось «тема в каждой сцене, в том числе репликами» — и персонажи
    // невпопад заговаривали о снах и ночи. Тема — направление, а не обязательная вставка.
    tail += '\n\nЖАНР И ТЕМЫ ЭТОЙ ИСТОРИИ: ' + tone +
      ' Это направление истории: пусть темы прорастают через события и выбор там, где сцена к этому располагает. ' +
      'Не вставляй их нарочно и не вкладывай в уста персонажей, которым неоткуда о них знать.';
  }
  add('Правила хода', tail);
  if (!cache) return parts;
  add('Направление от игрока', direction, true);
  // Постоянное — в порядке «реже меняется → чаще»: предыстория меняется при сжатии (тогда меняется и история).
  const rank = (p) => (p.late ? 2 : p.label === 'Предыстория' ? 1 : 0);
  return parts.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

// Строки сценария вида «Жанр: …», «Тон: …», «Темы: …» дублируются в самый конец
// промта: то, что ближе к генерации, модель держит крепче, а сценарий в середине
// длинного контекста легко «проседает».
function toneReminder(state) {
  const lines = String(state.scenarioPrompt || '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(жанр|тон|темы|тема|стиль|настроение|атмосфера)\s*:/i.test(l));
  return lines.length ? lines.join(' ') : '';
}

export function lastPlayerAction(state) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'user') return state.messages[i].content;
  }
  return '';
}

// Несколько героев: в истории помечаем, за кого был каждый ход. Повествование
// идёт на «ты», и без пометок модель после переключения считает «ты» из чужих
// эпизодов новым героем — путает раны, знакомства, обещания и знания.
export function heroMultiplayer(state) {
  // Смотрим на историю глазами активного героя: у героя со своей отдельной линией чужих эпизодов нет.
  const ids = new Set(viewMessages(state).map((m) => m.hero).filter(Boolean));
  return state.characters.length > 1 && (ids.size > 1 || [...ids].some((h) => h !== state.activeCharacterId));
}
export function labelHeroes(state, msgs) {
  if (!heroMultiplayer(state)) return msgs.map(({ hero, ...m }) => m);
  const nameOf = (id) => (state.characters.find((c) => c.id === id) || {}).name;
  const active = state.activeCharacterId;
  const activeName = nameOf(active) || 'герой';
  return msgs.map(({ hero, ...m }) => {
    if (!hero || m.ooc || typeof m.content !== 'string') return m;
    const who = nameOf(hero);
    if (!who) return m;
    if (m.role === 'user') return { ...m, content: `[Ход за героя ${who}] ${m.content}` };
    if (m.role === 'assistant' && hero !== active) {
      return { ...m, content: `[Эпизод героя ${who}: «ты» здесь — ${who}, не ${activeName}]\n${m.content}` };
    }
    return m;
  });
}
const stripHeroLabel = (t) => String(t || '').replace(/^\s*\[(?:Эпизод героя|Ход за героя)[^\]]*\]\s*/i, '');

// Описание броска со списком умений героев: модель выбирает из них, а не придумывает
// формулировку, которая потом не найдётся.
function rollToolFor(state) {
  const heroes = partyOf(state);
  const lines = heroes.map((c) => {
    const ab = (c.blocks || []).filter((b) => b.type === 'ability').map((b) => `${b.name}${b.value ? ` (${b.value})` : ''}`);
    return ab.length ? `${c.name}: ${ab.join(', ')}` : '';
  }).filter(Boolean);
  if (!lines.length) return ROLL_TOOL;
  const f = ROLL_TOOL.function;
  return { ...ROLL_TOOL, function: { ...f, parameters: { ...f.parameters, properties: { ...f.parameters.properties,
    skill: { type: 'string', description: 'Что проверяем. Если действие подходит под умение героя — его название ТОЧНО из списка: ' +
      lines.join('; ') + '. Подходящего нет — навык по смыслу ("Скрытность", "Убеждение"), бросок пойдёт без бонуса.' },
  } } } };
}

export async function narrate(state, apiKey, withTools, { allowDice = true, journal = null, timer = null } = {}) {
  const messages = storyMessages(state, { withTools }, [DIFFICULTY_REMINDER[state.difficulty], state.correctionNote, state.tickNote]);

  const dice = allowDice && state.diceEnabled !== false;
  const narrationParts = [];
  let finishReason = null;
  const rolls = [];
  // Подглядывание в кодекс: что рассказчик видел в промте + что прочитал сам. По этому после хода
  // видно, не вывел ли он существо, не зная его статьи.
  const lookup = hasCodex(state);
  const codexSeen = lookup ? renderCodex(state).shown : null;
  const lookups = [];
  const rounds = withTools ? MAX_TOOL_ROUNDS : (dice || lookup ? 4 : 1);

  for (let round = 0; round < rounds; round++) {
    let tools;
    if (withTools) tools = dice ? [...toolsFor(state), rollToolFor(state)] : toolsFor(state);
    else if (dice) tools = [rollToolFor(state)];
    if (lookup) tools = [...(tools || []), LOOKUP_TOOL];

    const data = await callOpenRouter({
      purpose: withTools ? 'рассказчик (с инструментами)' : 'рассказчик',
      model: state.model,
      timer,
      messages,
      apiKey,
      tools,
      temperature: state.temperature ?? 0.8,
      presencePenalty: state.repetitionPenalty ?? 0.3,
      frequencyPenalty: state.frequencyPenalty ?? 0,
    });
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('Пустой ответ от модели.');
    finishReason = data?.choices?.[0]?.finish_reason;
    if (process.env.DEBUG && !withTools) {
      console.log(`  [рассказ] finish_reason=${finishReason ?? 'нет'} символов=${(msg.content || '').length}`);
    }

    messages.push(msg);
    if (withTools) state.messages.push({ ...msg, ...stamp(state) });

    if (msg.content && msg.content.trim()) {
      const clean = stripToolMarkup(msg.content);
      if (clean) narrationParts.push(clean);
    }

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      if (withTools) applyLeakedCalls(msg.content, state);
      break;
    }

    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      let result;
      if (call.function.name === 'codex_lookup') {
        const r = lookupCodex(state, args.titles ?? args.title);
        for (const id of r.found) codexSeen.add(id);
        lookups.push(...(Array.isArray(args.titles) ? args.titles : [args.titles ?? args.title]).filter(Boolean).map(String));
        result = r.text;
      } else if (call.function.name === 'roll_check') {
        const character = resolveCharacterFor(state, args.character);
        // Черты цели влияют на исход: труса легче запугать, упрямца труднее убедить.
        const tgt = String(args.target || '').trim().toLowerCase();
        const targetNpc = tgt
          ? (state.npcs || []).find((n) => n.name.toLowerCase() === tgt)
            || (state.npcs || []).find((n) => !n.archived && n.name.toLowerCase().split(/\s+/)[0].slice(0, 4) === tgt.split(/\s+/)[0].slice(0, 4) && tgt.length >= 3)
          : null;
        const tm = targetNpc
          ? traitModifier(state.traitPool || [], targetNpc.traits || [], args.skill)
          : { mod: 0, reasons: [] };
        // Умелость цели: мастера-следователя обмануть труднее, чем крестьянина.
        const cm = competenceMod(targetNpc, args.skill);
        if (cm.mod) { tm.mod += cm.mod; tm.reasons = [...tm.reasons, cm.reason]; }
        const sm = statusRollMod(statusCatalogOf(state), character);
        const r = rollCheck({
          character, skill: args.skill, difficulty: args.difficulty,
          traitMod: tm.mod + sm.mod,
          traitReasons: [...tm.reasons, ...sm.reasons],
        });
        r.target_npc = targetNpc ? targetNpc.name : undefined;
        const grew = recordRoll(character, r);
        if (grew) { r.growth = grew; (state._growth ||= []).push(grew); }
        rolls.push(r);
        result = describeRoll(r);
      } else {
        result = executeTool(call.function.name, args, state);
        if (journal) journal.push(journalEntry(call.function.name, args, result, round + 1));
      }
      const toolMsg = { role: 'tool', tool_call_id: call.id, content: result };
      messages.push(toolMsg);
      if (withTools) state.messages.push(toolMsg);
    }
  }

  // Ответ оборвался на полуслове по лимиту токенов — просим договорить
  // и подклеиваем продолжение, чтобы игрок не видел обрубок.
  // Некоторые провайдеры не ставят finish_reason='length'. Считаем обрывом и тот
  // случай, когда текст кончается без завершающего знака препинания.
  const looksCut = narrationParts.length
    && !/[.!?…»"*)\]]\s*$/.test(narrationParts[narrationParts.length - 1].trim());
  if ((finishReason === 'length' || looksCut) && narrationParts.length) {
    try {
      const soFar = narrationParts.join('\n\n');
      messages.push({ role: 'assistant', content: soFar });
      messages.push({ role: 'user', content: 'Продолжи ровно с того места, где оборвалось. Не повторяй уже написанное, не начинай заново.' });
      const cont = await callOpenRouter({
        purpose: 'рассказчик: продолжение',
        model: state.model, messages, apiKey, timer,
        temperature: state.temperature ?? 0.8,
        presencePenalty: state.repetitionPenalty ?? 0.3,
        frequencyPenalty: state.frequencyPenalty ?? 0,
      });
      const tail = cont?.choices?.[0]?.message?.content;
      if (tail && tail.trim()) {
        const clean = stripToolMarkup(tail).trim();
        // Приклеиваем без разрыва абзаца, если фраза оборвалась на середине.
        const glue = /[.!?…»"]$/.test(soFar.trim()) ? '\n\n' : ' ';
        narrationParts[narrationParts.length - 1] = narrationParts[narrationParts.length - 1] + glue + clean;
        finishReason = cont?.choices?.[0]?.finish_reason;
      }
    } catch { /* не вышло — отдаём что есть */ }
  }

  // В сохранённую историю кладём только чистый текст: служебные вызовы броска
  // не должны засорять контекст следующих ходов.
  const narration = stripHeroLabel(narrationParts.join('\n\n')).trim();
  if (!withTools && narration) state.messages.push({ role: 'assistant', content: narration, ...stamp(state) });
  return { narration, rolls, truncated: finishReason === 'length', codexSeen, lookups };
}
