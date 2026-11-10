// «Персонаж играет сам»: НПС с отметкой `self` перед рассказом получает отдельный короткий запрос.
// Он видит только свою карточку и то, что знает сам, и возвращает решение, реплику и то, чем себя выдаёт.
// Рассказчик вплетает это в сцену, а тайну такого персонажа не видит вовсе — проболтаться нечем.

import { callOpenRouter, stripToolMarkup } from './llm.js';
import { sameName } from './tools.js';
import { tailItems, lastPlayerAction } from './narrator.js';
import { clockLabel } from './scene.js';

export const MAX_VOICES = 2;        // не больше двух таких запросов за ход
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
  const prev = [...(state.messages || [])].reverse().find((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string');
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
  const msgs = (state.messages || []).filter((m) => !m.ooc && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  return msgs.slice(0, -1).slice(-count); // без текущего хода игрока — он идёт отдельно
}

function cardLines(n) {
  const out = [];
  const add = (label, v) => { if (v && String(v).trim()) out.push(`${label}: ${String(v).trim()}`); };
  add('Кто ты', n.description);
  add('Народ', n.race);
  add('Внешность', n.appearance);
  if ((n.traits || []).length) add('Черты', n.traits.join(', '));
  if (n.competence && n.competence !== 'обычный') add('Умелость', `${n.competence}${(n.skills || []).length ? ' — ' + n.skills.join(', ') : ''}`);
  else if ((n.skills || []).length) add('Умеешь', n.skills.join(', '));
  add('Характер и речь', n.personality);
  add('Изюминка', n.quirk);
  add('ЧЕГО ТЫ ХОЧЕШЬ', n.wants);
  add('ЧТО ТЫ СКРЫВАЕШЬ', n.secret);
  add('Связи', n.links);
  add('Манера речи', n.voiceStyle);
  add('Юмор', n.voiceHumor);
  add('Привычки в речи', n.voiceHabits);
  add('Как прячешь чувства', n.voiceMasks);
  add('В речи никогда', n.voiceTaboos);
  if (Array.isArray(n.voiceSamples) && n.voiceSamples.length) add('Как ты звучишь (образцы интонации, не повторяй дословно)', n.voiceSamples.slice(-4).map((s) => `«${s}»`).join(' '));
  return out;
}

export function voiceMessages(state, npc) {
  const hero = state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
  const heroName = hero ? hero.name : 'герой';
  const sc = state.scene || {};
  let sys = `Ты играешь одного персонажа ролевой игры — ${npc.name}. Ты не рассказчик: не описываешь мир и не решаешь за других. ` +
    'Ты знаешь только то, что написано ниже и что слышал в сцене; чего здесь нет — ты не знаешь и не выдумываешь фактов о мире. ' +
    'Действуй в своих интересах и в своём характере: можешь отказать, торговаться, солгать, промолчать, уйти от ответа — если тебе так выгоднее. ' +
    'Тайну не раскрывай без веской причины.';
  const world = String(state.worldPrompt || '').trim();
  if (world) sys += `\n\n=== МИР (общеизвестное) ===\n${world.length > WORLD_CHARS ? world.slice(0, WORLD_CHARS) + '…' : world}`;
  sys += `\n\n=== ТЫ: ${npc.name} ===\n${cardLines(npc).join('\n') || 'О тебе пока известно мало — держись того, что уже прозвучало.'}`;

  const about = [];
  if (npc.attitude) about.push(`Твоё отношение: ${npc.attitude}`);
  if (npc.history) about.push(`Что между вами было: ${tailItems(npc.history, 8, 900)}`);
  if (hero && hero.appearance && hero.appearance.trim()) about.push(`Как он выглядит: ${hero.appearance.trim()}`);
  const facts = (state.events || []).filter((e) => [...(e.participants || []), ...(e.knownBy || [])].some((p) => isNpc(npc, p))).slice(-8)
    .map((e) => `• ${e.text}${e.status === 'done' ? ' (уже в прошлом)' : ''}`);
  if (facts.length) about.push('Что ты знаешь из случившегося:\n' + facts.join('\n'));
  sys += `\n\n=== ${heroName.toUpperCase()} ДЛЯ ТЕБЯ ===\n${about.join('\n') || 'Ты видишь его впервые.'}`;

  const now = [];
  if (sc.location) now.push(`Место: ${sc.location}`);
  const clock = Number.isFinite(sc.minute) && Number.isFinite(sc.day) ? clockLabel(sc) : '';
  if (clock) now.push(`Время: ${clock}`);
  const others = (sc.present || []).filter((p) => !isNpc(npc, p));
  now.push(`Рядом: ${[heroName, ...others].join(', ')}`);
  if (npc.mood) now.push(`Твоё настроение: ${npc.mood}${npc.moodReason ? ` — потому что ${npc.moodReason}` : ''}`);
  sys += `\n\n=== СЕЙЧАС ===\n${now.join('\n')}`;

  const nameOf = (id) => (state.characters.find((c) => c.id === id) || {}).name || heroName;
  const heard = witnessed(state, npc).map((m) => (m.role === 'user' ? `${nameOf(m.hero)}: ${m.content}` : `Что было дальше: ${m.content}`));
  let user = heard.length ? `Что ты видел и слышал только что:\n${heard.join('\n\n')}\n\n` : 'Ты только что оказался в этой сцене.\n\n';
  user += `Сейчас ${heroName} делает или говорит:\n${lastPlayerAction(state)}`;
  if (state.directorNote && state.directorNote.trim()) {
    user += `\n\n[Пожелание игрока к истории: ${state.directorNote.trim()} — учти, если это касается тебя, но оставайся собой.]`;
  }
  user += '\n\nОтветь тремя строками и больше ничего не пиши:\n' +
    'РЕШЕНИЕ: что ты делаешь и чего добиваешься прямо сейчас (одна фраза)\n' +
    'РЕПЛИКА: что ты говоришь вслух, своим голосом (1–3 фразы; «—», если молчишь)\n' +
    'ВЫДАЁТ: что в тебе может заметить внимательный человек — жест, заминка, взгляд («—», если ничего)';
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
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
  const results = await Promise.all(picked.map(async (npc) => {
    try {
      const data = await callOpenRouter({
        purpose: `персонаж: ${npc.name}`,
        model: state.model, apiKey, timer,
        messages: voiceMessages(state, npc),
        temperature: state.temperature ?? 0.8,
        maxTokens: 400, noReasoning: true,
      });
      const v = parseVoice(data?.choices?.[0]?.message?.content);
      return v ? { name: npc.name, ...v } : null;
    } catch { return null; }
  }));
  return results.filter(Boolean);
}
