// Отношения НПС — отдельно для каждого героя. В самих полях НПС (attitude, history, lastSeen) всегда лежит
// то, что относится к АКТИВНОМУ герою: так учётчик, рассказчик, карточки и досье работают как раньше.
// Значения для остальных героев ждут в npc.perHero[идГероя] и подменяются при смене героя.

const copySeen = (s) => (s ? { ...s } : undefined);
const pick = (n) => ({ attitude: n.attitude || '', history: n.history || '', lastSeen: copySeen(n.lastSeen) });
const isBlank = (r) => !r || (!r.attitude && !r.history && !r.lastSeen);
const first = (s) => String(s || '').toLowerCase().split(/\s+/)[0];

function put(n, rel) {
  n.attitude = (rel && rel.attitude) || '';
  n.history = (rel && rel.history) || '';
  if (rel && rel.lastSeen) n.lastSeen = copySeen(rel.lastSeen); else delete n.lastSeen;
}

// Спутники героя: из той же компании (group) и отмечены «в истории». Компания — явная отметка на герое:
// у героя «со своей отдельной историей» она своя. Пока её нет, все герои — одна компания (как было раньше).
// Одно правило на всё: кто рядом для рассказчика, кто знаком с встреченными, чьи ходы общие.
export const groupOf = (c) => (c && c.group) || 'main';
export function companionIds(state, heroId = state.activeCharacterId) {
  const me = (state.characters || []).find((c) => c.id === heroId);
  return (state.characters || []).filter((c) => c.id !== heroId && c.present !== false && groupOf(c) === groupOf(me)).map((c) => c.id);
}
// Герои в сцене: активный и его спутники.
export function partyOf(state) {
  const ids = new Set([state.activeCharacterId, ...companionIds(state)]);
  return (state.characters || []).filter((c) => ids.has(c.id));
}

// Смена героя: прежний запоминает своё, новому возвращается его (или пусто — они не знакомы).
// Вызывать ДО смены сцены: «кто рядом» считается по сцене уходящего героя.
export function switchRelations(state, fromId, toId) {
  if (!toId || fromId === toId) return;
  const near = ((state.scene && state.scene.present) || []).map(first);
  // Спутники уходящего героя (отмечены «в истории») — те, кого встреченные рядом персонажи тоже видели.
  const companions = fromId ? companionIds(state, fromId) : [];
  for (const n of state.npcs || []) {
    const per = n.perHero && typeof n.perHero === 'object' ? n.perHero : {};
    if (fromId) {
      const live = pick(n);
      if (!isBlank(live)) per[fromId] = live; else delete per[fromId];
      const here = !n.archived && (n.bound || near.includes(first(n.name)));
      if (here && !isBlank(live)) {
        for (const cid of companions) {
          if (per[cid]) { if (live.lastSeen) per[cid].lastSeen = copySeen(live.lastSeen); }
          else per[cid] = pick(n);
        }
      }
    }
    put(n, per[toId]);
    delete per[toId];
    if (Object.keys(per).length) n.perHero = per; else delete n.perHero;
  }
}

// Героя удалили — его отношения больше не нужны.
export function dropRelations(state, heroId) {
  for (const n of state.npcs || []) {
    if (!n.perHero) continue;
    delete n.perHero[heroId];
    if (!Object.keys(n.perHero).length) delete n.perHero;
  }
}

// Партии до этой правки: отношение было одно на всех героев. Чтобы никто не «забыл» знакомых,
// прежнее значение остаётся у каждого уже существующего героя; дальше они расходятся.
// ownerId — чьи значения сейчас лежат в полях НПС (по умолчанию активный герой).
export function migrateRelations(state, ownerId = state.activeCharacterId) {
  if (state.relationsPerHero) return;
  state.relationsPerHero = true;
  const others = (state.characters || []).filter((c) => c.id !== ownerId).map((c) => c.id);
  if (!others.length) return;
  for (const n of state.npcs || []) {
    const live = pick(n);
    if (isBlank(live)) continue;
    n.perHero = n.perHero && typeof n.perHero === 'object' ? n.perHero : {};
    for (const id of others) if (!n.perHero[id]) n.perHero[id] = pick(n);
  }
}

// После восстановления снимка: в полях НПС лежат отношения того героя, который был активен в снимке.
// Если сейчас активен другой — подменяем; снимок старого образца (отношение одно на всех) — раздаём всем.
export function reconcileRelations(state, snap) {
  const known = (id) => id && state.characters.some((c) => c.id === id);
  const owner = [snap.relFor, snap.activeCharacterId].find(known) || state.activeCharacterId;
  if (!snap.relFor) { state.relationsPerHero = false; migrateRelations(state, owner); }
  if (owner !== state.activeCharacterId) switchRelations(state, owner, state.activeCharacterId);
}
