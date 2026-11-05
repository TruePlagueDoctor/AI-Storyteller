// Сцена — где герой, какое время, кто рядом. Единственное место, где это
// хранится явно, а не размазано по прозе последних ходов.
//
// Время игровое: day (с 1) и minute (0..1439). Учётчик передаёт elapsed —
// сколько минут прошло за ход, код двигает часы и переводит в «утро/вечер».

export function emptyScene() {
  return { location: '', time: '', present: [], creatures: [], note: '', day: 1, minute: 9 * 60, locked: [] };
}

export function normalizeScene(raw) {
  const s = { ...emptyScene(), ...(raw && typeof raw === 'object' ? raw : {}) };
  s.location = String(s.location || '');
  s.time = String(s.time || '');
  s.note = String(s.note || '');
  s.present = Array.isArray(s.present) ? s.present.map((x) => String(x).trim()).filter(Boolean) : [];
  s.day = Math.max(1, Number(s.day) || 1);
  const minute = Number(s.minute);
  s.minute = Number.isFinite(minute) ? Math.min(1439, Math.max(0, Math.round(minute))) : 9 * 60;
  s.locked = Array.isArray(s.locked) ? s.locked : [];
  // Существа из бестиария рядом (стая, тварь) — по ним кодекс подтягивает статью целиком.
  s.creatures = Array.isArray(s.creatures) ? s.creatures.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [];
  return s;
}

export function dayPart(minute) {
  const h = Math.floor(minute / 60);
  if (h < 5) return 'глубокая ночь';
  if (h < 9) return 'раннее утро';
  if (h < 12) return 'утро';
  if (h < 17) return 'день';
  if (h < 21) return 'вечер';
  return 'ночь';
}

export function clockLabel(scene) {
  const h = Math.floor(scene.minute / 60);
  const m = scene.minute % 60;
  return `день ${scene.day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${dayPart(scene.minute)})`;
}

// Продвинуть часы на N минут. Возвращает, сколько суток перевалило.
export function advanceClock(scene, minutes) {
  const add = Math.max(0, Math.min(60 * 24 * 30, Number(minutes) || 0));
  if (!add) return 0;
  const total = scene.minute + add;
  const days = Math.floor(total / 1440);
  scene.minute = total % 1440;
  scene.day += days;
  return days;
}

// Разобрать «через два часа», «21:30», «утро» из свободного текста времени,
// когда учётчик передал его словами, а не минутами.
export function parseTimeHint(text) {
  const t = String(text || '').toLowerCase();
  const hm = t.match(/(\d{1,2})[:.](\d{2})/);
  if (hm) return { minute: Math.min(1439, Number(hm[1]) * 60 + Number(hm[2])), exact: true };
  const parts = [[/глубок.*ноч|за полночь/, 2 * 60], [/ранн.*утр|рассвет/, 6 * 60], [/утр/, 9 * 60], [/полдень|полден/, 12 * 60],
    [/день|днём|днем/, 14 * 60], [/вечер|закат|сумерк/, 19 * 60], [/ноч/, 23 * 60]];
  for (const [re, min] of parts) if (re.test(t)) return { minute: min };
  return null;
}

// Текст для промта рассказчика.
export function sceneBlock(scene, state) {
  if (!scene) return '';
  const bits = [];
  if (scene.location) bits.push(`Место: ${scene.location}`);
  bits.push(`Время: ${clockLabel(scene)}${scene.time ? ` — ${scene.time}` : ''}`);
  if (scene.present.length) bits.push(`Рядом с героем: ${scene.present.join(', ')}`);
  if ((scene.creatures || []).length) bits.push(`Существа рядом: ${scene.creatures.join(', ')}`);
  const bound = ((state && state.npcs) || []).filter((n) => n.bound).map((n) => n.name);
  if (bound.length) bits.push(`Всегда с героем (не считаются присутствующими, но участвуют): ${bound.join(', ')}`);
  if (scene.note) bits.push(`Обстановка: ${scene.note}`);
  return '=== СЦЕНА (здесь и сейчас) ===\n' + bits.join('\n') +
    '\nЭто опорная точка: не телепортируй героя и не меняй время суток без причины в тексте. ' +
    'Кто не указан рядом — того в сцене нет, пока он не придёт.';
}

// Текст для учётчика.
export function sceneForSync(scene) {
  if (!scene) return '';
  return `СЦЕНА: ${scene.location || 'место ещё не задано (задай, только если оно названо)'}; ${clockLabel(scene)}; рядом: ${scene.present.length ? scene.present.join(', ') : 'никого'}` +
    ((scene.creatures || []).length ? `; существа: ${scene.creatures.join(', ')}` : '') +
    (scene.note ? `; обстановка: ${scene.note}` : '') +
    ((scene.locked || []).length ? ` [закреплено игроком: ${scene.locked.join(', ')}]` : '');
}
