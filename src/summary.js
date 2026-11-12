// Сжатие истории: старые ходы сворачиваются в «Предысторию».

import { viewMessages, summaryOf, setSummaryOf, foldMessages } from './lines.js';
import { callOpenRouter, stripToolMarkup } from './llm.js';

// ---- Сжатие истории ----
// Старые ходы сворачиваются в «Предысторию», которая едет в системном контексте.
// Резать можно ТОЛЬКО по границе хода игрока, иначе осиротеют пары
// «вызов инструмента → результат» и запрос сломается.
export function findCutIndex(messages, keep) {
  let i = Math.max(0, messages.length - keep);
  while (i < messages.length && messages[i].role !== 'user') i++;
  return i >= messages.length ? -1 : i;
}

export function renderTranscript(messages, state = null) {
  const lines = [];
  // Несколько героев: в пересказе нужно знать, с кем что было, — «ты» в тексте у каждого своё.
  const nameOf = (id) => (state && id ? (state.characters.find((c) => c.id === id) || {}).name : '');
  // Имя героя — всегда, даже если в этом куске он один: после смены героя «ты» иначе
  // приписывалось прежнему (из старой предыстории).
  const multi = Boolean(state);
  for (const m of messages) {
    if (m.ooc) continue; // реплики вне истории не идут в предысторию
    const who = multi ? nameOf(m.hero) : '';
    if (m.role === 'user' && m.content) lines.push(`Игрок${who ? ` (за ${who})` : ''}: ${m.content}`);
    else if (m.role === 'assistant' && m.content && m.content.trim()) lines.push(`Рассказчик${who ? ` (эпизод ${who}; «ты» = ${who})` : ''}: ${m.content.trim()}`);
  }
  const text = lines.join('\n\n');
  const LIMIT = 24000;
  return text.length > LIMIT ? text.slice(text.length - LIMIT) : text;
}

// Сжатие истории. Раньше запускалось на каждом ходу, как только сообщений
// становилось больше historyKeep: срезалась одна пара — и через ход снова.
// Теперь с запасом: ждём, пока наберётся keep + step, и срезаем до keep —
// одно сжатие на несколько ходов. И идёт оно в фоне, после ответа игроку.
// Запас сверх «сырых ходов» — четверть: на долгой игре дословная история — самая тяжёлая часть промта.
export function summaryStep(keep) { return Math.max(4, Math.round(keep / 4)); }

// План сжатия: что сворачиваем. null — пока не нужно.
export function planSummary(state, { force = false } = {}) {
  if (state.autoSummarize === false) return null;
  const keep = state.historyKeep || 20;
  // Сворачивается история активного героя: только то, что видит он. Чужие ходы ждут своего героя.
  const heroId = state.activeCharacterId;
  const view = viewMessages(state, heroId);
  if (view.length <= keep + (force ? 0 : summaryStep(keep))) return null;
  const cut = findCutIndex(view, keep);
  if (cut <= 0) return null;
  const items = view.slice(0, cut);
  return {
    state, cut, heroId, items,
    prevSummary: summaryOf(state, heroId),
    transcript: renderTranscript(items, state),
  };
}

export async function computeSummary(plan, apiKey, timer = null) {
  if (!plan.transcript.trim()) return '';
  const system =
    'Ты — архивариус текстовой ролевой игры. Ты ведёшь КРАТКУЮ «предысторию» — выжимку того, что важно для продолжения истории, а не пересказ.\n' +
    'Правила:\n' +
    '- Пиши сжатой прозой от третьего лица, в прошедшем времени, по-русски. Героев называй по именам, а не «ты»/«герой»; ' +
    'если героев несколько, не путай, с кем что случилось и кто что знает.\n' +
    '- Объём — не больше 250 слов.\n' +
    '- КТО ЧТО ЗНАЕТ: если тайну, перемену в герое или событие видели не все — так и пиши, кто именно знает («о ранах Эйры знает только Лира»). ' +
    'Не приписывай персонажам знаний, которых у них в тексте не было; кого не было в сцене, тот о ней не знает.\n' +
    '- Конкретные обещания, долги, ложь и факты о прошлом хранятся отдельно в хронике — не старайся вместить их все, ' +
    'но и не выбрасывай то, что нужно для связности сюжета.\n' +
    '- Включай ТОЛЬКО то, что повлияет на дальнейшую игру: необратимые события и их последствия, принятые решения, ' +
    'обещания и долги, узнанные важные тайны, устойчивые отношения, незакрытые цели и сюжетные линии, ключевые перемены в герое или мире.\n' +
    '- ОБЯЗАТЕЛЬНО сохраняй названные конкретные факты, по которым легко себе противоречить: возраст, сроки («здесь 7 лет»), ' +
    'числа, имена, родство, титулы, места. Пиши их точно так, как они прозвучали — это канон, и рассказчик будет на него опираться. ' +
    'Такие факты храни предельно кратко, перечислением.\n' +
    '- Строго опускай: атмосферу и описания, дословные реплики, разовые детали без последствий, ' +
    'случайных персонажей и предметы без дальнейшей роли.\n' +
    '- Проверяй каждый факт вопросом: «понадобится ли это, чтобы вести историю дальше?» Если нет — выбрось.\n' +
    '- Если дана прежняя предыстория, СЛЕЙ её с новыми событиями в один цельный текст и заодно убери из неё то, что уже утратило значение. ' +
    'Предыстория не должна разрастаться от раза к разу.\n' +
    '- В ответе — только текст предыстории, без заголовков и пояснений.';

  const user =
    (plan.prevSummary.trim() ? 'ПРЕЖНЯЯ ПРЕДЫСТОРИЯ:\n' + plan.prevSummary.trim() + '\n\n' : '') +
    'НОВЫЕ СОБЫТИЯ (сверни их вместе с прежней предысторией):\n' + plan.transcript;
  const data = await callOpenRouter({
    purpose: 'сжатие истории',
    model: plan.state.model, fallbackModel: plan.state.fallbackModel, // сжимать откровенную историю основная модель тоже может отказаться
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    apiKey,
    temperature: 0.3,
    noReasoning: true, // пересказ не требует «размышлений», а с ними сжатие шло минутами
    timer,
  });
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error('Модель вернула пустую предысторию.');
  return stripToolMarkup(text).trim();
}

// Применить, только если история за это время не поменялась: игрок мог
// перегенерировать ход, обрезать ленту или переключить партию.
export function applySummary(plan, text, currentState) {
  const st = plan.state;
  if (currentState !== st) return false;
  // Все свёрнутые сообщения на месте (те же объекты: после отката или обрезки это уже копии) и героя не удалили.
  if (!st.characters.some((c) => c.id === plan.heroId)) return false;
  const have = new Set(st.messages);
  if (!plan.items.every((m) => have.has(m))) return false;
  if (summaryOf(st, plan.heroId) !== plan.prevSummary) return false;
  // Пока шло сжатие, игрок мог переключиться на другого героя — предыстория всё равно ложится своему.
  if (text) setSummaryOf(st, plan.heroId, text);
  foldMessages(st, plan.items, plan.heroId);
  return true;
}
