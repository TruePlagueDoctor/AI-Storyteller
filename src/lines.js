// Линии героев: мир и время общие (один общий порядок ходов в state.messages и state.log),
// но у каждого героя своё «окно»: рассказчик и лента видят только его ходы и ходы тех, с кем он был вместе,
// и предыстория у каждого своя. Файлы сохранений при этом не переезжают: это отбор, а не раздельное хранение.
//
// Пометки у сообщения и реплики ленты: hero — за кого ход; with — кто из героев был рядом (спутники).
// Нет with — запись сделана до этой правки и остаётся общей для всех (как было).
// done — для каких героев сообщение уже свёрнуто в их предысторию.
// Предыстория активного героя лежит в state.summary, остальных — в state.summaries[идГероя].

import { companionIds } from './relations.js';

// Пометка для нового сообщения или реплики ленты.
export function stamp(state) {
  return { hero: state.activeCharacterId, with: companionIds(state, state.activeCharacterId) };
}

// Видит ли герой эту запись (сообщение истории или реплику ленты).
export function visibleTo(m, heroId) {
  if (!m || !m.hero || m.hero === heroId) return true;
  return Array.isArray(m.with) ? m.with.includes(heroId) : true;
}

// История глазами героя: его ходы, общие с ним ходы спутников, старые общие записи — кроме уже свёрнутых для него.
// Служебные сообщения инструментов идут за тем сообщением, к которому относятся.
export function viewMessages(state, heroId = state.activeCharacterId) {
  const out = [];
  let on = true;
  for (const m of state.messages || []) {
    if (m.role !== 'tool') on = visibleTo(m, heroId) && !(Array.isArray(m.done) && m.done.includes(heroId));
    if (on) out.push(m);
  }
  return out;
}

export function summaryOf(state, heroId) {
  return heroId === state.activeCharacterId ? (state.summary || '') : ((state.summaries || {})[heroId] || '');
}
export function setSummaryOf(state, heroId, text) {
  if (heroId === state.activeCharacterId) { state.summary = text; return; }
  state.summaries = state.summaries || {};
  if (text) state.summaries[heroId] = text; else delete state.summaries[heroId];
}

// Смена героя: предыстория прежнего убирается на хранение, новому возвращается его.
export function switchLine(state, fromId, toId) {
  if (!toId || fromId === toId) return;
  const store = state.summaries && typeof state.summaries === 'object' ? state.summaries : {};
  if (fromId) { if (state.summary) store[fromId] = state.summary; else delete store[fromId]; }
  state.summary = store[toId] || '';
  delete store[toId];
  state.summaries = store;
}

// Свернуть сообщения в предысторию героя: кто ещё может их видеть — тому они остаются (пометка done),
// иначе удаляются из истории совсем.
export function foldMessages(state, items, heroId) {
  const set = new Set(items);
  const others = state.characters.map((c) => c.id).filter((id) => id !== heroId);
  const kept = [];
  let dropPrev = false;
  for (const m of state.messages) {
    if (!set.has(m)) { kept.push(m); dropPrev = false; continue; }
    if (m.role === 'tool') { if (!dropPrev) kept.push(m); continue; }
    const done = [...new Set([...(Array.isArray(m.done) ? m.done : []), heroId])];
    const stillNeeded = others.some((id) => visibleTo(m, id) && !done.includes(id));
    dropPrev = !stillNeeded;
    if (stillNeeded) { m.done = done; kept.push(m); }
  }
  state.messages = kept;
}

// Героя удалили: его предыстория и сообщения, которые больше никому не видны, не нужны.
export function dropLine(state, heroId) {
  if (state.summaries) delete state.summaries[heroId];
  const left = state.characters.map((c) => c.id);
  const needed = (m) => !m.hero || !Array.isArray(m.with) || left.some((id) => visibleTo(m, id) && !(m.done || []).includes(id));
  let on = true;
  state.messages = (state.messages || []).filter((m) => { if (m.role !== 'tool') on = needed(m); return on; });
}

// Партии до этой правки: предыстория была одна на всех — она остаётся у каждого существовавшего героя.
export function migrateLines(state) {
  if (state.linesPerHero) return;
  state.linesPerHero = true;
  state.summaries = state.summaries && typeof state.summaries === 'object' ? state.summaries : {};
  if (!String(state.summary || '').trim()) return;
  for (const c of state.characters || []) {
    if (c.id !== state.activeCharacterId && !state.summaries[c.id]) state.summaries[c.id] = state.summary;
  }
}

// После восстановления снимка: state.summary из снимка принадлежит тому, кто был в нём активен.
export function reconcileLines(state, snap) {
  if (snap.summaries && typeof snap.summaries === 'object') state.summaries = JSON.parse(JSON.stringify(snap.summaries));
  const known = (id) => id && state.characters.some((c) => c.id === id);
  const owner = [snap.relFor, snap.activeCharacterId].find(known) || state.activeCharacterId;
  if (owner !== state.activeCharacterId) {
    const active = state.activeCharacterId;
    state.activeCharacterId = owner;      // на миг — чтобы подмена сняла предысторию с правильного героя
    switchLine(state, owner, active);
    state.activeCharacterId = active;
  }
}
