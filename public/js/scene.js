// Карточка сцены, портрет через A1111, направление истории.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

// ---- Сцена ----
const DAY_PARTS = [[5, 'глубокая ночь'], [9, 'раннее утро'], [12, 'утро'], [17, 'день'], [21, 'вечер'], [24, 'ночь']];
function clockText(sc) {
  const h = Math.floor((sc.minute || 0) / 60), m = (sc.minute || 0) % 60;
  const part = (DAY_PARTS.find(([lim]) => h < lim) || DAY_PARTS[5])[1];
  return `день ${sc.day || 1}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${part})`;
}
function renderScene() {
  const sc = app.scene; if (!sc) return;
  $('sceneLocation').textContent = sc.location || 'Место не задано';
  $('sceneTime').textContent = clockText(sc) + (sc.time ? ' — ' + sc.time : '');
  $('sceneNote').textContent = sc.note || '';
  const faces = $('sceneFaces');
  faces.innerHTML = '';
  const boundNpcs = (app.npcs || []).filter((n) => n.bound && !n.archived);
  const names = [...(sc.present || []), ...boundNpcs.filter((n) => !(sc.present || []).some((p) => findNpcByName(p) === n)).map((n) => n.name)];
  // Строка сцены над лентой (телефон): место · время · кто рядом.
  $('sceneStripText').textContent = ['📍 ' + (sc.location || 'место не задано'), clockText(sc), names.length ? names.join(', ') : ''].filter(Boolean).join(' · ');
  $('scenePresent').hidden = names.length > 0;
  for (const name of names) {
    const n = findNpcByName(name);
    const wrap = document.createElement('span');
    wrap.className = 'scene-person' + (n && n.bound ? ' bound' : '');
    wrap.title = n && n.bound ? `${name} — всегда с героем` : name;
    const f = document.createElement('span');
    f.className = 'scene-face' + (n && n.bound ? ' bound' : '');
    if (n && n.avatar) f.style.backgroundImage = `url('/avatars/${n.avatar}')`;
    else f.textContent = name.trim().charAt(0).toUpperCase();
    const cap = document.createElement('span');
    cap.className = 'scene-face-name';
    cap.textContent = name.trim().split(/\s+/)[0];
    wrap.append(f, cap);
    if (n) wrap.addEventListener('click', (e) => { e.stopPropagation(); openNpcModal(n); });
    faces.appendChild(wrap);
  }
  const h = Math.floor((sc.minute || 0) / 60);
  document.body.dataset.daypart = h < 5 ? 'deepnight' : h < 9 ? 'dawn' : h < 17 ? 'day' : h < 21 ? 'evening' : 'night';
}
function findNpcByName(name) {
  const k = String(name).trim().toLowerCase();
  if (!k) return null;
  const first = k.split(/\s+/)[0];
  return (app.npcs || []).find((n) => n.name.toLowerCase() === k)
    || (app.npcs || []).find((n) => { const nf = n.name.toLowerCase().split(/\s+/)[0]; return nf.length >= 3 && (k.includes(nf) || n.name.toLowerCase().includes(first)); })
    || null;
}
// Кто говорит в строке с тире: ищем имя героя или НПС в авторской ремарке.
function speakerFace(line) {
  const low = line.toLowerCase();
  const all = [...(app.characters || []), ...(app.npcs || [])];
  let best = null;
  for (const p of all) {
    if (!p.avatar) continue;
    const first = p.name.toLowerCase().split(/\s+/)[0];
    if (first.length < 3) continue;
    const stem = first.length > 5 ? first.slice(0, -1) : first; // «Рита» → «Рит», ловим «Риты», «Рите»
    const i = low.indexOf(stem);
    if (i !== -1 && (best === null || i < best.i)) best = { p, i };
  }
  return best ? best.p : null;
}
let sceneLocks = new Set();
function renderSceneLocks() {
  document.querySelectorAll('#sceneModal .lock-btn').forEach((b) => {
    const on = sceneLocks.has(b.dataset.lock);
    b.textContent = on ? '🔒' : '🔓';
    b.classList.toggle('on', on);
  });
}
function openSceneModal() {
  const sc = app.scene || {};
  $('sceneLocationInput').value = sc.location || '';
  $('sceneDayInput').value = sc.day || 1;
  const h = Math.floor((sc.minute || 0) / 60), m = (sc.minute || 0) % 60;
  $('sceneClockInput').value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('sceneTimeInput').value = sc.time || '';
  $('scenePresentInput').value = (sc.present || []).join(', ');
  $('sceneNoteInput').value = sc.note || '';
  sceneLocks = new Set(sc.locked || []);
  renderSceneLocks();
  $('sceneModal').hidden = false;
  $('sceneLocationInput').focus();
}
async function saveScene() {
  try {
    const data = await api('/api/scene', { method: 'PUT', body: JSON.stringify({
      location: $('sceneLocationInput').value, day: $('sceneDayInput').value, clock: $('sceneClockInput').value,
      time: $('sceneTimeInput').value, present: $('scenePresentInput').value, note: $('sceneNoteInput').value,
      locked: [...sceneLocks],
    }) });
    applyState(data);
    $('sceneModal').hidden = true;
  } catch (err) { toast(err.message); }
}

// ---- Портрет через A1111 ----
async function drawPortrait(kind, fresh = false) {
  const id = kind === 'npc' ? editingNpcId : editingCharId;
  if (fresh) $(kind === 'npc' ? 'npcPortraitTags' : 'charPortraitTags').value = '';
  if (!id) { toast('Сначала сохрани персонажа.'); return; }
  const btn = $(kind === 'npc' ? 'npcAvatarDraw' : 'charAvatarDraw');
  btn.classList.add('busy'); btn.textContent = '🎨 Рисую…';
  try {
    const tagsBox = $(kind === 'npc' ? 'npcPortraitTags' : 'charPortraitTags');
    const data = await api(`/api/${kind === 'npc' ? 'npcs' : 'characters'}/${id}/portrait`, { method: 'POST', body: JSON.stringify({ tags: tagsBox.value.trim() }) });
    applyState(data);
    refreshLogKeepScroll();
    if (data.portrait && data.portrait.tags) tagsBox.value = data.portrait.tags;
    if (kind === 'npc') {
      const n = app.npcs.find((x) => x.id === id);
      setNpcAvatarPreview(n ? n.avatar : null);
      $('npcAvatarClear').disabled = !(n && n.avatar);
    } else {
      const c = app.characters.find((x) => x.id === id);
      setAvatarPreview(c ? c.avatar : null);
      $('charAvatarClear').disabled = !(c && c.avatar);
    }
    const pw = data.portrait && data.portrait.warnings && data.portrait.warnings.length ? ' ⚠ ' + data.portrait.warnings.join('; ') + '.' : '';
    toast('Портрет готов. Теги — в поле под кнопками, поправь и нарисуй заново, если не похож.' + pw);
  } catch (err) { toast(err.message); }
  finally { btn.classList.remove('busy'); btn.textContent = '🎨 Нарисовать'; }
}

// ---- Направление истории ----
function openDirector() {
  $('directorNote').value = app.directorNote || '';
  $('directorModal').hidden = false;
  $('directorNote').focus();
}
async function saveDirector() {
  try {
    const data = await api('/api/settings', { method: 'POST', body: JSON.stringify({ directorNote: $('directorNote').value }) });
    app.directorNote = data.directorNote || '';
    $('directorBtn').classList.toggle('lit', Boolean(app.directorNote.trim()));
    $('directorModal').hidden = true;
    toast(app.directorNote.trim() ? 'Направление задано.' : 'Направление снято.');
  } catch (err) { toast(err.message); }
}

function switchPanel(name) {
  activePanel = name;
  for (const [tab, panel, key] of [['tabHeroes','panelHeroes','heroes'], ['tabNpcs','panelNpcs','npcs'], ['tabLore','panelLore','lore'], ['tabThreads','panelThreads','threads'], ['tabEvents','panelEvents','events']]) {
    $(tab).classList.toggle('active', name === key);
    $(panel).hidden = name !== key;
  }
  if (name === 'npcs') $('tabNpcs').classList.remove('changed');
}

async function deleteNpc(id) {
  try {
    const data = await api(`/api/npcs/${id}`, { method: 'DELETE' });
    applyState(data);
    refreshLogKeepScroll();
  } catch (err) { toast(err.message); }
}

async function deleteBlock(blockId) {
  try {
    const data = await api(`/api/characters/${app.activeCharacterId}/blocks/${blockId}`, { method: 'DELETE' });
    blockSignatures = {};
    applyState(data, { animate: false });
    snapshotCharSigs();
  } catch (err) { toast(err.message); }
}
