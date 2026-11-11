// «Персонаж играет сам»: НПС с отметкой `self` перед рассказом получает отдельный короткий запрос.
// Он видит только свою карточку и то, что знает сам, и возвращает решение, реплику и то, чем себя выдаёт.
// Рассказчик вплетает это в сцену, а тайну такого персонажа не видит вовсе — проболтаться нечем.

import { viewMessages } from './lines.js';
import { callOpenRouter, stripToolMarkup } from './llm.js';
import { sameName } from './tools.js';
import { tailItems, lastPlayerAction } from './narrator.js';
import { clockLabel } from './scene.js';

export const MAX_VOICES = 2;        // не больше двух таких запросов за ход
// Персонаж — необязательная часть хода: не ответил быстро — его сыграет рассказчик, ход не ждёт.
const VOICE_TIMEOUT_MS = Number(process.env.VOICE_TIMEOUT_MS) || 30000;
const WITNESSED_MESSAGES = 6;       // сколько последних реплик сцены он помнит дословно (если был рядом)
const WORLD_CHARS = 1200;

const first = (s) => String(s || '').toLowerCase().split(/\s+/)[0];
const stem = (s) => { const f = first(s); return f.length >= 3 ? f.slice(0, Math.max(3, f.length - 2)) : ''; };
const namedIn = (n, text) => [n.name, ...(n.aliases || [])].map(stem).some((x) => x && text.includes(x));
const isNpc = (n, name) => [n.name, ...(n.aliases || [])].some((x) => x.toLowerCase() === String(name).toLowerCase() || sameName(x, name) || first(x) === first(name));

// Кто из «играющих сами» участвует в этом ходу: рядом с героем; сначала те, к кому обращается игрок,
// потом те, кто звучал в прошлом ответе.
export function voiceCandidates(state) {
  const near = ((state.scene && state.scene.present) || []).map(String);
  const own = (state.npcs || []).filter((n) => n.self && !n.archived && (n.bound || near.some((p) => isNpc(n, p))));
  if (!own.length) return [];
  const action = String(lastPlayerAction(state) || '').toLowerCase();
  const prev = [...viewMessages(state)].reverse().find((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string');
  const prevText = prev ? prev.content.toLowerCase() : '';
  const score = (n) => (namedIn(n, action) ? 2 : 0) + (namedIn(n, prevText) ? 1 : 0);
  return own.map((n, i) => ({ n, i, s: score(n) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, MAX_VOICES).map((x) => x.n);
}

// Реплики сцены, которые персонаж слышал сам: только ходы, когда он был рядом без перерыва.
function witnessed(state, npc) {
  const turn = state.turn || 0;
  const seen = npc.lastSeen;
  const sinceTurn = npc.bound ? 0 : (seen && seen.turn >= turn - 1 ? (Number.isFinite(seen.since) ? seen.since : seen.turn) : turn);
  const count = Math.min(WITNESSED_MESSAGES, Math.max(0, (turn - sinceTurn) * 2));
  if (!count) return [];
  const msgs = viewMessages(state).filter((m) => !m.ooc && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  return msgs.slice(0, -1).slice(-count); // без текущего хода игрока — он идёт отдельно
}

// Карточка — в третьем лице. Раньше она обращалась к персонажу на «ты» («Кто ты», «ЧЕГО ТЫ ХОЧЕШЬ»), а ниже шёл
// текст рассказчика, где «ты» — герой: модель путала себя с героем и приписывала себе его поступки.
function cardLines(n) {
  const out = [];
  const add = (label, v) => { if (v && String(v).trim()) out.push(`${label}: ${String(v).trim()}`); };
  add('Кто это', n.description);
  add('Народ', n.race);
  add('Внешность', n.appearance);
  if ((n.traits || []).length) add('Черты', n.traits.join(', '));
  if (n.competence && n.competence !== 'обычный') add('Умелость', `${n.competence}${(n.skills || []).length ? ' — ' + n.skills.join(', ') : ''}`);
  else if ((n.skills || []).length) add('Умеет', n.skills.join(', '));
  add('Характер и речь', n.personality);
  add('Изюминка', n.quirk);
  add('ХОЧЕТ', n.wants);
  add('СКРЫВАЕТ', n.secret);
  add('Связи', n.links);
  add('Манера речи', n.voiceStyle);
  add('Юмор', n.voiceHumor);
  add('Привычки в речи', n.voiceHabits);
  add('Как прячет чувства', n.voiceMasks);
  add('В речи никогда', n.voiceTaboos);
  if (Array.isArray(n.voiceSamples) && n.voiceSamples.length) add('Как звучит (образцы интонации, не повторять дословно)', n.voiceSamples.slice(-4).map((x) => `«${x}»`).join(' '));
  return out;
}

export function voiceMessages(state, npc) {
  const hero = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const heroName = hero ? hero.name : 'герой';
  const me = npc.name;
  const sc = state.scene || {};
  let sys = `Задание: сыграть одного персонажа ролевой игры. Твой персонаж — ${me}. Герой игрока — ${heroName}. Это разные люди: ` +
    `за ${heroName} решает и говорит только игрок, а ты отвечаешь только за персонажа по имени ${me}.\n` +
    `Ты не рассказчик: мир не описываешь и за других не решаешь. ${me} знает только то, что написано ниже и что слышал в сцене; ` +
    'чего здесь нет — он не знает, фактов о мире не выдумывай. ' +
    `${me} действует в своих интересах и в своём характере: может отказать, торговаться, солгать, промолчать, уйти от ответа — если ему так выгоднее. ` +
    'Тайну он не раскрывает без веской причины.';
  const world = String(state.worldPrompt || '').trim();
  if (world) sys += `\n\n=== МИР (общеизвестное) ===\n${world.length > WORLD_CHARS ? world.slice(0, WORLD_CHARS) + '…' : world}`;
  sys += `\n\n=== ТВОЙ ПЕРСОНАЖ: ${me} ===\n${cardLines(npc).join('\n') || 'О нём пока известно мало — держись того, что уже прозвучало.'}`;

  const about = [];
  if (npc.attitude) about.push(`Отношение персонажа ${me} к нему: ${npc.attitude}`);
  if (npc.history) about.push(`Что между ними было («герой» в записях — это ${heroName}): ${tailItems(npc.history, 8, 900)}`);
  if (hero && hero.appearance && hero.appearance.trim()) about.push(`Как выглядит ${heroName}: ${hero.appearance.trim()}`);
  const facts = (state.events || []).filter((e) => [...(e.participants || []), ...(e.knownBy || [])].some((p) => isNpc(npc, p))).slice(-8)
    .map((e) => `• ${e.text}${e.status === 'done' ? ' (уже в прошлом)' : ''}`);
  if (facts.length) about.push(`Что ${me} знает из случившегося:\n` + facts.join('\n'));
  sys += `\n\n=== ГЕРОЙ ИГРОКА: ${heroName} (глазами персонажа ${me}) ===\n${about.join('\n') || `${me} видит его впервые.`}`;

  const now = [];
  if (sc.location) now.push(`Место: ${sc.location}`);
  const clock = Number.isFinite(sc.minute) && Number.isFinite(sc.day) ? clockLabel(sc) : '';
  if (clock) now.push(`Время: ${clock}`);
  const others = (sc.present || []).filter((p) => !isNpc(npc, p));
  now.push(`Рядом с ним: ${[heroName, ...others].join(', ')}`);
  if (npc.mood) now.push(`Настроение персонажа ${me}: ${npc.mood}${npc.moodReason ? ` — потому что ${npc.moodReason}` : ''}`);
  sys += `\n\n=== СЕЙЧАС ===\n${now.join('\n')}`;

  // Отрывки истории написаны для игрока: «ты» (или «вы») в них — герой. Подписываем каждый и объясняем это явно.
  const nameOf = (id) => (state.characters.find((c) => c.id === id) || {}).name || heroName;
  const second = state.narration === 'third' ? '' : state.narration === 'second_vy' ? 'вы' : 'ты';
  const playerTag = (who) => `[Игрок пишет за героя (${who}), «я» здесь — ${who}]`;
  const heard = witnessed(state, npc).map((m) => (m.role === 'user' ? `${playerTag(nameOf(m.hero))}: ${m.content}` : `[Рассказчик — герою (${nameOf(m.hero)})]: ${m.content}`));
  let user = '';
  if (second) {
    user += `Важно: «${second}» в этих отрывках — это ${heroName}, герой игрока, а НЕ ${me}. Рассказчик обращается к герою; ` +
      `персонаж ${me} в них назван по имени. Всё, что сделал «${second}» или «я», — сделал ${heroName}.\n\n`;
  }
  user += heard.length ? `Что ${me} видел и слышал только что:\n${heard.join('\n\n')}\n\n` : `${me} только что оказался в этой сцене.\n\n`;
  user += `Новый ход, на который ${me} отвечает:\n${playerTag(heroName)}: ${lastPlayerAction(state)}`;
  if (state.directorNote && state.directorNote.trim()) {
    user += `\n\n[Пожелание игрока к истории: ${state.directorNote.trim()} — учти, если это касается персонажа ${me}, но он остаётся собой.]`;
  }
  user += `\n\nОтвечай только за своего персонажа (${me}). ${heroName} — не твой персонаж: не пиши, что он делает, говорит или чувствует, и не повторяй его слова.\n` +
    'Ответь тремя строками и больше ничего не пиши:\n' +
    `РЕШЕНИЕ: ${me} … — что он делает и чего добивается прямо сейчас (одна фраза в третьем лице, начни с его имени)\n` +
    `РЕПЛИКА: что ${me} говорит вслух, его собственные слова (1–3 фразы; «—», если молчит)\n` +
    `ВЫДАЁТ: что в нём может заметить внимательный человек — жест, заминка, взгляд («—», если ничего)`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

// Защита от ответа «не за того»: модель описала действия героя или повторила слова игрока.
// Признаки простые и осторожные: лучше отбросить сомнительный ответ (персонажа сыграет рассказчик), чем вписать в сцену чужое.
const flat = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export function guardVoice(v, state, npc) {
  if (!v) return null;
  const hero = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const out = { ...v };
  const heroFirst = first(hero && hero.name);
  const npcFirst = first(npc && npc.name);
  const starts = (word, name) => name.length >= 2 && word.startsWith(name) && word.length - name.length <= 2;
  // Решение начинается с имени героя («Ян показывает бумаги») — это не решение персонажа.
  const lead = first(flat(out.decision));
  if (lead && starts(lead, heroFirst) && !(starts(lead, npcFirst) && npcFirst.length >= heroFirst.length)) out.decision = '';
  // Реплика повторяет то, что написал игрок, — модель ответила за героя.
  const action = flat(lastPlayerAction(state));
  const line = flat(out.line);
  if (line.length >= 8 && action.length >= 8 && (action.includes(line) || line.includes(action))) {
    out.line = '';
    // И решение от первого лица после такого повтора — тоже о герое («Прошу пропустить меня»).
    if (/(^|\s)(я|меня|мне|мной|мой|моя|моё|мою|мои)(\s|$)/.test(flat(out.decision))) out.decision = '';
  }
  // Что-то пришлось выбросить и ни решения, ни реплики не осталось — ответ не о персонаже, не используем.
  const dropped = out.decision !== v.decision || out.line !== v.line;
  if (dropped && !out.decision && !out.line) return null;
  return out.decision || out.line || out.tell ? out : null;
}

const EMPTY = /^(?:[—–-]+|нет|ничего|молчит|молчу)?[.\s]*$/i;
export function parseVoice(text) {
  const t = stripToolMarkup(String(text || '')).replace(/\*\*/g, '').trim();
  if (!t) return null;
  const KEYS = 'РЕШЕНИЕ|РЕПЛИКА|ВЫДА[ЁЕ]Т';
  const grab = (key, max) => {
    const m = t.match(new RegExp(`(?:^|\\n)\\s*(?:${key})\\s*[:—–-]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${KEYS})\\s*[:—–-]|$)`, 'i'));
    if (!m) return '';
    const v = m[1].replace(/\s+/g, ' ').trim().replace(/^[«"„“]+|[»"“”]+$/g, '').trim();
    return EMPTY.test(v) ? '' : v.slice(0, max);
  };
  const out = { decision: grab('РЕШЕНИЕ', 300), line: grab('РЕПЛИКА', 600), tell: grab('ВЫДА[ЁЕ]Т', 300) };
  // Модель ответила прозой без меток — берём как решение, чтобы ход не пропал.
  if (!out.decision && !out.line && !out.tell) out.decision = t.replace(/\s+/g, ' ').slice(0, 400);
  return out;
}

// Запросы идут параллельно; сбой одного персонажа ход не срывает — его просто сыграет рассказчик.
export async function npcVoices(state, apiKey, timer = null) {
  const picked = voiceCandidates(state);
  if (!picked.length) return [];
  const missed = []; // кто не ответил (сбой или не уложился во время) — показываем под ответом
  const results = await Promise.all(picked.map(async (npc) => {
    try {
      const data = await callOpenRouter({
        purpose: `персонаж: ${npc.name}`,
        model: state.model, apiKey, timer,
        messages: voiceMessages(state, npc),
        temperature: state.temperature ?? 0.8,
        maxTokens: 400, noReasoning: true, timeoutMs: VOICE_TIMEOUT_MS,
      });
      const v = guardVoice(parseVoice(data?.choices?.[0]?.message?.content), state, npc);
      return v ? { name: npc.name, ...v } : null;
    } catch (e) {
      if (/Ход прерван/.test(String(e && e.message))) throw e; // игрок прервал ход — не продолжаем
      missed.push(npc.name);
      return null;
    }
  }));
  const out = results.filter(Boolean);
  out.missed = missed;
  return out;
}
