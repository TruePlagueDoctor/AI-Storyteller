// Версия сборки — видна в консоли браузера (F12), помогает проверить, что файл обновился.
console.log('AI Storyteller UI v41 — техническая инструкция учётчика');

// ---- Метаданные типов блоков ----
const TYPE_META = {
  stat:         { label: 'Характеристики', glyph: '◆', color: 'var(--stat)',     order: 0 },
  status:       { label: 'Состояния',      glyph: '✦', color: 'var(--status)',   order: 1 },
  item:         { label: 'Инвентарь',      glyph: '◈', color: 'var(--item)',     order: 2 },
  ability:      { label: 'Умения',         glyph: '✧', color: 'var(--relation)', order: 3 },
  relationship: { label: 'Отношения',      glyph: '❖', color: 'var(--relation)', order: 4 },
};

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const sheetEl = $('sheet');
const sheetEmpty = $('sheetEmpty');
const inputEl = $('input');
const composerEl = $('composer');
const sendBtn = $('sendBtn');
const modelLabel = $('modelLabel');
const charTabsEl = $('charTabs');

let app = { characters: [], activeCharacterId: null, npcs: [], lorebook: [], traitPool: [], statusCatalog: [], threads: [], events: [], log: [] };
let showArchived = false;
let eventQuery = '';
let sending = false;
let editingCharId = null;
let activePanel = 'heroes';
let oocMode = false;

let blockSignatures = {};   // id блока -> сигнатура (для анимации активного листа)
let charSigs = {};          // id героя -> сигнатура всего листа (для меток изменений)
let npcSigs = {};           // id НПС -> сигнатура (для анимации карточек)
const changedChars = new Set();

// ---- Утилиты ----
function api(path, options) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(data.error || `Ошибка ${r.status}`);
        e.payload = data;
        throw e;
      }
      // Признаки, от которых зависит отрисовка ленты, — до того как её нарисуют.
      if (data && typeof data.canResync === 'boolean') app.canResync = data.canResync;
      if (data && typeof data.toolModel === 'string') app.toolModel = data.toolModel;
      return data;
    });
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  // Ошибки — красной кромкой, всё прочее — латунной.
  t.classList.toggle('error', /ошибк|не удалось|не задан|не найден|не отвеча|нельзя|failed|error|\b[45]\d\d\b/i.test(String(msg)));
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 6000);
}
function scrollLog() { logEl.scrollTop = logEl.scrollHeight; }
function activeChar() { return app.characters.find((c) => c.id === app.activeCharacterId) || app.characters[0]; }

function blockSig(b) { return JSON.stringify([b.value ?? '', b.max ?? '', b.description ?? '']); }
function charSig(c) { return JSON.stringify(c.blocks.map((b) => [b.type, b.name, blockSig(b)])); }
function snapshotCharSigs() {
  charSigs = {};
  for (const c of app.characters) charSigs[c.id] = charSig(c);
}

// ---- Применяем свежее состояние с сервера ----
function applyState(data, { animate = false } = {}) {
  // Обновляем только то, что пришло: ответ без поля не должен стирать данные.
  if (Array.isArray(data.characters)) app.characters = data.characters;
  if (data.activeCharacterId) app.activeCharacterId = data.activeCharacterId;
  if (Array.isArray(data.npcs)) app.npcs = data.npcs;
  if (Array.isArray(data.lorebook)) app.lorebook = data.lorebook;
  if (data.traitPool) app.traitPool = data.traitPool;
  if (data.seedPool) app.seedPool = data.seedPool;
  if (data.statusCatalog) app.statusCatalog = data.statusCatalog;
  if (data.threads) app.threads = data.threads;
  if (data.scene) app.scene = data.scene;
  if (data.events) { app.events = data.events; renderEvents(); }
  if (typeof data.canResync === 'boolean') app.canResync = data.canResync;
  if (typeof data.toolModel === 'string') app.toolModel = data.toolModel;
  if (typeof data.model === 'string') app.model = data.model;
  if (typeof data.turn === 'number') app.turn = data.turn;
  if (typeof data.directorNote === 'string') {
    app.directorNote = data.directorNote;
    $('directorBtn').classList.toggle('lit', Boolean(data.directorNote.trim()));
  }
  renderThreads();
  if (app.scene) renderScene();   // лица в сцене зависят и от НПС, и от портретов
  if (data.model) modelLabel.textContent = data.model;
  renderTabs();
  renderHeroStrip();
  renderSheet(activeChar(), animate);
  renderNpcs(animate);
  renderLore();
}


// ---- Лорбук ----
let editingLoreId = null;

function renderLore() {
  const count = $('loreCount');
  count.textContent = app.lorebook.length ? String(app.lorebook.length) : '';
  const list = $('loreList');
  list.innerHTML = '';
  if (!app.lorebook.length) {
    const empty = document.createElement('p');
    empty.className = 'sheet-empty';
    empty.textContent = 'Записи о мире подставляются в контекст только когда упомянуты их ключевые слова — так подробный лор не съедает контекст. Нажми ＋, чтобы добавить первую.';
    list.appendChild(empty);
    return;
  }
  for (const e of app.lorebook) {
    const el = document.createElement('div');
    el.className = 'lore' + (e.enabled === false ? ' disabled' : '');
    el.dataset.id = e.id;

    const row = document.createElement('div');
    row.className = 'lore-row';
    const t = document.createElement('span');
    t.className = 'lore-title';
    t.textContent = e.title;
    row.appendChild(t);
    if (e.always) {
      const a = document.createElement('span');
      a.className = 'lore-always';
      a.textContent = 'всегда';
      row.appendChild(a);
    }
    if (e.author === 'narrator') {
      const a = document.createElement('span');
      a.className = 'lore-always lore-auto';
      a.textContent = 'рассказчик';
      row.appendChild(a);
    }
    el.appendChild(row);

    if (e.keys && e.keys.length) {
      const keys = document.createElement('div');
      keys.className = 'lore-keys';
      for (const k of e.keys) {
        const kk = document.createElement('span');
        kk.className = 'lore-key';
        kk.textContent = k;
        keys.appendChild(kk);
      }
      el.appendChild(keys);
    }
    if (e.content) {
      const p = document.createElement('div');
      p.className = 'lore-preview';
      p.textContent = e.content.length > 110 ? e.content.slice(0, 110) + '…' : e.content;
      el.appendChild(p);
    }
    list.appendChild(el);
  }
}

function openLoreModal(entry) {
  editingLoreId = entry ? entry.id : null;
  $('loreModalTitle').textContent = entry ? 'Изменить запись' : 'Новая запись';
  $('loreTitle').value = entry ? entry.title : '';
  $('loreKeys').value = entry ? (entry.keys || []).join(', ') : '';
  $('loreContent').value = entry ? entry.content : '';
  $('loreAlways').checked = entry ? !!entry.always : false;
  $('loreDelete').style.display = entry ? '' : 'none';
  $('loreModal').hidden = false;
  $('loreTitle').focus();
}
function closeLoreModal() { $('loreModal').hidden = true; }

async function saveLore() {
  const title = $('loreTitle').value.trim();
  if (!title) { toast('У записи должно быть название.'); return; }
  const body = {
    title,
    keys: $('loreKeys').value,
    content: $('loreContent').value,
    always: $('loreAlways').checked,
  };
  try {
    const data = editingLoreId
      ? await api(`/api/lore/${editingLoreId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/lore', { method: 'POST', body: JSON.stringify(body) });
    closeLoreModal();
    applyState(data);
  } catch (err) { toast(err.message); }
}

async function deleteLore() {
  if (!editingLoreId) return;
  const e = app.lorebook.find((x) => x.id === editingLoreId);
  if (!confirm(`Удалить запись «${e ? e.title : ''}»?`)) return;
  try {
    const data = await api(`/api/lore/${editingLoreId}`, { method: 'DELETE' });
    closeLoreModal();
    applyState(data);
  } catch (err) { toast(err.message); }
}

// ---- НПС ----
function npcSig(n) { return JSON.stringify([n.name, n.attitude ?? '', n.status ?? '', n.description ?? '', n.appearance ?? '', n.personality ?? '', n.history ?? '', n.avatar ?? '', (n.traits||[]).join(','), n.wants ?? '', n.secret ?? '', n.quirk ?? '', n.links ?? '', n.voiceStyle ?? '', (n.voiceSamples||[]).join('|'), n.mood ?? '']); }
function npcsCollectionSig() { return JSON.stringify(app.npcs.map(npcSig)); }

function attitudeColor(attitude) {
  const a = (attitude || '').toLowerCase();
  if (/(враг|враждеб|ненавид|презир|угроз|ярост|злоб|hostile|enemy|hate)/.test(a)) return 'var(--status)';
  if (/(друг|союзник|тепл|дружелюб|симпат|довер|предан|верн|friendly|ally|warm|loyal)/.test(a)) return 'var(--item)';
  if (/(насторож|подозр|опас|недовер|холод|wary|suspicious|cautious)/.test(a)) return 'var(--brass)';
  return 'var(--stat)';
}

let npcQuery = '';
const expandedNpcs = new Set();

function npcMatches(n, q) {
  if (!q) return true;
  const hay = [n.name, n.description, n.personality, n.status, n.attitude].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderNpcs(animate) {
  const count = $('npcCount');
  const live = app.npcs.filter((n) => !n.archived).length;
  count.textContent = live ? String(live) : '';

  const list = $('npcList');
  list.innerHTML = '';

  if (!app.npcs.length) {
    const empty = document.createElement('p');
    empty.className = 'sheet-empty';
    empty.textContent = 'Ты ещё никого не встретил. Персонажи, с которыми столкнёшься, появятся здесь — с их отношением к тебе и статусом.';
    list.appendChild(empty);
    npcSigs = {};
    return;
  }

  const shown = app.npcs.filter((n) => (showArchived || !n.archived) && npcMatches(n, npcQuery));
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'sheet-empty';
    empty.textContent = 'Никого не нашлось.';
    list.appendChild(empty);
    return;
  }

  // Группы: кто сейчас рядом (в сцене или всегда с героем), кого встречали раньше, архив.
  const present = new Set(((app.scene && app.scene.present) || []).map((p) => findNpcByName(p)).filter(Boolean).map((n) => n.id));
  const isHere = (n) => !n.archived && (n.bound || present.has(n.id));
  const groups = [
    ['Рядом', shown.filter(isHere)],
    ['Встречались', shown.filter((n) => !n.archived && !isHere(n))],
    ['Архив', shown.filter((n) => n.archived)],
  ].filter(([, list]) => list.length);
  const nextSigs = {};
  for (const [title, members] of groups) {
    if (groups.length > 1) {
      const h = document.createElement('div');
      h.className = 'npc-group';
      h.textContent = title;
      list.appendChild(h);
    }
    for (const n of members) {
      const sig = npcSig(n);
      nextSigs[n.id] = sig;
      list.appendChild(renderNpcCard(n, animate && npcSigs[n.id] !== sig, isHere(n)));
    }
  }
  npcSigs = nextSigs;
}

function renderNpcCard(n, animate, here = false) {
  const open = expandedNpcs.has(n.id);
  const el = document.createElement('div');
  el.className = 'npc' + (animate ? ' inscribed' : '') + (open ? ' open' : '') + (n.archived ? ' archived' : '') + (here ? ' here' : '');
  el.dataset.id = n.id;
  el.style.setProperty('--npc-color', attitudeColor(n.attitude));
  const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };

  // Шапка: портрет в рамке, имя, отношение, где он — то, что нужно для беглого взгляда.
  const head = mk('div', 'npc-head');
  const av = mk('div', 'npc-avatar' + (n.avatar ? ' has-image' : ''));
  if (n.avatar) av.style.backgroundImage = `url('/avatars/${n.avatar}')`;
  else av.textContent = (n.name || '?').trim().charAt(0).toUpperCase();
  if (n.bound) { const m = mk('span', 'npc-presence bound', '✧'); m.title = 'Всегда с героем'; av.appendChild(m); }
  else if (here) { const m = mk('span', 'npc-presence'); m.title = 'В сцене'; av.appendChild(m); }
  head.appendChild(av);

  const main = mk('div', 'npc-main');
  const row = mk('div', 'npc-row');
  row.appendChild(mk('span', 'npc-name', n.name));
  const marks = mk('span', 'npc-marks');
  if (n.secret) { const m = mk('span', 'npc-secret-mark', '◆'); m.title = 'У персонажа есть тайна'; marks.appendChild(m); }
  if ((n.locked || []).length) { const m = mk('span', 'npc-locked', '🔒'); m.title = 'Закреплено: ' + n.locked.join(', '); marks.appendChild(m); }
  if (marks.childNodes.length) row.appendChild(marks);
  main.appendChild(row);
  main.appendChild(mk('div', 'npc-attitude', n.attitude || 'отношение не ясно'));
  if (n.status) main.appendChild(mk('div', 'npc-where', n.status));
  if (n.traits && n.traits.length) {
    const tr = mk('div', 'npc-traits');
    for (const t of n.traits) {
      const tag = mk('span', 'trait-tag', t);
      const meta = app.traitPool.find((x) => x.label === t);
      if (meta && meta.hint) tag.title = meta.hint;
      tr.appendChild(tag);
    }
    main.appendChild(tr);
  }
  head.appendChild(main);
  el.appendChild(head);

  if (!open) return el;

  // Развёрнутая часть: эпиграф голосом персонажа, потом досье.
  const body = mk('div', 'npc-body-full');
  const sample = (n.voiceSamples || []).slice(-1)[0];
  if (sample || n.mood) {
    const ep = mk('div', 'npc-epigraph');
    if (sample) ep.appendChild(mk('blockquote', 'npc-quote', '«' + sample.replace(/^[«"]|[»"]$/g, '') + '»'));
    if (n.mood) ep.appendChild(mk('div', 'npc-mood', n.mood + (n.moodReason ? ' — ' + n.moodReason : '')));
    body.appendChild(ep);
  }
  const fields = [
    ['Кто это', n.description],
    ['Внешность', n.appearance, 'npc-appearance'],
    ['Характер', n.personality],
    ['Чего хочет', n.wants],
    ['Изюминка', n.quirk],
    ['Связи', n.links],
    ['Голос', [n.voiceStyle, n.voiceHumor && 'юмор: ' + n.voiceHumor, n.voiceHabits && 'привычки: ' + n.voiceHabits].filter(Boolean).join('; ')],
    ['Было с героем', n.history],
  ];
  for (const [label, value, cls] of fields) {
    if (!value) continue;
    const f = mk('div', 'npc-field');
    f.append(mk('div', 'npc-field-label', label), mk('div', 'npc-desc' + (cls ? ' ' + cls : ''), value));
    body.appendChild(f);
  }
  if (n.secret) {
    // Тайна прикрыта: автору она известна, но в листе не должна бросаться в глаза.
    const f = mk('div', 'npc-field');
    const v = mk('div', 'npc-desc npc-secret', n.secret);
    v.dataset.act = 'reveal';
    v.title = 'Показать тайну';
    f.append(mk('div', 'npc-field-label', 'Что скрывает'), v);
    body.appendChild(f);
  }
  const acts = mk('div', 'npc-acts');
  for (const [act, text, cls] of [['delete', 'Удалить', 'danger'], ['edit', 'Открыть досье', '']]) {
    const b2 = mk('button', 'btn ghost ' + cls, text);
    b2.dataset.act = act;
    acts.appendChild(b2);
  }
  body.appendChild(acts);
  el.appendChild(body);
  return el;
}

function renderThreads() {
  const list = $('threadList');
  const count = $('threadCount');
  if (!list) return;
  const open = (app.threads || []).filter((t) => t.status === 'open');
  count.textContent = open.length ? String(open.length) : '';
  list.innerHTML = '';
  if (!(app.threads || []).length) {
    const e = document.createElement('p');
    e.className = 'sheet-empty';
    e.textContent = 'Пока ни одной нити. Цели, загадки и конфликты появятся здесь по ходу истории — или заведи сам.';
    list.appendChild(e);
    return;
  }
  const order = { open: 0, done: 1, failed: 2 };
  for (const t of [...app.threads].sort((a, b) => order[a.status] - order[b.status])) {
    const el = document.createElement('div');
    el.className = 'thread ' + t.status;
    el.dataset.id = t.id;
    const row = document.createElement('div');
    row.className = 'thread-row';
    const title = document.createElement('span');
    title.className = 'thread-title';
    title.textContent = t.title;
    const st = document.createElement('span');
    st.className = 'thread-status';
    st.textContent = t.status === 'open' ? 'открыта' : t.status === 'done' ? 'решена' : 'упущена';
    row.append(title, st);
    el.appendChild(row);
    if (t.progress) { const p = document.createElement('div'); p.className = 'thread-progress'; p.textContent = t.progress; el.appendChild(p); }
    if (t.notes) { const n = document.createElement('div'); n.className = 'thread-notes'; n.textContent = t.notes; el.appendChild(n); }
    list.appendChild(el);
  }
}

let editingThreadId = null;
function openThreadModal(t) {
  editingThreadId = t ? t.id : null;
  $('threadModalTitle').textContent = t ? 'Изменить нить' : 'Новая нить';
  $('threadTitle').value = t ? t.title : '';
  $('threadProgress').value = t ? t.progress : '';
  $('threadNotes').value = t ? t.notes : '';
  $('threadStatus').value = t ? t.status : 'open';
  $('threadDelete').style.display = t ? '' : 'none';
  $('threadModal').hidden = false;
  $('threadTitle').focus();
}
function closeThreadModal() { $('threadModal').hidden = true; }
async function saveThread() {
  const title = $('threadTitle').value.trim();
  if (!title) { toast('У нити нужно название.'); return; }
  try {
    const data = await api('/api/threads', { method: 'POST', body: JSON.stringify({
      id: editingThreadId || undefined, title,
      progress: $('threadProgress').value, notes: $('threadNotes').value, status: $('threadStatus').value,
    }) });
    closeThreadModal();
    applyState(data);
  } catch (err) { toast(err.message); }
}
async function deleteThreadNow() {
  if (!editingThreadId) return;
  try {
    const data = await api(`/api/threads/${editingThreadId}`, { method: 'DELETE' });
    applyState(data);
    closeThreadModal();
    renderThreads();
  } catch (err) { toast(err.message); }
}

// ---- Ручные блоки листа ----
let editingBlockId = null;
function syncBlockRows() {
  const t = $('blockType').value;
  $('blockStatRow').style.display = t === 'stat' ? '' : 'none';
  $('blockStatusRows').style.display = t === 'status' ? '' : 'none';
  $('blockTextRow').style.display = (t === 'stat' || t === 'status') ? 'none' : '';
  $('blockName').setAttribute('list', t === 'status' ? 'statusNames' : '');
}
function openBlockModal(b) {
  editingBlockId = b ? b.id : null;
  $('blockModalTitle').textContent = b ? 'Изменить блок' : 'Новый блок';
  $('blockType').value = b ? b.type : 'status';
  $('blockName').value = b ? b.name : '';
  $('blockValue').value = b && b.type === 'stat' ? (b.value ?? '') : '';
  $('blockMax').value = b && b.type === 'stat' && b.max != null ? b.max : '';
  $('blockText').value = b && b.type !== 'stat' && b.type !== 'status' ? (b.value ?? '') : '';
  $('blockRollMod').value = b && b.rollMod != null ? b.rollMod : '';
  $('blockDuration').value = b && b.duration != null ? b.duration : '';
  $('blockTickStat').value = b && b.tick ? b.tick.stat : '';
  $('blockTickDelta').value = b && b.tick ? b.tick.delta : '';
  $('blockDesc').value = b ? (b.description || '') : '';
  $('blockLockMode').value = b && b.locked ? 'all' : b && b.descLocked ? 'desc' : 'none';
  $('blockDelete').style.display = b ? '' : 'none';
  const dl = $('statusNames');
  dl.innerHTML = '';
  for (const d of app.statusCatalog || []) { const o = document.createElement('option'); o.value = d.name; dl.appendChild(o); }
  syncBlockRows();
  $('blockModal').hidden = false;
  $('blockName').focus();
}
function closeBlockModal() { $('blockModal').hidden = true; }
async function saveBlock() {
  const c = activeChar();
  if (!c) { toast('Нет активного героя.'); return; }
  const type = $('blockType').value;
  const body = { id: editingBlockId || undefined, type, name: $('blockName').value, description: $('blockDesc').value, locked: $('blockLockMode').value === 'all', descLocked: $('blockLockMode').value === 'desc' };
  if (type === 'stat') { body.value = $('blockValue').value; body.max = $('blockMax').value; }
  else if (type === 'status') {
    body.rollMod = $('blockRollMod').value.replace('−', '-');
    body.duration = $('blockDuration').value;
    const ts = $('blockTickStat').value.trim();
    body.tick = ts ? { stat: ts, delta: $('blockTickDelta').value.replace('−', '-') } : null;
  } else body.value = $('blockText').value;
  try {
    const data = await api(`/api/characters/${c.id}/blocks`, { method: 'POST', body: JSON.stringify(body) });
    applyState(data);
    closeBlockModal();
  } catch (err) { toast(err.message); }
}
async function deleteBlockFromModal() {
  if (!editingBlockId) return;
  await deleteBlock(editingBlockId);
  closeBlockModal();
}

// ---- Хроника ----
const EVENT_LABEL = { promise: 'обещание', debt: 'долг', plan: 'назначено', lie: 'ложь', reveal: 'раскрыто', decision: 'решение', death: 'смерть', fact: 'факт', relation: 'отношения', other: 'событие' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OUTCOME_LABEL = { done: 'исполнено', broken: 'нарушено', past: 'прошло' };
let editingEventId = null;
function renderEvents() {
  const list = $('eventList'); const count = $('eventCount');
  if (!list) return;
  const events = app.events || [];
  const open = events.filter((e) => e.status === 'open' && ['promise', 'debt', 'plan'].includes(e.type)).length;
  count.textContent = open ? String(open) : '';
  list.innerHTML = '';
  const q = eventQuery;
  const shown = events.filter((e) => !q || e.text.toLowerCase().includes(q) || e.participants.some((p) => p.toLowerCase().includes(q)));
  if (!shown.length) {
    const p = document.createElement('p'); p.className = 'sheet-empty';
    p.textContent = events.length ? 'Ничего не нашлось.' : 'Хроника пуста. Сюда ложатся обещания, долги, ложь, раскрытые тайны и факты о прошлом — учётчик пишет их сам, можно и вручную.';
    list.appendChild(p); return;
  }
  for (const e of [...shown].sort((a, b) => b.turn - a.turn)) {
    const el = document.createElement('div');
    el.className = 'event ' + e.status + (e.locked ? ' locked' : '');
    el.dataset.id = e.id;
    const meta = document.createElement('div'); meta.className = 'event-meta';
    meta.innerHTML = `<span class="event-type">${EVENT_LABEL[e.type] || 'событие'}</span><span>ход ${e.turn}</span>${e.when ? `<span>⏱ ${esc(e.when)}</span>` : ''}${e.status === 'done' ? `<span>закрыто: ${OUTCOME_LABEL[e.outcome] || 'исполнено'}</span>` : ''}${e.locked ? '<span>🔒</span>' : ''}`;
    const text = document.createElement('div'); text.className = 'event-text'; text.textContent = e.text;
    el.append(meta, text);
    const who = [];
    if (e.participants.length) who.push('участники: ' + e.participants.join(', '));
    if (e.knownBy.length && e.knownBy.join() !== e.participants.join()) who.push('знают: ' + e.knownBy.join(', '));
    if (who.length) { const w = document.createElement('div'); w.className = 'event-who'; w.textContent = who.join(' · '); el.appendChild(w); }
    list.appendChild(el);
  }
}
function openEventModal(e) {
  editingEventId = e ? e.id : null;
  $('eventModalTitle').textContent = e ? 'Изменить запись' : 'Новая запись';
  $('eventType').value = e ? e.type : 'fact';
  $('eventTurn').value = e ? e.turn : (app.turn || 0);
  $('eventStatus').value = e ? (e.status === 'done' ? (e.outcome || 'done') : 'open') : 'open';
  $('eventWhen').value = e ? (e.when || '') : '';
  $('eventText').value = e ? e.text : '';
  $('eventParticipants').value = e ? e.participants.join(', ') : '';
  $('eventKnownBy').value = e ? e.knownBy.join(', ') : '';
  $('eventLocked').checked = Boolean(e && e.locked);
  $('eventDelete').style.display = e ? '' : 'none';
  $('eventModal').hidden = false;
  $('eventText').focus();
}
async function saveEvent() {
  try {
    const data = await api('/api/events', { method: 'POST', body: JSON.stringify({
      id: editingEventId || undefined, type: $('eventType').value, turn: $('eventTurn').value, status: $('eventStatus').value, when: $('eventWhen').value,
      text: $('eventText').value, participants: $('eventParticipants').value, knownBy: $('eventKnownBy').value, locked: $('eventLocked').checked,
    }) });
    applyState(data); $('eventModal').hidden = true;
  } catch (err) { toast(err.message); }
}
async function deleteEventNow() {
  if (!editingEventId) return;
  try { applyState(await api(`/api/events/${editingEventId}`, { method: 'DELETE' })); $('eventModal').hidden = true; }
  catch (err) { toast(err.message); }
}

// ---- Диагностика запросов ----
const DIAG_SEEN_KEY = 'diagSeenAt';
let diagItems = [];
let diagSelected = null;
const diagSeen = () => { try { return localStorage.getItem(DIAG_SEEN_KEY) || ''; } catch { return ''; } };
async function refreshDiagBadge() {
  try {
    const c = await api('/api/diag/counts?since=' + encodeURIComponent(diagSeen()));
    const dot = $('diagDot');
    dot.hidden = !(c.errors || c.warns);
    dot.classList.toggle('warn', !c.errors && c.warns > 0);
    $('diagBtn').title = c.errors || c.warns
      ? `Диагностика: новых ошибок ${c.errors}, предупреждений ${c.warns}`
      : 'Диагностика: запросы к модели и ошибки';
  } catch { /* не критично */ }
}
const DIAG_ICON = { ok: '✓', warn: '⚠', error: '✗' };
const fmtMs = (ms) => (ms >= 10000 ? Math.round(ms / 1000) + ' с' : (ms / 1000).toFixed(1) + ' с');
const fmtCost = (c) => (c === undefined ? '' : c < 0.01 ? '$' + c.toFixed(5) : '$' + c.toFixed(3));
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (d.toDateString() === new Date().toDateString() ? '' : ' ' + d.toLocaleDateString('ru-RU')); };
function diagMatches(r, f) {
  if (!f) return true;
  if (f === 'problem') return r.status !== 'ok';
  if (f === 'other') return !/рассказчик|учётчик/.test(r.purpose);
  return r.purpose.includes(f);
}
function renderDiagList() {
  const list = $('diagList'); list.innerHTML = '';
  const f = $('diagFilter').value;
  const shown = diagItems.filter((r) => diagMatches(r, f));
  if (!shown.length) {
    const p = document.createElement('p'); p.className = 'sheet-empty';
    p.textContent = diagItems.length ? 'Под фильтр ничего не попало.' : 'Запросов пока не было. Сделайте ход — здесь появится каждое обращение к модели.';
    list.appendChild(p); return;
  }
  for (const r of shown) {
    const el = document.createElement('div');
    el.className = 'diag-item ' + r.status + (r.id === diagSelected ? ' active' : '');
    el.dataset.id = r.id;
    const tokens = r.in !== undefined ? `${r.in}→${r.out ?? '?'} ток` : '';
    el.innerHTML = `<div class="diag-item-top"><span class="diag-purpose"><span class="diag-ico">${DIAG_ICON[r.status]}</span> ${esc(r.purpose)}</span><span class="diag-mini">${fmtTime(r.at)}</span></div>` +
      `<div class="diag-mini">${esc(r.model || '')} · ${fmtMs(r.ms || 0)}${tokens ? ' · ' + tokens : ''}${r.cost !== undefined ? ' · ' + fmtCost(r.cost) : ''}</div>` +
      (r.status !== 'ok' ? `<div class="diag-mini" style="color:var(--${r.status === 'error' ? 'danger' : 'brass'})">${esc(r.hint || (r.warn || []).join('; ') || r.error || '')}</div>` : '');
    list.appendChild(el);
  }
}
function msgText(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((x) => x.text || JSON.stringify(x)).join('\n');
  return m.content == null ? '' : JSON.stringify(m.content, null, 2);
}
function prettyArgs(a) { try { return JSON.stringify(JSON.parse(a || '{}'), null, 2); } catch { return String(a || ''); } }
const ROLE_RU = { system: 'системный промт', user: 'пользователь', assistant: 'модель', tool: 'результат инструмента' };
function diagMsgBlock(m, i) {
  const d = document.createElement('details'); d.className = 'diag-msg';
  let text = msgText(m);
  if (m.tool_calls && m.tool_calls.length) text += (text ? '\n\n' : '') + m.tool_calls.map((c) => `→ ${c.function?.name}(${prettyArgs(c.function?.arguments)})`).join('\n');
  d.innerHTML = `<summary><span><b>${i + 1}. ${ROLE_RU[m.role] || m.role}</b>${m.name ? ' · ' + esc(m.name) : ''}</span><span class="diag-mini">${text.length} симв.</span></summary>`;
  const pre = document.createElement('pre'); pre.className = 'diag-pre'; pre.textContent = text || '(пусто)';
  d.appendChild(pre);
  return d;
}
async function showDiag(id) {
  diagSelected = id; renderDiagList();
  const box = $('diagDetail');
  box.innerHTML = '<p class="sheet-empty">Загрузка…</p>';
  let rec;
  try { rec = await api('/api/diag/' + id); } catch (err) { box.innerHTML = ''; toast(err.message); return; }
  const { summary: r, full } = rec;
  box.innerHTML = '';
  const add = (html) => { const w = document.createElement('div'); w.innerHTML = html; while (w.firstChild) box.appendChild(w.firstChild); };
  add(`<h3>${DIAG_ICON[r.status]} ${esc(r.purpose)}</h3>`);
  const chips = [
    `<span class="diag-chip ${r.status}">${r.status === 'ok' ? 'успешно' : r.status === 'warn' ? 'с предупреждением' : 'ошибка' + (r.httpStatus ? ' ' + r.httpStatus : '')}</span>`,
    `<span class="diag-chip">${esc(r.model || '?')}${r.provider ? ' · ' + esc(r.provider) : ''}</span>`,
    `<span class="diag-chip">${fmtMs(r.ms || 0)}</span>`,
    r.in !== undefined ? `<span class="diag-chip">вход ${r.in} · выход ${r.out ?? '?'}${r.reasoning ? ` (из них размышления ${r.reasoning})` : ''}</span>` : '',
    r.cost !== undefined ? `<span class="diag-chip">${fmtCost(r.cost)}</span>` : '',
    r.finish ? `<span class="diag-chip">finish: ${esc(r.finish)}</span>` : '',
    `<span class="diag-chip">${fmtTime(r.at)}</span>`,
  ];
  add(`<div class="diag-chips">${chips.join('')}</div>`);
  if (r.status === 'error') add(`<div class="diag-alert"><strong>${esc(r.hint || 'Запрос не прошёл')}</strong><pre class="diag-pre">${esc((full && full.rawError) || r.error || '')}</pre></div>`);
  if (r.warn && r.warn.length) add(`<div class="diag-alert warn"><strong>Что настораживает</strong><ul>${r.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  if (r.fallbacks && r.fallbacks.length) {
    add(`<div class="diag-alert warn"><strong>Сработали откаты (запрос повторён с другими параметрами)</strong><ul>${r.fallbacks.map((f, i) => `<li>${esc(f)}<div class="diag-mini" style="white-space:normal">${esc((r.attemptErrors || [])[i] || '')}</div></li>`).join('')}</ul></div>`);
  }
  // Действия
  const act = document.createElement('div'); act.className = 'diag-actions';
  const copy = document.createElement('button'); copy.className = 'btn ghost'; copy.textContent = 'Скопировать JSON';
  copy.onclick = async () => {
    const txt = JSON.stringify({ summary: r, ...(full || {}) }, null, 2);
    try { await navigator.clipboard.writeText(txt); toast('Скопировано в буфер.'); }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Скопировано в буфер.'); }
  };
  act.appendChild(copy);
  if (full && full.request) {
    const inp = document.createElement('input'); inp.value = r.model || ''; inp.placeholder = 'модель для повтора'; inp.title = 'Тот же запрос можно отправить другой модели. На игру повтор не влияет.';
    const rep = document.createElement('button'); rep.className = 'btn'; rep.textContent = 'Повторить запрос';
    rep.onclick = async () => {
      rep.disabled = true; rep.textContent = 'Отправляю…';
      try {
        const { summary } = await api(`/api/diag/${r.id}/replay`, { method: 'POST', body: JSON.stringify({ model: inp.value }) });
        await loadDiag(); showDiag(summary.id);
      } catch (err) { toast(err.message); rep.disabled = false; rep.textContent = 'Повторить запрос'; }
    };
    act.append(inp, rep);
  }
  box.appendChild(act);
  if (r.replayOf) add(`<p class="diag-mini" style="white-space:normal">Повтор запроса — на игру не повлиял.</p>`);
  if (!full) { add('<p class="sheet-empty">Полное тело запроса уже вытеснено — хранятся только 20 последних.</p>'); return; }
  const req = full.request || {};
  add('<h3>Запрос</h3>');
  const params = [
    ['модель', req.model], ['temperature', req.temperature], ['presence / frequency', [req.presence_penalty, req.frequency_penalty].filter((x) => x !== undefined).join(' / ')],
    ['tool_choice', req.tool_choice], ['reasoning', req.reasoning ? JSON.stringify(req.reasoning) : ''], ['provider', req.provider ? JSON.stringify(req.provider) : ''],
    ['инструменты', (req.tools || []).map((t) => t.function?.name).join(', ')],
    ['всего символов', (req.messages || []).reduce((n, m) => n + msgText(m).length, 0)],
  ].filter(([, v]) => v !== undefined && v !== '');
  add(`<div class="diag-kv">${params.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div>`);
  (req.messages || []).forEach((m, i) => box.appendChild(diagMsgBlock(m, i)));
  add('<h3>Ответ</h3>');
  const resp = full.response;
  if (!resp) add('<p class="sheet-empty">Ответа нет — запрос завершился ошибкой.</p>');
  else {
    const msg = resp.choices?.[0]?.message || {};
    const text = msgText(msg);
    const pre = document.createElement('pre'); pre.className = 'diag-pre'; pre.textContent = text || '(текста нет)'; box.appendChild(pre);
    if (msg.reasoning) { const d = document.createElement('details'); d.className = 'diag-msg'; d.innerHTML = `<summary><span><b>Размышления модели</b></span><span class="diag-mini">${msg.reasoning.length} симв.</span></summary>`; const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = msg.reasoning; d.appendChild(p); box.appendChild(d); }
    for (const c of msg.tool_calls || []) {
      const d = document.createElement('details'); d.className = 'diag-msg'; d.open = true;
      d.innerHTML = `<summary><span><b>→ ${esc(c.function?.name || '?')}</b></span></summary>`;
      const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = prettyArgs(c.function?.arguments); d.appendChild(p); box.appendChild(d);
    }
    const raw = document.createElement('details'); raw.className = 'diag-msg';
    raw.innerHTML = '<summary><span><b>Сырой JSON ответа</b></span></summary>';
    const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = JSON.stringify(resp, null, 2); raw.appendChild(p); box.appendChild(raw);
  }
}
async function loadDiag() {
  try { diagItems = (await api('/api/diag')).items || []; } catch (err) { toast(err.message); diagItems = []; }
  renderDiagList();
}
async function openDiag() {
  $('diagModal').hidden = false;
  await loadDiag();
  try { localStorage.setItem(DIAG_SEEN_KEY, new Date().toISOString()); } catch { /* приватный режим */ }
  $('diagDot').hidden = true;
  const first = diagItems.find((r) => r.status !== 'ok') || diagItems[0];
  if (first && !diagSelected) showDiag(first.id);
  else if (diagSelected && diagItems.some((r) => r.id === diagSelected)) showDiag(diagSelected);
  else $('diagDetail').innerHTML = '<p class="sheet-empty">Выберите запрос слева.</p>';
}
function closeDiag() {
  $('diagModal').hidden = true;
  try { localStorage.setItem(DIAG_SEEN_KEY, new Date().toISOString()); } catch { /* приватный режим */ }
}

// ---- ✨ Заполнить поле по истории ----
const FILL_LABEL = {
  appearance: 'внешность', description: 'кто это', personality: 'характер', status: 'статус', history: 'что было с героем',
  wants: 'чего хочет', quirk: 'изюминку', secret: 'что скрывает', links: 'связи', attitude: 'отношение', mood: 'настроение', voice: 'голос',
  social: 'положение', persona: 'описание героя',
};
const FILL_TARGETS = {
  npc: {
    appearance: ['npcAppearance'], description: ['npcDescription'], personality: ['npcPersonality'], status: ['npcStatus'],
    history: ['npcHistory'], wants: ['npcWants'], quirk: ['npcQuirk'], secret: ['npcSecret'], links: ['npcLinks'], attitude: ['npcAttitude'],
    mood: ['npcMood', 'npcMoodReason'],
    voice: ['npcVoiceStyle', 'npcVoiceHumor', 'npcVoiceHabits', 'npcVoiceSamples', 'npcVoiceMasks', 'npcVoiceTaboos'],
  },
  hero: { appearance: ['charAppearance'], social: ['charSocial'], persona: ['charPersona'] },
};
const FILL_VALUE_IDS = {
  voiceStyle: 'npcVoiceStyle', voiceHumor: 'npcVoiceHumor', voiceHabits: 'npcVoiceHabits', voiceSamples: 'npcVoiceSamples',
  voiceMasks: 'npcVoiceMasks', voiceTaboos: 'npcVoiceTaboos', mood: 'npcMood', moodReason: 'npcMoodReason',
};
const fillUndo = new Map(); // "kind:field" → { id: прежнее значение }
let fillCtx = null;         // для какой кнопки открыто меню

function makeFillBtn(kind, field) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fill-btn'; b.dataset.kind = kind; b.dataset.fill = field;
  b.textContent = '✨';
  b.title = `Заполнить «${FILL_LABEL[field]}» по истории`;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openFillMenu(b); });
  const u = document.createElement('button');
  u.type = 'button'; u.className = 'fill-undo'; u.hidden = true; u.textContent = '↶';
  u.title = 'Вернуть, как было до заполнения';
  u.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); undoFill(kind, field); });
  const wrap = document.createElement('span'); wrap.className = 'fill-wrap'; wrap.append(u, b);
  return wrap;
}
function installFillButtons() {
  // НПС: рядом с замком в подписи поля.
  for (const lock of document.querySelectorAll('#npcModal .lock-label .lock')) {
    const f = lock.dataset.field;
    if (FILL_TARGETS.npc[f]) lock.before(makeFillBtn('npc', f));
  }
  // Герой: в подписи поля.
  for (const [f, [id]] of Object.entries(FILL_TARGETS.hero)) {
    const el = $(id); const box = el && el.closest('.field, .field-col');
    const label = box && box.querySelector('.field-label');
    if (!label) continue;
    const row = document.createElement('div'); row.className = 'lock-label';
    label.replaceWith(row); row.append(label, makeFillBtn('hero', f));
  }
  const menu = document.createElement('div');
  menu.id = 'fillMenu'; menu.className = 'fill-menu'; menu.hidden = true;
  menu.innerHTML = '<div class="fill-menu-title"></div>' +
    '<button type="button" data-mode="text"><b>Из текста</b><span>только то, что сказано в истории</span></button>' +
    '<button type="button" data-mode="invent"><b>Придумать</b><span>известное + недостающее в духе мира</span></button>';
  menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b && fillCtx) runFill(fillCtx, b.dataset.mode); });
  document.body.appendChild(menu);
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true; });
  for (const kind of ['npc', 'hero']) {
    for (const [f, ids] of Object.entries(FILL_TARGETS[kind])) {
      for (const id of ids) $(id).addEventListener('input', () => $(id).classList.remove('ai-filled'));
    }
  }
}
function openFillMenu(btn) {
  if (btn.classList.contains('busy')) return;
  const menu = $('fillMenu');
  fillCtx = btn;
  menu.querySelector('.fill-menu-title').textContent = `${btn.dataset.kind === 'hero' ? 'Герой' : 'Персонаж'}: ${FILL_LABEL[btn.dataset.fill]}`;
  menu.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
function fillCard(kind) {
  if (kind === 'hero') {
    return { name: $('charName').value, race: $('charRace').value, social: $('charSocial').value, appearance: $('charAppearance').value, persona: $('charPersona').value };
  }
  const card = {};
  for (const [field, id] of Object.entries(NPC_FIELD_IDS)) card[field] = $(id).value;
  card.voice = { style: card.voiceStyle, humor: card.voiceHumor, habits: card.voiceHabits, masks: card.voiceMasks, taboos: card.voiceTaboos,
    samples: $('npcVoiceSamples').value.split('\n').map((x) => x.trim()).filter(Boolean) };
  for (const k of ['voiceStyle', 'voiceHumor', 'voiceHabits', 'voiceMasks', 'voiceTaboos']) delete card[k];
  card.mood = card.mood || card.moodReason ? { mood: card.mood, reason: card.moodReason } : '';
  delete card.moodReason;
  card.traits = [...npcTraitSel].join(', ');
  return card;
}
async function runFill(btn, mode) {
  $('fillMenu').hidden = true;
  const { kind, fill: field } = btn.dataset;
  const card = fillCard(kind);
  if (kind === 'npc' && !String(card.name || '').trim()) { toast('Сначала впишите имя или описание персонажа — по нему ищется история.'); return; }
  btn.classList.add('busy'); btn.disabled = true;
  try {
    const r = await api('/api/fill', { method: 'POST', body: JSON.stringify({
      kind, field, mode, card, id: kind === 'hero' ? editingCharId : editingNpcId,
    }) });
    if (r.none) {
      toast(`В истории про «${FILL_LABEL[field]}» ничего не сказано${kind === 'npc' && !r.mentions ? ' (упоминаний персонажа не нашлось)' : ''}. Можно «Придумать».`);
      return;
    }
    const key = `${kind}:${field}`;
    const prev = {};
    for (const id of FILL_TARGETS[kind][field]) prev[id] = $(id).value;
    if (!fillUndo.has(key)) fillUndo.set(key, prev);
    const set = (id, v) => { const el = $(id); el.value = v; el.classList.add('ai-filled'); el.dispatchEvent(new Event('fill-set')); };
    if (r.values) {
      for (const [k, v] of Object.entries(r.values)) {
        const id = FILL_VALUE_IDS[k]; if (!id) continue;
        set(id, Array.isArray(v) ? v.join('\n') : v);
      }
    } else set(FILL_TARGETS[kind][field][0], r.value);
    const el = $(FILL_TARGETS[kind][field][0]);
    if (el.tagName === 'TEXTAREA') { el.style.height = 'auto'; el.style.height = Math.min(400, el.scrollHeight + 2) + 'px'; }
    btn.parentElement.querySelector('.fill-undo').hidden = false;
    toast(mode === 'invent' ? 'Заполнено — недостающее придумано. Проверьте и сохраните.' : 'Заполнено по истории. Проверьте и сохраните.');
  } catch (err) { toast(err.message); }
  finally { btn.classList.remove('busy'); btn.disabled = false; }
}
function undoFill(kind, field) {
  const key = `${kind}:${field}`;
  const prev = fillUndo.get(key);
  if (!prev) return;
  for (const [id, v] of Object.entries(prev)) { $(id).value = v; $(id).classList.remove('ai-filled'); }
  fillUndo.delete(key);
  const u = document.querySelector(`.fill-btn[data-kind="${kind}"][data-fill="${field}"]`);
  if (u) u.parentElement.querySelector('.fill-undo').hidden = true;
}
function resetFill(kind) {
  for (const key of [...fillUndo.keys()]) if (key.startsWith(kind + ':')) fillUndo.delete(key);
  for (const u of document.querySelectorAll(`.fill-btn[data-kind="${kind}"]`)) u.parentElement.querySelector('.fill-undo').hidden = true;
  for (const ids of Object.values(FILL_TARGETS[kind])) for (const id of ids) $(id).classList.remove('ai-filled');
  if ($('fillMenu')) $('fillMenu').hidden = true;
}
function syncFillLocks() {
  for (const b of document.querySelectorAll('.fill-btn[data-kind="npc"]')) b.parentElement.hidden = npcLocks.has(b.dataset.fill);
  const hb = document.querySelector('.fill-btn[data-kind="hero"][data-fill="appearance"]');
  if (hb) hb.parentElement.hidden = $('charLookLock').checked;
}

// ---- Иллюстрации сцен ----
const scenePos = new Map(); // индекс реплики → какая из её картинок показана
function sceneFigure(entry, index) {
  const imgs = entry.images;
  let pos = scenePos.has(index) ? scenePos.get(index) : imgs.length - 1;
  pos = Math.max(0, Math.min(imgs.length - 1, pos));
  const im = imgs[pos];
  const fig = document.createElement('figure');
  fig.className = 'scene-figure';
  const img = document.createElement('img');
  img.src = `/scenes/${im.file}`; img.alt = im.moment || 'Иллюстрация сцены'; img.loading = 'lazy';
  if (im.width && im.height) img.style.aspectRatio = `${im.width} / ${im.height}`;
  img.addEventListener('click', () => showImage(im.file, im.moment || '', 'scenes'));
  fig.appendChild(img);
  const cap = document.createElement('figcaption');
  const mkb = (txt, title, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'scene-fig-btn ' + cls; b.textContent = txt; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
  if (imgs.length > 1) {
    const nav = document.createElement('span'); nav.className = 'scene-fig-nav';
    const go = (d) => { scenePos.set(index, (pos + d + imgs.length) % imgs.length); fig.replaceWith(sceneFigure(entry, index)); };
    const cnt = document.createElement('span'); cnt.className = 'scene-fig-count'; cnt.textContent = `${pos + 1}/${imgs.length}`;
    nav.append(mkb('‹', 'Предыдущая', () => go(-1)), cnt, mkb('›', 'Следующая', () => go(1)));
    cap.appendChild(nav);
  }
  const m = document.createElement('span'); m.className = 'scene-fig-moment'; m.textContent = im.moment || '';
  cap.appendChild(m);
  cap.append(
    mkb('✎', 'Открыть кадр: поправить теги, перерисовать с этим или другим зерном', () => openIllusModal(index, im)),
    mkb('✕', 'Убрать картинку из ленты', () => removeSceneImage(index, pos), 'danger'),
  );
  fig.appendChild(cap);
  return fig;
}
async function removeSceneImage(index, n) {
  if (!confirm('Убрать эту картинку из ленты?')) return;
  try {
    const data = await api(`/api/log/${index}/images/${n}`, { method: 'DELETE' });
    scenePos.delete(index);
    app.log = data.log; if (!sending) refreshLogKeepScroll();
  } catch (err) { toast(err.message); }
}

const illusJob = { index: null, busy: false, timer: null };
function illusSetBusy(busy, label) {
  illusJob.busy = busy;
  for (const id of ['illusDraw', 'illusReseed', 'illusReframe']) $(id).disabled = busy;
  const st = $('illusStatus');
  clearInterval(illusJob.timer);
  if (!busy) { st.textContent = label || ''; return; }
  const t0 = Date.now();
  const tick = () => { st.textContent = `${label} ${Math.floor((Date.now() - t0) / 1000)} с`; };
  tick(); illusJob.timer = setInterval(tick, 500);
}
function illusPreview(im) {
  const box = $('illusPreview');
  box.innerHTML = '';
  if (!im) { box.hidden = true; return; }
  box.hidden = false;
  const img = document.createElement('img'); img.src = `/scenes/${im.file}`; img.alt = '';
  img.addEventListener('click', () => showImage(im.file, im.moment || '', 'scenes'));
  box.appendChild(img);
}
async function openIllusModal(index, image = null) {
  const entry = app.log[index];
  if (!entry || entry.role !== 'narrator') return;
  if (illusJob.busy && illusJob.index !== index) { toast('Уже рисуется другая картинка — дождитесь её.'); return; }
  $('illusModal').hidden = false;
  if (illusJob.busy) return; // вернулись к окну, пока рисуется
  illusJob.index = index;
  $('illusFragment').textContent = entry.text.length > 260 ? entry.text.slice(0, 260) + '…' : entry.text;
  $('illusCands').textContent = '';
  illusPreview(null);
  if (image) {
    $('illusTags').value = image.tags || '';
    $('illusSeed').value = image.seed >= 0 ? image.seed : '';
    $('illusMoment').textContent = image.moment || '';
    illusPreview(image);
    illusSetBusy(false, 'Можно поправить теги и перерисовать — с тем же зерном выйдет тот же кадр с изменениями.');
    return;
  }
  $('illusTags').value = '';
  $('illusSeed').value = '';
  $('illusMoment').textContent = '';
  await illusReframe();
}
async function illusReframe() {
  const index = illusJob.index;
  illusSetBusy(true, 'Модель выбирает кадр…');
  try {
    const r = await api(`/api/log/${index}/scene-prompt`, { method: 'POST' });
    if (illusJob.index !== index) return;
    $('illusTags').value = r.tags;
    $('illusMoment').textContent = r.moment || '';
    const inFrame = (r.characters || []).map((x) => x.toLowerCase());
    const noTags = (r.candidates || []).filter((c) => !c.hasPortraitTags && (!inFrame.length || inFrame.includes(c.name.toLowerCase()))).map((c) => c.name);
    $('illusCands').textContent = (r.characters && r.characters.length ? 'В кадре: ' + r.characters.join(', ') + '. ' : 'Кадр без персонажей. ') +
      (noTags.length ? `Без портрета: ${noTags.join(', ')} — приметы взяты из описания; с портретом персонаж узнаваемее.` : '');
    illusSetBusy(false, 'Проверьте теги и нажмите «Нарисовать».');
  } catch (err) { illusSetBusy(false, ''); toast(err.message); }
}
async function illusDraw(seed) {
  const index = illusJob.index;
  const tags = $('illusTags').value.trim();
  if (!tags) { toast('Сначала нужно описание кадра.'); return; }
  illusSetBusy(true, 'Рисую…');
  try {
    const data = await api(`/api/log/${index}/illustrate`, { method: 'POST', body: JSON.stringify({ tags, seed, moment: $('illusMoment').textContent }) });
    $('illusSeed').value = data.image.seed >= 0 ? data.image.seed : '';
    illusPreview(data.image);
    illusSetBusy(false, `Готово, зерно ${data.image.seed}. Картинка добавлена в ленту.` + (data.warnings && data.warnings.length ? ' ⚠ ' + data.warnings.join('; ') + '.' : ''));
    app.log = data.log;
    scenePos.delete(index);
    if (!sending) refreshLogKeepScroll();
    if ($('illusModal').hidden) toast('Иллюстрация готова.');
  } catch (err) { illusSetBusy(false, ''); toast(err.message); }
}

// ---- Пресеты стиля картинок ----
const IMAGE_PRESETS = {
  "anime": {
    "imageStyle": "score_9, score_8_up, score_7_up, source_anime, anime screencap, anime coloring, cel shading, clean lineart, portrait, upper body, looking at viewer, detailed face, detailed eyes, dramatic lighting, dark moody background",
    "imageNegative": "score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, text, watermark, signature, multiple views, child, teen, young, chibi, loli, shota",
    "sceneStyle": "score_9, score_8_up, score_7_up, source_anime, rating_safe, anime screencap, anime coloring, cel shading, detailed background, scenery, cinematic composition, dramatic lighting, atmospheric",
    "sceneNegative": "score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, extra limbs, bad anatomy, bad eyes, deformed eyes, extra mouth, distorted face, text, watermark, signature, multiple views, comic, panels, nsfw, nude, explicit, gore, child, teen, chibi, loli, shota"
  },
  "real": {
    "imageStyle": "score_9, score_8_up, score_7_up, portrait, upper body, looking at viewer, detailed face, realistic proportions, dramatic lighting, dark moody background, illustration",
    "imageNegative": "score_6, score_5, score_4, worst quality, low quality, blurry, deformed, extra fingers, text, watermark, signature, multiple views, child, teen, young, chibi, loli, shota, cute, big eyes",
    "sceneStyle": "score_9, score_8_up, score_7_up, rating_safe, scenery, detailed background, cinematic composition, dramatic lighting, atmospheric, illustration",
    "sceneNegative": "score_6, score_5, score_4, worst quality, low quality, blurry, deformed, extra fingers, extra limbs, bad anatomy, bad eyes, deformed eyes, extra mouth, distorted face, text, watermark, signature, multiple views, comic, panels, nsfw, nude, explicit, gore, child, teen, chibi, loli, shota"
  }
};
function applyImagePreset(name) {
  const p = IMAGE_PRESETS[name]; if (!p) return;
  for (const [k, id] of [['imageStyle', 'imageStyleInput'], ['imageNegative', 'imageNegativeInput'], ['sceneStyle', 'sceneStyleInput'], ['sceneNegative', 'sceneNegativeInput']]) {
    $(id).value = p[k]; $(id).classList.add('ai-filled');
  }
  toast(name === 'anime' ? 'Подставлен аниме-стиль для портретов и сцен — нажмите «Сохранить».' : 'Подставлен прежний, полуреалистичный стиль — нажмите «Сохранить».');
}

// ---- Просмотр картинки ----
function showImage(filename, caption, dir = 'avatars') {
  if (!filename) return;
  $('lightboxImg').src = `/${dir}/${filename}`;
  $('lightboxCaption').textContent = caption || '';
  $('lightbox').hidden = false;
}
function renderHeroStrip() {
  const c = activeChar();
  const strip = $('heroStrip');
  if (!c) { strip.hidden = true; return; }
  strip.hidden = false;
  const p = $('heroPortrait');
  p.style.backgroundImage = c.avatar ? `url('/avatars/${c.avatar}')` : '';
  p.textContent = c.avatar ? '' : '✦';
  p.style.display = 'flex'; p.style.alignItems = 'center'; p.style.justifyContent = 'center'; p.style.color = 'var(--text-faint)';
  $('heroStripName').textContent = c.name;
  $('heroStripSub').textContent = [c.race, c.social].filter(Boolean).join(' · ') || (c.description || '').slice(0, 120);
}

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

// ---- Вкладки героев ----
function renderTabs() {
  charTabsEl.innerHTML = '';
  // Переключатель нужен, только когда героев больше одного.
  $('heroSwitch').hidden = app.characters.length < 2;
  for (const c of app.characters) {
    const tab = document.createElement('button');
    tab.className = 'char-tab' + (c.id === app.activeCharacterId ? ' active' : '');
    if (c.avatar) {
      const av = document.createElement('span');
      av.className = 'tab-avatar';
      av.style.backgroundImage = `url('/avatars/${c.avatar}')`;
      tab.appendChild(av);
    }
    tab.appendChild(document.createTextNode(c.name));
    if (c.present === false) tab.classList.add('absent');
    tab.title = (c.persona || c.name) + (c.present === false ? ' · не в истории' : '');

    // Глазок прямо на вкладке: убрать героя из истории можно, не переключаясь
    // на него — иначе он стал бы активным, а активного убрать нельзя.
    if (c.id !== app.activeCharacterId) {
      const eye = document.createElement('span');
      eye.className = 'tab-eye';
      eye.dataset.id = c.id;
      eye.textContent = c.present === false ? '\u25CB' : '\u25CF';
      eye.title = c.present === false ? 'Вернуть в историю' : 'Убрать из истории';
      eye.addEventListener('click', (ev) => {
        ev.stopPropagation();   // не переключаться на героя при клике по глазку
        togglePresence(c.id, c.present === false);
      });
      tab.appendChild(eye);
    }
    tab.addEventListener('click', () => switchChar(c.id));
    if (changedChars.has(c.id) && c.id !== app.activeCharacterId) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      tab.appendChild(dot);
    }
    charTabsEl.appendChild(tab);
  }
}

async function togglePresence(id, present) {
  try {
    const data = await api(`/api/characters/${id}/presence`, { method: 'POST', body: JSON.stringify({ present }) });
    applyState(data);
  } catch (err) { toast(err.message); }
}

async function switchChar(id) {
  if (id === app.activeCharacterId) return;
  changedChars.delete(id);
  try {
    const data = await api(`/api/characters/${id}/activate`, { method: 'POST' });
    // Переключение листа — без анимации «впечатывания».
    blockSignatures = {};
    applyState(data, { animate: false });
    // Зафиксировать сигнатуры активного листа, чтобы дальше ловить изменения.
    for (const b of activeChar().blocks) blockSignatures[b.id] = blockSig(b);
  } catch (err) { toast(err.message); }
}

// ---- Лист активного героя ----
function renderSheet(character, animate) {
  const blocks = character ? character.blocks : [];
  if (!blocks.length) {
    sheetEl.innerHTML = '';
    sheetEl.appendChild(sheetEmpty);
    sheetEmpty.style.display = '';
    if (!animate) blockSignatures = {};
    return;
  }
  sheetEl.innerHTML = '';
  const nextSigs = {};
  const types = Object.keys(TYPE_META).sort((a, b) => TYPE_META[a].order - TYPE_META[b].order);
  for (const type of types) {
    const items = blocks.filter((b) => b.type === type);
    if (!items.length) continue;
    const group = document.createElement('div');
    group.className = 'group';
    const title = document.createElement('p');
    title.className = 'group-title';
    title.textContent = TYPE_META[type].label;
    group.appendChild(title);
    for (const b of items) {
      const sig = blockSig(b);
      nextSigs[b.id] = sig;
      const changed = animate && blockSignatures[b.id] !== sig;
      group.appendChild(renderBlock(b, changed));
    }
    sheetEl.appendChild(group);
  }
  blockSignatures = nextSigs;
}

function renderBlock(b, animate) {
  const meta = TYPE_META[b.type] || {};
  const el = document.createElement('div');
  el.className = 'block' + (animate ? ' inscribed' : '');
  el.style.setProperty('--type-color', meta.color || 'var(--brass)');

  const row = document.createElement('div');
  row.className = 'block-row';
  const nameWrap = document.createElement('span');
  nameWrap.innerHTML = `<span class="block-glyph">${meta.glyph || '•'}</span>`;
  const name = document.createElement('span');
  name.className = 'block-name';
  name.textContent = b.name;
  nameWrap.appendChild(name);
  if (b.locked || b.descLocked) {
    const lock = document.createElement('span');
    lock.className = 'block-lock';
    lock.title = b.locked ? 'Закреплено игроком' : 'Описание закреплено — значение меняется';
    lock.textContent = b.locked ? '🔒' : '📌';
    nameWrap.appendChild(lock);
  }
  el.dataset.id = b.id;
  row.appendChild(nameWrap);

  if (b.type === 'status') {
    const def = (app.statusCatalog || []).find((d) => d.name.toLowerCase() === b.name.toLowerCase());
    const bits = [];
    const rm = b.rollMod ?? def?.rollMod;
    const tk = b.tick ?? def?.tick;
    if (rm) bits.push((rm > 0 ? '+' : '') + rm + ' к броскам');
    if (tk && tk.stat) bits.push(tk.stat + ' ' + (tk.delta > 0 ? '+' : '') + tk.delta + '/ход');
    if (b.duration != null) bits.push(b.duration + ' х.');
    if (bits.length) {
      const fx = document.createElement('span');
      fx.className = 'block-value status-fx';
      fx.textContent = bits.join(' · ');
      row.appendChild(fx);
    }
  } else if (b.value != null && b.value !== '') {
    const val = document.createElement('span');
    const numeric = b.type === 'stat' && b.max != null;
    val.className = 'block-value' + (numeric ? ' numeric' : '');
    val.textContent = numeric ? `${b.value} / ${b.max}` : b.value;
    row.appendChild(val);
  }
  el.appendChild(row);

  if (b.type === 'stat' && b.max != null) {
    const num = Number(b.value);
    if (Number.isFinite(num) && b.max > 0) {
      const bar = document.createElement('div');
      bar.className = 'block-bar';
      const fill = document.createElement('span');
      fill.style.width = Math.max(0, Math.min(100, (num / b.max) * 100)) + '%';
      bar.appendChild(fill);
      el.appendChild(bar);
    }
  }
  if (b.description) {
    const desc = document.createElement('div');
    desc.className = 'block-desc';
    desc.textContent = b.description;
    el.appendChild(desc);
  }
  const del = document.createElement('button');
  del.className = 'block-del';
  del.title = 'Удалить блок';
  del.textContent = '✕';
  del.dataset.id = b.id;
  el.appendChild(del);
  return el;
}

// ---- Разметка текста ----
// Речь в кавычках («…», "…") и действия/мысли в *…* подсвечиваются,
// чтобы полотно прозы читалось глазами, а не сплошняком.
// ---- Журнал учёта: что модель записала за ход ----
const TOOL_LABEL = {
  block: 'лист', create_block: 'лист', update_block: 'лист', remove_block: 'лист',
  npc: 'НПС', create_npc: 'НПС', update_npc: 'НПС', remove_npc: 'НПС',
  scene: 'сцена', event: 'факт', thread: 'нить', update_hero: 'герой', record_lore: 'мир', nothing: '—',
};
// Короткая строка «что сделано» из аргументов вызова.
function describeCall(c) {
  const a = c.args || {};
  switch (c.name) {
    case 'block': case 'create_block': case 'update_block': case 'remove_block': {
      const rm = a.action === 'remove' || c.name === 'remove_block';
      return `${rm ? '− ' : ''}${a.name || '?'}${!rm && a.value ? ': ' + a.value + (a.max ? ' / ' + a.max : '') : ''}${a.character ? ' (' + a.character + ')' : ''}`;
    }
    case 'npc': case 'create_npc': case 'update_npc': case 'remove_npc': {
      if (a.action === 'archive' || c.name === 'remove_npc') return `${a.name} → в архив`;
      const fields = Object.keys(a).filter((k) => !['name', 'action'].includes(k));
      return `${a.name}${a.new_name ? ' → ' + a.new_name : ''}${fields.length ? ': ' + fields.map((k) => k === 'attitude' ? 'отношение «' + a[k] + '»' : k === 'status' ? 'статус «' + a[k] + '»' : k === 'voice_sample' ? 'реплика' : k).join(', ') : ''}`;
    }
    case 'scene': return [a.location, a.elapsed_minutes ? '+' + a.elapsed_minutes + ' мин' : '', a.time, a.present ? 'рядом: ' + (a.present || 'никого') : '', a.note].filter(Boolean).join(' · ');
    case 'event': return a.action === 'close' ? `закрыто ${a.id || ''}${a.outcome ? ` (${OUTCOME_LABEL[a.outcome] || a.outcome})` : ''}${a.text ? ': ' + a.text : ''}`
      : a.action === 'update' ? `поправлено ${a.id || ''}: ${a.text || a.when || ''}` : `${a.text || ''}${a.when ? ` ⏱ ${a.when}` : ''}`;
    case 'thread': return `${a.title || ''}${a.action && a.action !== 'update' ? ' — ' + a.action : ''}${a.progress ? ': ' + a.progress : ''}`;
    case 'nothing': return 'без изменений';
    default: return Object.values(a).join(' · ');
  }
}
// ---- Сводка учёта: по журналам всех ходов, отдельно по каждой модели ----
const STAT_TOOLS = [['block', 'лист'], ['npc', 'НПС'], ['scene', 'сцена'], ['event', 'факты'], ['thread', 'нити']];
const TOOL_GROUP = { create_block: 'block', update_block: 'block', remove_block: 'block', create_npc: 'npc', update_npc: 'npc', remove_npc: 'npc' };
function syncStats(log) {
  const by = new Map();
  const add = (s) => {
    if (!s || !s.status || s.status === 'inline') return;
    const key = s.model ? shortModel(s.model) : 'модель не записана';
    if (!by.has(key)) by.set(key, { turns: 0, calls: 0, warn: 0, fix: 0, nothing: 0, skipped: 0, failed: 0, tools: {}, ms: 0, timed: 0 });
    const m = by.get(key);
    m.turns++;
    if (s.timing && s.timing.length) { m.ms += sumMs(s.timing); m.timed++; }
    if (s.status === 'skipped') { m.skipped++; return; }
    if (s.status === 'failed') m.failed++;
    const calls = s.calls || [];
    const real = calls.filter((c) => c.name !== 'nothing' && !c.check);
    if (!real.length && s.status !== 'failed') m.nothing++;
    if (calls.some((c) => c.round > 1)) m.fix++;
    for (const c of real) {
      m.calls++;
      if (c.warn) m.warn++;
      const g = TOOL_GROUP[c.name] || c.name;
      m.tools[g] = (m.tools[g] || 0) + 1;
    }
  };
  for (const e of log || []) {
    if (e.role !== 'narrator') continue;
    add(e.sync);
    for (const p of e.syncHistory || []) add(p);
  }
  return by;
}
function renderSyncStats() {
  const body = $('syncStatsBody');
  const by = syncStats(app.log);
  body.innerHTML = '';
  if (!by.size) { body.textContent = 'Пока нет ходов с журналом учёта.'; return; }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const table = document.createElement('table');
  table.className = 'stats-table';
  const head = ['модель', 'ходов', 'записей / ход', 'время / ход', ...STAT_TOOLS.map(([, l]) => l), 'предупр.', '2-й раунд', 'без изм.', 'пропуск', 'сбой'];
  table.innerHTML = '<thead><tr>' + head.map((h) => `<th>${h}</th>`).join('') + '</tr></thead>';
  const tb = document.createElement('tbody');
  for (const [model, m] of by) {
    const active = m.turns - m.skipped;
    const cells = [
      model, m.turns, active ? (m.calls / active).toFixed(1) : '—', m.timed ? fmtSec(m.ms / m.timed) : '—',
      ...STAT_TOOLS.map(([k]) => m.tools[k] || 0),
      pct(m.warn, m.calls), pct(m.fix, active), pct(m.nothing, active), pct(m.skipped, m.turns), m.failed,
    ];
    const tr = document.createElement('tr');
    for (const c of cells) { const td = document.createElement('td'); td.textContent = String(c); tr.appendChild(td); }
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  // Рассказчик — отдельной строкой: его модель от модели учёта не зависит.
  const narr = new Map();
  for (const e of app.log || []) {
    const list = e.role === 'narrator' && e.timing && e.timing.narrate;
    if (!list || !list.length) continue;
    const k = shortModel(list[0].model) || '?';
    if (!narr.has(k)) narr.set(k, { ms: 0, n: 0 });
    const r = narr.get(k); r.ms += sumMs(list.filter((t) => !t.cont)); r.n++;
  }
  if (narr.size) {
    const p = document.createElement('p');
    p.className = 'stats-narr';
    p.textContent = 'Рассказчик, среднее время ответа: ' + [...narr].map(([k, r]) => `${k} — ${fmtSec(r.ms / r.n)} (${r.n} ${plural(r.n, 'ход', 'хода', 'ходов')})`).join('; ');
    body.appendChild(p);
  }
  body.appendChild(table);
}

// ---- Время ответа моделей ----
const sumMs = (list) => (list || []).reduce((a, t) => a + (Number(t.ms) || 0), 0);
const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' с';
const fmtTok = (n) => (n == null ? '?' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(n));
function renderTiming(entry) {
  const tm = entry.timing || {};
  const parts = [
    ['рассказ', tm.narrate || []],
    ['учёт', (entry.sync && entry.sync.timing) || []],
    ['сжатие', tm.summary || []],
  ].filter(([, list]) => list.length);
  if (!parts.length) return null;
  const total = parts.reduce((a, [, l]) => a + sumMs(l), 0);
  const el = document.createElement('div');
  el.className = 'turn-timing';
  el.textContent = '⏱ ' + fmtSec(total) + ' — ' + parts.map(([k, l]) => `${k} ${fmtSec(sumMs(l))}`).join(' · ');
  // Подробности — по каждому запросу: время, токены на вход → выход, модель.
  const lines = [];
  for (const [k, list] of parts) {
    list.forEach((t, i) => {
      lines.push(`${k}${list.length > 1 ? ' #' + (i + 1) : ''}${t.cont ? ' (договорить)' : ''}: ${fmtSec(t.ms)}` +
        `, токены ${fmtTok(t.in)} → ${fmtTok(t.out)}` + (t.model ? `, ${shortModel(t.model)}` : '') + (t.error ? ' — ошибка' : ''));
    });
  }
  const tokIn = parts.reduce((a, [, l]) => a + l.reduce((b, t) => b + (t.in || 0), 0), 0);
  const tokOut = parts.reduce((a, [, l]) => a + l.reduce((b, t) => b + (t.out || 0), 0), 0);
  if (tokIn || tokOut) lines.push(`всего токенов: ${fmtTok(tokIn)} → ${fmtTok(tokOut)}`);
  el.title = lines.join('\n');
  return el;
}

const shortModel = (m) => String(m || '').replace(/^.*\//, '').replace(/:.*$/, '');
async function resyncTurn(btn) {
  if (sending) return;
  const current = app.toolModel || app.model || '';
  const model = prompt('Переучесть ход. Модель учёта (слаг OpenRouter) — оставь как есть или впиши другую для сравнения:', current);
  if (model === null) return;
  sending = true;
  btn.disabled = true;
  btn.textContent = '↻ переучитываю…';
  try {
    const data = await api('/api/resync', { method: 'POST', body: JSON.stringify({ model: model.trim() }) });
    applyFullState(data);
    toast('Ход переучтён. Прежний журнал — внутри, под новым.');
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '↻ переучесть ход';
  } finally { endBusy({ focus: false }); }
}

function renderSyncJournal(sync, prefix = '') {
  const calls = sync.calls || [];
  const real = calls.filter((c) => c.name !== 'nothing' && !c.check);
  const warns = calls.filter((c) => c.warn && !c.check).length;
  const checked = calls.some((c) => c.check);
  const box = document.createElement('details');
  box.className = 'sync-log' + (sync.status === 'failed' ? ' failed' : '') + (warns ? ' has-warn' : '');
  const sum = document.createElement('summary');
  let label;
  if (sync.status === 'skipped') label = 'учёт пропущен — короткий ход без признаков перемен';
  else if (sync.status === 'failed' && !calls.length) label = 'учёт не сработал';
  else if (!real.length) label = 'учёт: без изменений';
  else label = `учёт: ${real.length} ${plural(real.length, 'запись', 'записи', 'записей')}`;
  if (sync.status === 'inline') label = label.replace('учёт', 'рассказчик');
  if (sync.status === 'failed' && calls.length) label += ' · сбой';
  if (warns) label += ` · ⚠ ${warns}`;
  if (checked) label += ' · дозапрос по полноте';
  else if (calls.some((c) => c.round > 1)) label += ' · с исправлением';
  if (sync.model) label = label.replace(/^(учёт|рассказчик)/, `$1 · ${shortModel(sync.model)}`);
  if (sync.resynced) label += ' · переучтено';
  sum.textContent = (prefix ? '' : '📋 ') + prefix + label;
  box.appendChild(sum);
  if (sync.error) {
    const e = document.createElement('div');
    e.className = 'sync-error';
    e.textContent = sync.error;
    box.appendChild(e);
  }
  for (const c of calls) {
    const row = document.createElement('div');
    row.className = 'sync-row' + (c.warn ? ' warn' : '') + (c.round > 1 ? ' fix' : '');
    const tag = document.createElement('span');
    tag.className = 'sync-tag';
    tag.textContent = c.check ? 'полнота' : (TOOL_LABEL[c.name] || c.name) + (c.round > 1 ? ' ↺' : '') + (c.cont ? ' +' : '') + (c.leaked ? ' ⚑' : '');
    const what = document.createElement('span');
    what.className = 'sync-what';
    what.textContent = c.check ? 'код заметил возможный пропуск и попросил дописать:' : describeCall(c);
    const res = document.createElement('div');
    res.className = 'sync-res';
    res.textContent = c.result;
    row.append(tag, what, res);
    row.title = JSON.stringify(c.args, null, 1);
    box.appendChild(row);
  }
  return box;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function renderRichText(container, text) {
  // Пустая строка — граница абзаца: абзацы рисуем блоками с отступом, а не
  // двумя переводами строки — так текст плотнее и ровнее.
  // Внутри абзаца разбираем построчно: реплика через тире опознаётся только в
  // начале строки, иначе пунктуационное тире («коридор — узкий») попало бы под подсветку.
  const paras = String(text).replace(/\r/g, '').split(/\n[ \t]*\n+/);
  for (const para of paras) {
    if (!para.trim()) continue;
    const p = document.createElement('div');
    p.className = 'tx-p';
    para.split('\n').forEach((line, li) => {
      if (li > 0) p.appendChild(document.createElement('br'));
      renderLine(p, line);
    });
    container.appendChild(p);
  }
}

// Речь в кавычках и действия в *…*.
const INLINE_RE = /(«[^»]*»|"[^"]*"|\*[^*\n]+\*)/g;
// Тире, начинающее реплику.
const DASH_START = /^(\s*)([—–])(\s)/;
// Слова автора внутри реплики: « — сказал он» или « — Она щурится.»
const AUTHOR_BREAK = /\s[—–]\s/;

function renderLine(container, line) {
  const dash = line.match(DASH_START);
  if (!dash) { renderInline(container, line); return; }

  const who = speakerFace(line);
  if (who) {
    // Реплика с портретом: лицо слева, текст обтекает — как в визуальной новелле.
    const row = document.createElement('span');
    row.className = 'tx-dialogue';
    const face = document.createElement('span');
    face.className = 'tx-face';
    face.title = who.name;
    face.style.backgroundImage = `url('/avatars/${who.avatar}')`;
    face.addEventListener('click', () => showImage(who.avatar, who.name));
    row.appendChild(face);
    const body = document.createElement('span');
    body.className = 'tx-dialogue-body';
    row.appendChild(body);
    container.appendChild(row);
    container = body;
  }
  container.appendChild(document.createTextNode(dash[1]));
  let rest = line.slice(dash[1].length);
  let isSpeech = true;

  // Реплика и слова автора чередуются, разделённые « — ».
  while (rest.length) {
    const brk = rest.search(AUTHOR_BREAK);
    if (brk === -1) {
      if (isSpeech) appendSpeech(container, rest); else renderInline(container, rest);
      break;
    }
    const chunk = rest.slice(0, brk);
    if (isSpeech) appendSpeech(container, chunk); else renderInline(container, chunk);
    // Разделитель « — » всегда обычным текстом.
    container.appendChild(document.createTextNode(rest.slice(brk, brk + 3)));
    rest = rest.slice(brk + 3);
    isSpeech = !isSpeech;
  }
}

function appendSpeech(container, str) {
  if (!str) return;
  const span = document.createElement('span');
  span.className = 'tx-speech';
  span.textContent = str;
  container.appendChild(span);
}

// Подсветка кавычек и звёздочек внутри произвольного куска.
function renderInline(container, text) {
  let last = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
    const token = m[0];
    const span = document.createElement('span');
    if (token.startsWith('*')) {
      span.className = 'tx-action';
      span.textContent = token.slice(1, -1);
    } else {
      span.className = 'tx-speech';
      span.textContent = token;
    }
    container.appendChild(span);
    last = m.index + token.length;
  }
  if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
}

// ---- Лента ----
function makeEntryEl(role, text, index, entry) {
  const div = document.createElement('div');
  div.className = `entry ${role}` + (entry && entry.failed ? ' failed' : '');
  if (index != null) div.dataset.index = index;
  const span = document.createElement('span');
  span.className = 'entry-text';
  renderRichText(span, text);
  div.appendChild(span);
  if (entry && role === 'narrator' && index != null && entry.images && entry.images.length) div.appendChild(sceneFigure(entry, index));
  if (entry && entry.rolls && entry.rolls.length) {
    for (const r of entry.rolls) {
      const chip = document.createElement('div');
      chip.className = 'roll' + (r.success ? ' ok' : ' bad');
      const label = document.createElement('span');
      label.className = 'roll-label';
      label.textContent = `${r.skill} · ${r.difficulty}`;
      if (r.asked) label.title = `Рассказчик назвал проверку «${r.asked}» — засчитано умение «${r.skill}»`;
      const val = document.createElement('span');
      val.className = 'roll-value';
      val.textContent = `${r.roll}${r.bonus ? '+' + r.bonus : ''}${r.penalty ? '−' + r.penalty : ''} = ${r.total} / ${r.target}`;
      const out = document.createElement('span');
      out.className = 'roll-outcome';
      out.textContent = r.outcome;
      chip.append(label, val, out);
      div.appendChild(chip);
    }
  }
  if (entry && entry.truncated) {
    const bar = document.createElement('div');
    bar.className = 'trunc-bar';
    const msg = document.createElement('span');
    msg.className = 'trunc-msg';
    msg.textContent = 'Ответ оборвался — модель упёрлась в лимит длины.';
    const btn = document.createElement('button');
    btn.className = 'btn primary continue-btn';
    btn.textContent = 'Договорить';
    bar.append(msg, btn);
    div.appendChild(bar);
  }
  if (entry && ((entry.ticks && entry.ticks.length) || (entry.growth && entry.growth.length))) {
    const fx = document.createElement('div');
    fx.className = 'turn-fx';
    for (const t of entry.ticks || []) { const l = document.createElement('div'); l.className = 'fx-tick'; l.textContent = '⏳ ' + t; fx.appendChild(l); }
    for (const g of entry.growth || []) { const l = document.createElement('div'); l.className = 'fx-growth'; l.textContent = '✦ ' + g; fx.appendChild(l); }
    div.appendChild(fx);
  }
  if (entry && entry.issues && entry.issues.length) {
    const warn = document.createElement('div');
    warn.className = 'issue';
    warn.textContent = '⚠ ' + entry.issues.join(' ');
    warn.title = 'Расхождение с состоянием — рассказчику отправлено замечание';
    div.appendChild(warn);
  }
  if (entry && role === 'narrator' && (entry.timing || (entry.sync && entry.sync.timing))) {
    const t = renderTiming(entry);
    if (t) div.appendChild(t);
  }
  if (entry && entry.sync && entry.sync.status) {
    const isLast = index != null && index === app.log.length - 1;
    const box = renderSyncJournal(entry.sync);
    for (const prev of entry.syncHistory || []) {
      const old = renderSyncJournal(prev, 'прежний ');
      old.classList.add('prev');
      box.appendChild(old);
    }
    if (isLast && app.canResync && entry.sync.status !== 'inline') {
      const bar = document.createElement('div');
      bar.className = 'sync-acts';
      const btn = document.createElement('button');
      btn.className = 'link-btn';
      btn.textContent = '↻ переучесть ход';
      btn.title = 'Откатить записи этого хода и прогнать учёт заново — можно другой моделью. Прежний журнал останется для сравнения.';
      btn.addEventListener('click', (e) => { e.preventDefault(); resyncTurn(btn); });
      bar.appendChild(btn);
      box.appendChild(bar);
    }
    div.appendChild(box);
  }
  if (entry && entry.failed) {
    const bar = document.createElement('div');
    bar.className = 'fail-bar';
    const msg = document.createElement('span');
    msg.className = 'fail-msg';
    msg.textContent = entry.error || 'Рассказчик не ответил.';
    const retry = document.createElement('button');
    retry.className = 'btn primary retry-btn';
    retry.textContent = 'Отправить снова';
    bar.append(msg, retry);
    div.appendChild(bar);
    return div;
  }
  if (index != null) {
    const tools = document.createElement('span');
    tools.className = 'entry-tools';
    const mk = (cls, title, txt) => { const b = document.createElement('button'); b.className = cls; b.title = title; b.textContent = txt; return b; };
    tools.appendChild(mk('edit-btn', 'Редактировать', '✎'));
    if (role === 'narrator') tools.appendChild(mk('illus-btn', 'Иллюстрировать сцену', '🖼'));
    tools.appendChild(mk('branch-btn', 'Ветка отсюда: копия истории, обрезанная до этого места', '⑂'));
    tools.appendChild(mk('cut-btn', role === 'narrator'
      ? 'Обрезать после: всё, что ниже, исчезнет, мир вернётся к этому моменту'
      : 'Обрезать здесь: ответ и всё ниже исчезнут, реплику можно отправить заново', '✂'));
    div.appendChild(tools);
  }
  return div;
}

// ---- История как дерево ----
async function cutAt(index) {
  if (sending) return;
  const e = app.log[index];
  if (!e) return;
  const below = app.log.length - 1 - index;
  if (below > 0 && !confirm(`Обрезать историю? Исчезнет сообщений: ${below}. Мир откатится к этому моменту.`)) return;
  try {
    const data = await api(`/api/log/${index}/truncate`, { method: 'POST' });
    applyFullState(data);
    if (data.restored === false) toast('Обрезано. Для этого хода нет снимка мира (он сделан до обновления) — листы и НПС не откатывались.');
  } catch (err) { toast(err.message); }
}
async function branchAt(index) {
  if (sending) return;
  try {
    const data = await api(`/api/log/${index}/branch`, { method: 'POST' });
    applyFullState(data);
    toast('Создана ветка — ты в ней. Исходная история осталась в списке историй.');
  } catch (err) { toast(err.message); }
}
async function swipe(index, dir) {
  if (sending) return;
  try {
    const data = await api(`/api/log/${index}/swipe`, { method: 'POST', body: JSON.stringify({ dir }) });
    applyFullState(data);
  } catch (err) { toast(err.message); }
}

function renderLog(log) {
  app.log = log || [];
  const empty = $('emptyLog');
  if (!app.log.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.remove();
  logEl.innerHTML = '';
  app.log.forEach((entry, i) => logEl.appendChild(makeEntryEl(entry.role, entry.text, i, entry)));
  scrollLog();
}

function addEntry(role, text) {
  const empty = $('emptyLog');
  if (empty) empty.remove();
  const div = makeEntryEl(role, text, null);
  logEl.appendChild(div);
  scrollLog();
  return div;
}

function startEdit(entryEl) {
  const index = Number(entryEl.dataset.index);
  if (Number.isNaN(index) || !app.log[index]) return;
  entryEl.classList.add('editing');
  entryEl.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'edit-area';
  ta.value = app.log[index].text;
  entryEl.appendChild(ta);
  const bar = document.createElement('div');
  bar.className = 'edit-bar';
  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Отмена';
  const save = document.createElement('button');
  save.className = 'btn primary';
  save.textContent = 'Сохранить';
  bar.append(cancel, save);
  entryEl.appendChild(bar);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  grow();
  ta.focus();
  ta.addEventListener('input', grow);
  cancel.onclick = () => { renderLog(app.log); decorateLastNarrator(); };
  save.onclick = async () => {
    save.disabled = true;
    try {
      const data = await api(`/api/log/${index}`, { method: 'PUT', body: JSON.stringify({ text: ta.value }) });
      renderLog(data.log);
      decorateLastNarrator();
    } catch (err) { toast(err.message); save.disabled = false; }
  };
}
let thinkingTimer = null;
function showThinking() {
  const div = document.createElement('div');
  div.className = 'entry narrator';
  div.id = 'thinkingEntry';
  div.innerHTML = '<span class="thinking"><span></span><span></span><span></span></span><span class="thinking-clock" id="thinkingClock"></span>';
  logEl.appendChild(div);
  scrollLog();
  const t0 = Date.now();
  clearInterval(thinkingTimer);
  // Секундомер ожидания: видно, что запрос жив и сколько уже идёт.
  thinkingTimer = setInterval(() => {
    const c = $('thinkingClock');
    if (!c) { clearInterval(thinkingTimer); return; }
    const s = Math.floor((Date.now() - t0) / 1000);
    c.textContent = s >= 1 ? `${s} с` : '';
  }, 250);
}
function hideThinking() { clearInterval(thinkingTimer); const t = $('thinkingEntry'); if (t) t.remove(); }

// ---- Ход ----
async function performTurn(endpoint, body, optimistic) {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  if (optimistic && optimistic.text) addEntry(optimistic.role, optimistic.text);
  inputEl.value = '';
  autoGrow();
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());
  showThinking();

  const before = captureBefore();
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

// ---- Единый путь применения ответа на ход ----
// Ход, повтор, регенерация и «Договорить» раньше обновляли каждый свой набор
// данных — сцена, нити, полоса героя оставались старыми до перезагрузки.
function captureBefore() {
  return { sigs: { ...charSigs }, npc: npcsCollectionSig(), active: app.activeCharacterId };
}
function applyTurnResult(data, before) {
  hideThinking();
  renderLog(data.log);
  applyState(data, { animate: true });
  for (const c of app.characters) {
    const sig = charSig(c);
    if (before && before.sigs[c.id] !== undefined && before.sigs[c.id] !== sig && c.id !== before.active) changedChars.add(c.id);
  }
  snapshotCharSigs();
  renderTabs();
  if (before && activePanel !== 'npcs' && npcsCollectionSig() !== before.npc) $('tabNpcs').classList.add('changed');
  decorateLastNarrator();
}
// Сбой хода: сервер уже откатил мир — берём полное состояние, а не обрывок.
async function recoverAfterTurnError(err) {
  hideThinking();
  toast(err.message);
  try {
    applyFullState(await api('/api/state'));
  } catch {
    if (err.payload && err.payload.log) renderLog(err.payload.log);
    decorateLastNarrator();
  }
  ensureRetryAffordance();
}
// Перерисовать ленту (портреты у реплик), не сбрасывая прокрутку читателя.
function refreshLogKeepScroll() {
  if (!app.log || !app.log.length) return;
  const top = logEl.scrollTop;
  const atBottom = logEl.scrollHeight - logEl.clientHeight - top < 40;
  const prevBehavior = logEl.style.scrollBehavior;
  logEl.style.scrollBehavior = 'auto';
  renderLog(app.log);
  if (!atBottom) logEl.scrollTop = top;
  logEl.style.scrollBehavior = prevBehavior;
  decorateLastNarrator();
}

// Выход из «занят»: сначала снять флаг и разблокировать ввод, потом дорисовать
// кнопки последнего ответа (↻, свайпы, «Отправить снова»). Раньше кнопки
// рисовались, пока флаг ещё стоял, — и не появлялись до перезагрузки.
function endBusy({ focus = true } = {}) {
  refreshDiagBadge();
  sending = false;
  sendBtn.disabled = false;
  inputEl.disabled = false;
  decorateLastNarrator();
  if (focus) inputEl.focus();
}

// Гарантирует, что у зависшего хода есть кнопка повтора.
function ensureRetryAffordance() {
  const last = app.log[app.log.length - 1];
  if (!last || (last.role !== 'player' && last.role !== 'ooc')) return;
  if (!last.failed) {
    last.failed = true;
    last.error = last.error || 'Ответ не получен.';
    renderLog(app.log);
  }
}

async function refreshLog() {
  try { const s = await api('/api/state'); renderLog(s.log); } catch { /* не критично */ }
}

async function continueTurn() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  document.querySelectorAll('.trunc-bar').forEach((b) => b.remove());
  showThinking();
  const before = captureBefore();
  try {
    const data = await api('/api/continue', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

async function retryTurn() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  document.querySelectorAll('.fail-bar').forEach((b) => b.remove());
  showThinking();
  const before = captureBefore();
  try {
    const data = await api('/api/retry', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

function sendAction(text) { return performTurn('/api/action', { text }, { role: 'player', text }); }
function sendOoc(text) { return performTurn('/api/ooc', { text }, { role: 'ooc', text }); }
function submitInput(text) { return (oocMode ? sendOoc : sendAction)(text); }

// ---- Кнопка регенерации на последней реплике рассказчика ----
function decorateLastNarrator() {
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());
  if (sending) return;

  // Если последнее слово осталось за игроком — ответа не было.
  // Показываем кнопку повтора всегда, не полагаясь на пометку о сбое.
  const lastEntry = app.log[app.log.length - 1];
  if (lastEntry && (lastEntry.role === 'player' || lastEntry.role === 'ooc')) {
    const entries = logEl.querySelectorAll('.entry');
    const el = entries[entries.length - 1];
    if (el && !el.querySelector('.fail-bar') && !el.querySelector('.retry-inline')) {
      const bar = document.createElement('div');
      bar.className = 'fail-bar retry-inline';
      const msg = document.createElement('span');
      msg.className = 'fail-msg';
      msg.textContent = lastEntry.error || 'Рассказчик не ответил на это сообщение.';
      const btn = document.createElement('button');
      btn.className = 'btn primary retry-btn';
      btn.textContent = 'Отправить снова';
      bar.append(msg, btn);
      el.appendChild(bar);
    }
    return;
  }
  const narrators = [...logEl.querySelectorAll('.entry.narrator')].filter((e) => e.id !== 'thinkingEntry');
  const last = narrators[narrators.length - 1];
  if (!last) return;
  const bar = document.createElement('span');
  bar.className = 'regen-bar';
  const idx = Number(last.dataset.index);
  const entry = app.log[idx];
  if (entry && entry.variants > 1) {
    const prev = document.createElement('button');
    prev.className = 'regen-btn swipe'; prev.textContent = '‹'; prev.title = 'Предыдущий вариант';
    prev.disabled = entry.variant <= 0;
    prev.addEventListener('click', () => swipe(idx, -1));
    const cnt = document.createElement('span');
    cnt.className = 'swipe-count'; cnt.textContent = `${entry.variant + 1}/${entry.variants}`;
    const next = document.createElement('button');
    next.className = 'regen-btn swipe'; next.textContent = '›'; next.title = 'Следующий вариант';
    next.disabled = entry.variant >= entry.variants - 1;
    next.addEventListener('click', () => swipe(idx, 1));
    bar.append(prev, cnt, next);
  }
  const btn = document.createElement('button');
  btn.className = 'regen-btn';
  btn.title = entry && entry.variants > 1 ? 'Ещё вариант (прежние сохраняются)' : 'Перегенерировать ответ (прежний сохранится как вариант)';
  btn.textContent = '↻';
  btn.addEventListener('click', regenerate);
  bar.appendChild(btn);
  last.appendChild(bar);
}

async function regenerate() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());

  showThinking();

  const before = captureBefore();
  try {
    const data = await api('/api/regenerate', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    // Сервер уже убрал прежний ответ и откатил мир — на экране его быть не должно.
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

// ---- Редактор персонажа ----
let editingNpcId = null;
let npcLocks = new Set();

const NPC_FIELD_IDS = {
  name: 'npcName', attitude: 'npcAttitude', status: 'npcStatus',
  description: 'npcDescription', appearance: 'npcAppearance', personality: 'npcPersonality', history: 'npcHistory',
  wants: 'npcWants', quirk: 'npcQuirk', secret: 'npcSecret', links: 'npcLinks',
  voiceStyle: 'npcVoiceStyle', voiceHumor: 'npcVoiceHumor', voiceHabits: 'npcVoiceHabits', voiceMasks: 'npcVoiceMasks', voiceTaboos: 'npcVoiceTaboos',
  mood: 'npcMood', moodReason: 'npcMoodReason',
};

function renderLocks() {
  for (const btn of document.querySelectorAll('#npcModal .lock')) {
    const on = npcLocks.has(btn.dataset.field);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '\uD83D\uDD12' : '\uD83D\uDD13';
    btn.title = on ? 'Закреплено — рассказчик не изменит' : 'Закрепить поле';
  }
  syncFillLocks();
}

function openNpcModal(npc) {
  editingNpcId = npc ? npc.id : null;
  resetFill('npc');
  $('npcModalTitle').textContent = npc ? 'Досье персонажа' : 'Новый персонаж';
  npcTraitsOpen = false;
  for (const [field, id] of Object.entries(NPC_FIELD_IDS)) $(id).value = npc ? (npc[field] || '') : '';
  npcLocks = new Set(npc && Array.isArray(npc.locked) ? npc.locked : []);
  $('npcBound').checked = Boolean(npc && npc.bound);
  $('npcVoiceSamples').value = npc && Array.isArray(npc.voiceSamples) ? npc.voiceSamples.join('\n') : '';
  npcTraitSel = new Set(npc && Array.isArray(npc.traits) ? npc.traits : []);
  renderTraitPicker();
  setNpcAvatarPreview(npc ? npc.avatar : null);
  $('npcPortraitTags').value = (npc && npc.portraitTags) || '';
  $('npcAvatarPick').disabled = !npc;
  $('npcAvatarClear').disabled = !(npc && npc.avatar);
  renderLocks();
  $('npcDelete').style.display = npc ? '' : 'none';
  $('npcModal').hidden = false;
  $('npcName').focus();
}
function closeNpcModal() { $('npcModal').hidden = true; }

let npcTraitSel = new Set();

function renderTraitPicker() {
  const box = $('npcTraits');
  box.innerHTML = '';
  const cats = [['temper','Нрав'],['social','Отношение к людям'],['flaw','Пороки и слабости'],['speech','Манера речи']];
  for (const [cat, label] of cats) {
    const inCat = app.traitPool.filter((t) => t.cat === cat);
    if (!inCat.length) continue;
    const g = document.createElement('div');
    g.className = 'trait-group';
    const l = document.createElement('div');
    l.className = 'trait-group-label';
    l.textContent = label;
    g.appendChild(l);
    const row = document.createElement('div');
    row.className = 'trait-row';
    for (const t of inCat) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'trait-tag pick' + (npcTraitSel.has(t.label) ? ' on' : '');
      b.textContent = t.label;
      if (t.hint) b.title = t.hint + (t.effect ? ` · ${t.effect.skill}: ${t.effect.mod > 0 ? '+' : ''}${t.effect.mod}` : '');
      b.addEventListener('click', () => {
        if (npcTraitSel.has(t.label)) npcTraitSel.delete(t.label); else npcTraitSel.add(t.label);
        renderTraitPicker();
      });
      row.appendChild(b);
    }
    g.appendChild(row);
    box.appendChild(g);
  }
  // Свёрнуто — видны только выбранные черты; полный список по кнопке.
  box.classList.toggle('collapsed', !npcTraitsOpen);
  const sel = npcTraitSel.size;
  const t = document.createElement('button');
  t.type = 'button'; t.className = 'link-btn trait-toggle';
  t.textContent = npcTraitsOpen ? 'Свернуть' : sel ? 'Изменить черты' : 'Выбрать черты';
  t.addEventListener('click', () => { npcTraitsOpen = !npcTraitsOpen; renderTraitPicker(); });
  box.appendChild(t);
}
let npcTraitsOpen = false;

function setNpcAvatarPreview(filename) {
  const box = $('npcAvatarPreview');
  if (filename) { box.style.backgroundImage = `url('/avatars/${filename}')`; box.classList.add('has-image'); }
  else { box.style.backgroundImage = ''; box.classList.remove('has-image'); }
}

async function uploadNpcAvatar(file) {
  if (!editingNpcId || !file) return;
  try {
    const dataUrl = await shrinkImage(file);
    const data = await api(`/api/npcs/${editingNpcId}/avatar`, { method: 'POST', body: JSON.stringify({ dataUrl }) });
    npcSigs = {};
    applyState(data);
    refreshLogKeepScroll();
    const n = app.npcs.find((x) => x.id === editingNpcId);
    setNpcAvatarPreview(n ? n.avatar : null);
    $('npcAvatarClear').disabled = !(n && n.avatar);
  } catch (err) { toast(err.message); }
}

async function clearNpcAvatar() {
  if (!editingNpcId) return;
  try {
    const data = await api(`/api/npcs/${editingNpcId}/avatar`, { method: 'DELETE' });
    npcSigs = {};
    applyState(data);
    refreshLogKeepScroll();
    setNpcAvatarPreview(null);
    $('npcAvatarClear').disabled = true;
  } catch (err) { toast(err.message); }
}

async function saveNpc() {
  const body = { locked: [...npcLocks], traits: [...npcTraitSel], bound: $('npcBound').checked,
    voiceSamples: $('npcVoiceSamples').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(-8) };
  for (const [field, id] of Object.entries(NPC_FIELD_IDS)) body[field] = $(id).value;
  if (!body.name.trim()) { toast('У персонажа должно быть имя.'); return; }
  try {
    const data = editingNpcId
      ? await api(`/api/npcs/${editingNpcId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/api/npcs', { method: 'POST', body: JSON.stringify(body) });
    closeNpcModal();
    npcSigs = {};
    applyState(data);
    refreshLogKeepScroll();
  } catch (err) { toast(err.message); }
}

async function deleteNpcFromModal() {
  if (!editingNpcId) return;
  const n = app.npcs.find((x) => x.id === editingNpcId);
  if (!confirm(`Удалить персонажа «${n ? n.name : ''}»?`)) return;
  closeNpcModal();
  await deleteNpc(editingNpcId);
}

// ---- Досье героя ----
function renderDossier() {
  const c = activeChar();
  if (!c) return;
  const body = $('dossierBody');
  body.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'dossier-head';
  const portrait = document.createElement('div');
  portrait.className = 'dossier-portrait';
  portrait.addEventListener('click', () => { if (c.avatar) showImage(c.avatar, c.name); });
  if (c.avatar) portrait.style.backgroundImage = `url('/avatars/${c.avatar}')`;
  else portrait.textContent = '\u2726';
  head.appendChild(portrait);

  const ident = document.createElement('div');
  ident.className = 'dossier-ident';
  const nm = document.createElement('h3');
  nm.className = 'dossier-name';
  nm.textContent = c.name;
  ident.appendChild(nm);
  const tags = document.createElement('div');
  tags.className = 'dossier-tags';
  for (const t of [c.race, c.social].filter((x) => x && x.trim())) {
    const tag = document.createElement('span');
    tag.className = 'dossier-tag';
    tag.textContent = t;
    tags.appendChild(tag);
  }
  if (tags.children.length) ident.appendChild(tags);
  if (c.persona && c.persona.trim()) {
    const p = document.createElement('div');
    p.className = 'dossier-persona';
    p.textContent = c.persona;
    ident.appendChild(p);
  }
  head.appendChild(ident);
  body.appendChild(head);

  const section = (title) => {
    const sec = document.createElement('div');
    sec.className = 'dossier-section';
    const h = document.createElement('h3');
    h.textContent = title;
    sec.appendChild(h);
    body.appendChild(sec);
    return sec;
  };
  const empty = (sec, text) => {
    const e = document.createElement('p');
    e.className = 'dossier-empty';
    e.textContent = text;
    sec.appendChild(e);
  };

  // Внешность
  const look = section('Внешность');
  if (c.appearance && c.appearance.trim()) {
    const t = document.createElement('div');
    t.className = 'dossier-text';
    t.textContent = c.appearance;
    look.appendChild(t);
  } else empty(look, 'Не описана. Задай её в редакторе героя — рассказчик будет дополнять по ходу.');

  // Умения
  const abilities = (c.blocks || []).filter((b) => b.type === 'ability');
  const ab = section('Умения');
  if (abilities.length) {
    for (const a of abilities) {
      const row = document.createElement('div');
      row.className = 'ability-row';
      const wrap = document.createElement('div');
      const nme = document.createElement('div');
      nme.className = 'ability-name';
      nme.textContent = a.name;
      wrap.appendChild(nme);
      if (a.description) {
        const d = document.createElement('div');
        d.className = 'ability-desc';
        d.textContent = a.description;
        wrap.appendChild(d);
      }
      row.appendChild(wrap);
      if (a.value) {
        const lv = document.createElement('span');
        lv.className = 'ability-level';
        lv.textContent = a.value;
        row.appendChild(lv);
      }
      ab.appendChild(row);
    }
  } else empty(ab, 'Пока никаких. Появятся, когда герой чему-то научится.');

  // Характеристики
  const stats = (c.blocks || []).filter((b) => b.type === 'stat');
  if (stats.length) {
    const sc = section('Характеристики');
    const grid = document.createElement('div');
    grid.className = 'dossier-grid';
    for (const st of stats) {
      const cell = document.createElement('div');
      cell.className = 'dossier-stat';
      const n = document.createElement('div');
      n.className = 'dossier-stat-name';
      n.textContent = st.name;
      const v = document.createElement('div');
      v.className = 'dossier-stat-value';
      v.textContent = st.max != null ? `${st.value ?? '?'} / ${st.max}` : (st.value ?? '');
      cell.append(n, v);
      grid.appendChild(cell);
    }
    sc.appendChild(grid);
  }

  // Другие герои — можно убрать из истории, не переключаясь на них.
  const others = app.characters.filter((x) => x.id !== c.id);
  if (others.length) {
    const os = section('Другие герои');
    for (const o of others) {
      const row = document.createElement('div');
      row.className = 'ability-row';
      const wrap = document.createElement('div');
      const nm = document.createElement('div');
      nm.className = 'ability-name';
      nm.textContent = o.name;
      wrap.appendChild(nm);
      if (o.persona) {
        const d = document.createElement('div');
        d.className = 'ability-desc';
        d.textContent = o.persona;
        wrap.appendChild(d);
      }
      row.appendChild(wrap);
      const btn = document.createElement('button');
      btn.className = 'btn ghost';
      btn.style.fontSize = '11px';
      btn.style.padding = '5px 11px';
      btn.textContent = o.present === false ? 'Вернуть' : 'Убрать из истории';
      btn.addEventListener('click', async () => {
        await togglePresence(o.id, o.present === false);
        renderDossier();
      });
      row.appendChild(btn);
      os.appendChild(row);
    }
  }

  // Состояния
  const statuses = (c.blocks || []).filter((b) => b.type === 'status');
  if (statuses.length) {
    const ss = section('Состояния');
    const tags2 = document.createElement('div');
    tags2.className = 'dossier-tags';
    for (const st of statuses) {
      const t = document.createElement('span');
      t.className = 'dossier-tag';
      t.style.color = 'var(--status)';
      t.style.borderColor = 'var(--status)';
      t.textContent = st.value ? `${st.name}: ${st.value}` : st.name;
      tags2.appendChild(t);
    }
    ss.appendChild(tags2);
  }
}

function openDossier() { renderDossier(); $('dossierModal').hidden = false; }
function closeDossier() { $('dossierModal').hidden = true; }

// ---- Каталог статусов ----
let statusDraft = [];

function renderStatusEditor() {
  const list = $('statusList');
  list.innerHTML = '';
  statusDraft.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'status-edit';
    const mk = (cls, val, ph, type = 'text') => { const el = document.createElement('input'); el.className = 'trait-input ' + cls; el.type = type; el.value = val ?? ''; el.placeholder = ph; return el; };
    const lbl = (t) => { const el = document.createElement('span'); el.className = 'fx-label'; el.textContent = t; return el; };
    const name = mk('name', d.name, 'Название');
    const roll = mk('num', d.rollMod || '', '±', 'number');
    const tstat = mk('stat', d.tick?.stat || '', 'показатель');
    const tdelta = mk('num', d.tick?.delta ?? '', '±', 'number');
    const dur = mk('num', d.duration ?? '', '∞', 'number');
    const del = document.createElement('button'); del.className = 'slot-act danger'; del.textContent = '✕';
    const sync = () => {
      statusDraft[i] = {
        name: name.value, rollMod: Number(roll.value) || 0,
        tick: tstat.value.trim() ? { stat: tstat.value.trim(), delta: Number(tdelta.value) || 0 } : null,
        duration: dur.value === '' ? null : Number(dur.value),
      };
    };
    for (const el of [name, roll, tstat, tdelta, dur]) el.addEventListener('input', sync);
    del.addEventListener('click', () => { statusDraft.splice(i, 1); renderStatusEditor(); });
    row.append(name, lbl('броски'), roll, lbl('тик'), tstat, tdelta, lbl('ходов'), dur, del);
    list.appendChild(row);
  });
}
function openStatusCatalog() {
  statusDraft = (app.statusCatalog || []).map((d) => ({ ...d, tick: d.tick ? { ...d.tick } : null }));
  renderStatusEditor();
  $('statusModal').hidden = false;
}
function closeStatusCatalog() { $('statusModal').hidden = true; }
async function saveStatusCatalog() {
  try {
    const data = await api('/api/statuses', { method: 'PUT', body: JSON.stringify({ catalog: statusDraft }) });
    app.statusCatalog = data.statusCatalog || [];
    closeStatusCatalog();
    renderSheet(activeChar(), false);
    toast('Каталог сохранён.');
  } catch (err) { toast(err.message); }
}

// ---- Заготовки: изюминки и тайны ----
function openSeedPool() {
  const p = app.seedPool || { quirks: [], secrets: [] };
  $('seedQuirks').value = (p.quirks || []).join('\n');
  $('seedSecrets').value = (p.secrets || []).join('\n');
  $('seedModal').hidden = false;
}
function closeSeedPool() { $('seedModal').hidden = true; }
async function saveSeedPool() {
  try {
    const data = await api('/api/seeds', { method: 'PUT', body: JSON.stringify({
      quirks: $('seedQuirks').value, secrets: $('seedSecrets').value,
    }) });
    app.seedPool = data.seedPool;
    closeSeedPool();
    toast('Заготовки сохранены.');
  } catch (err) { toast(err.message); }
}

// ---- Палитра черт ----
let traitDraft = [];

function renderTraitEditor() {
  const list = $('traitList');
  list.innerHTML = '';
  const cats = [['temper','Нрав'],['social','Отношение к людям'],['flaw','Пороки и слабости'],['speech','Манера речи']];

  traitDraft.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'trait-edit';

    // Верхняя строка: категория, ярлык, удаление.
    const top = document.createElement('div');
    top.className = 'trait-edit-top';

    const sel = document.createElement('select');
    sel.className = 'trait-cat';
    for (const [id, label] of cats) {
      const o = document.createElement('option');
      o.value = id; o.textContent = label; o.selected = t.cat === id;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { traitDraft[i].cat = sel.value; });

    const label = document.createElement('input');
    label.className = 'trait-input label';
    label.value = t.label; label.placeholder = 'Ярлык';
    label.addEventListener('input', () => { traitDraft[i].label = label.value; });

    const del = document.createElement('button');
    del.className = 'slot-act danger'; del.textContent = '✕'; del.title = 'Убрать черту';
    del.addEventListener('click', () => { traitDraft.splice(i, 1); renderTraitEditor(); });

    top.append(sel, label, del);
    card.appendChild(top);

    // Пояснение — на всю ширину, с переносами.
    const hint = document.createElement('textarea');
    hint.className = 'trait-hint';
    hint.rows = 2;
    hint.value = t.hint || '';
    hint.placeholder = 'Как это проявляется — рассказчик прочитает это описание';
    hint.addEventListener('input', () => { traitDraft[i].hint = hint.value; });
    card.appendChild(hint);

    // Эффект на броски — отдельной строкой с подписями.
    const fx = document.createElement('div');
    fx.className = 'trait-fx';
    const fxLabel = document.createElement('span');
    fxLabel.className = 'trait-fx-label';
    fxLabel.textContent = 'Влияние:';

    const skill = document.createElement('input');
    skill.className = 'trait-input';
    skill.value = t.effect?.skill || '';
    skill.placeholder = 'навык (убеждение, обман…)';

    const mod = document.createElement('input');
    mod.className = 'trait-input tiny';
    mod.type = 'number'; mod.value = t.effect?.mod ?? '';
    mod.placeholder = '±';
    mod.title = 'Плюс — герою легче, минус — труднее';

    const note = document.createElement('input');
    note.className = 'trait-input wide';
    note.value = t.effect?.note || '';
    note.placeholder = 'почему (видно в результате броска)';

    const syncEffect = () => {
      const sk = skill.value.trim();
      if (sk) traitDraft[i].effect = { skill: sk, mod: Number(mod.value) || 0, note: note.value.trim() };
      else delete traitDraft[i].effect;
    };
    for (const el of [skill, mod, note]) el.addEventListener('input', syncEffect);

    fx.append(fxLabel, skill, mod, note);
    card.appendChild(fx);
    list.appendChild(card);
  });
}

function openTraitPool() {
  traitDraft = app.traitPool.map((t) => ({ ...t, effect: t.effect ? { ...t.effect } : undefined }));
  renderTraitEditor();
  $('traitModal').hidden = false;
}
function closeTraitPool() { $('traitModal').hidden = true; }

async function saveTraitPool() {
  try {
    const data = await api('/api/traits', { method: 'PUT', body: JSON.stringify({ pool: traitDraft }) });
    app.traitPool = data.traitPool || [];
    closeTraitPool();
    npcSigs = {};
    renderNpcs(false);
  } catch (err) { toast(err.message); }
}

// ---- Истории (слоты) ----
function renderSlots(data) {
  const list = $('slotList');
  list.innerHTML = '';
  for (const sl of data.slots) {
    const el = document.createElement('div');
    el.className = 'slot' + (sl.active ? ' active' : '');
    el.dataset.id = sl.id;

    const main = document.createElement('div');
    main.className = 'slot-main';
    const nm = document.createElement('div');
    nm.className = 'slot-name';
    nm.textContent = sl.name;
    const meta = document.createElement('div');
    meta.className = 'slot-meta';
    const d = new Date(sl.updatedAt);
    meta.textContent = (sl.active ? 'сейчас · ' : '') + d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    main.append(nm, meta);
    el.appendChild(main);

    const acts = document.createElement('div');
    acts.className = 'slot-acts';
    for (const [act, glyph, title, cls] of [
      ['rename', '✎', 'Переименовать', ''],
      ['duplicate', '⧉', 'Сделать копию', ''],
      ['delete', '✕', 'Удалить', 'danger'],
    ]) {
      const b = document.createElement('button');
      b.className = 'slot-act ' + cls;
      b.dataset.act = act;
      b.title = title;
      b.textContent = glyph;
      acts.appendChild(b);
    }
    el.appendChild(acts);
    list.appendChild(el);
  }
  const active = data.slots.find((x) => x.active);
  if (active) $('slotName').textContent = active.name;
}

async function openSlots() {
  try { renderSlots(await api('/api/slots')); $('slotsModal').hidden = false; }
  catch (err) { toast(err.message); }
}
function closeSlots() { $('slotsModal').hidden = true; }

// Переключение партии перерисовывает всё: история, герои, НПС, мир.
function applyFullState(data) {
  blockSignatures = {}; npcSigs = {}; charSigs = {}; changedChars.clear();
  renderLog(data.log);
  applyState(data, { animate: false });
  snapshotCharSigs();
  decorateLastNarrator();
  if (data.slots) renderSlots({ slots: data.slots, activeSlotId: data.activeSlotId });
}

async function slotAction(id, act) {
  try {
    if (act === 'rename') {
      const cur = (await api('/api/slots')).slots.find((x) => x.id === id);
      const name = prompt('Название истории:', cur ? cur.name : '');
      if (!name) return;
      renderSlots(await api(`/api/slots/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }));
      return;
    }
    if (act === 'duplicate') { renderSlots(await api(`/api/slots/${id}/duplicate`, { method: 'POST' })); return; }
    if (act === 'delete') {
      const cur = (await api('/api/slots')).slots.find((x) => x.id === id);
      if (!confirm(`Удалить историю «${cur ? cur.name : ''}» со всеми героями и записями?`)) return;
      applyFullState(await api(`/api/slots/${id}`, { method: 'DELETE' }));
      return;
    }
    applyFullState(await api(`/api/slots/${id}/activate`, { method: 'POST' }));
    closeSlots();
  } catch (err) { toast(err.message); }
}

// ---- Настройки ----
async function openSettings() {
  try {
    const s = await api('/api/state');
    $('modelInput').value = s.model || '';
    $('toolModelInput').value = s.toolModel || '';
    $('temperatureInput').value = s.temperature ?? 0.8;
    $('repetitionInput').value = s.repetitionPenalty ?? 0.3;
    $('frequencyInput').value = s.frequencyPenalty ?? 0;
    $('worldInput').value = s.worldPrompt || '';
    $('scenarioInput').value = s.scenarioPrompt || '';
    $('promptInput').value = s.systemPrompt || '';
    for (const seg of document.querySelectorAll('#difficultySeg .seg')) {
      seg.classList.toggle('active', seg.dataset.value === (s.difficulty || 'normal'));
    }
    for (const seg of document.querySelectorAll('#narrationSeg .seg')) {
      seg.classList.toggle('active', seg.dataset.value === (s.narration || 'second_ty'));
    }
    $('stateSyncInput').checked = s.stateSync !== false;
    $('loreAutoWriteInput').checked = s.loreAutoWrite === true;
    $('syncPromptStyleInput').value = s.syncPromptStyle === 'legacy' ? 'legacy' : 'technical';
    $('diceEnabledInput').checked = s.diceEnabled !== false;
    $('autoSummarizeInput').checked = s.autoSummarize !== false;
    $('sdUrlInput').value = s.sdUrl || 'http://127.0.0.1:7860';
    $('imageStyleInput').value = s.imageStyle || '';
    $('imageNegativeInput').value = s.imageNegative || '';
    $('imageSizeInput').value = s.imageSize || '832x1216';
    $('imageStepsInput').value = s.imageSteps ?? 25;
    $('imageCfgInput').value = s.imageCfg ?? 6;
    $('imageSamplerInput').value = s.imageSampler || 'DPM++ 2M';
    $('sceneStyleInput').value = s.sceneStyle || '';
    $('sceneNegativeInput').value = s.sceneNegative || '';
    $('sceneSizeInput').value = s.sceneSize || '1216x832';
    $('imageClipSkipInput').value = s.imageClipSkip ?? 2;
    $('faceFixInput').checked = s.faceFix !== false;
    $('sceneHiresInput').checked = s.sceneHires !== false;
    $('hiresScaleInput').value = s.hiresScale ?? 1.5;
    $('hiresDenoiseInput').value = s.hiresDenoise ?? 0.4;
    $('hiresUpscalerInput').value = s.hiresUpscaler || 'R-ESRGAN 4x+';
    $('historyKeepInput').value = s.historyKeep || 20;
    $('summaryInput').value = s.summary || '';
    const note = $('keyNote');
    if (s.hasKey) {
      note.className = 'field-note';
      note.innerHTML = 'Ключ OpenRouter найден в <code>.env</code> — можно играть.';
    } else {
      note.className = 'field-note warn';
      note.innerHTML = 'Ключ не найден. Создай <code>.env</code> из <code>.env.example</code> и впиши <code>OPENROUTER_API_KEY</code>.';
    }
    if ($('syncStats').open) renderSyncStats();
    $('settingsModal').hidden = false;
  } catch (err) { toast(err.message); }
}
function closeSettings() { $('settingsModal').hidden = true; }
async function saveSettings() {
  try {
    const difficulty = document.querySelector('#difficultySeg .seg.active')?.dataset.value || 'normal';
    const narration = document.querySelector('#narrationSeg .seg.active')?.dataset.value || 'second_ty';
    const data = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        model: $('modelInput').value,
        toolModel: $('toolModelInput').value,
        temperature: $('temperatureInput').value,
        repetitionPenalty: $('repetitionInput').value,
        frequencyPenalty: $('frequencyInput').value,
        worldPrompt: $('worldInput').value,
        scenarioPrompt: $('scenarioInput').value,
        sdUrl: $('sdUrlInput').value,
        imageStyle: $('imageStyleInput').value,
        imageNegative: $('imageNegativeInput').value,
        imageSize: $('imageSizeInput').value,
        imageSteps: $('imageStepsInput').value,
        imageCfg: $('imageCfgInput').value,
        imageSampler: $('imageSamplerInput').value,
        sceneStyle: $('sceneStyleInput').value,
        sceneNegative: $('sceneNegativeInput').value,
        sceneSize: $('sceneSizeInput').value,
        imageClipSkip: $('imageClipSkipInput').value,
        faceFix: $('faceFixInput').checked,
        sceneHires: $('sceneHiresInput').checked,
        hiresScale: $('hiresScaleInput').value,
        hiresDenoise: $('hiresDenoiseInput').value,
        hiresUpscaler: $('hiresUpscalerInput').value,
        difficulty,
        narration,
        stateSync: $('stateSyncInput').checked,
        loreAutoWrite: $('loreAutoWriteInput').checked,
        syncPromptStyle: $('syncPromptStyleInput').value,
        diceEnabled: $('diceEnabledInput').checked,
        autoSummarize: $('autoSummarizeInput').checked,
        historyKeep: $('historyKeepInput').value,
        summary: $('summaryInput').value,
        systemPrompt: $('promptInput').value,
      }),
    });
    modelLabel.textContent = data.model;
    closeSettings();
  } catch (err) { toast(err.message); }
}

// ---- Редактор героя ----
function openCharModal(char) {
  editingCharId = char ? char.id : null;
  resetFill('hero');
  $('charModalTitle').textContent = char ? 'Изменить героя' : 'Новый герой';
  $('charName').value = char ? char.name : '';
  $('charPersona').value = char ? char.persona : '';
  $('charRace').value = char ? (char.race || '') : '';
  $('charSocial').value = char ? (char.social || '') : '';
  $('charAppearance').value = char ? (char.appearance || '') : '';
  $('charLookLock').checked = Boolean(char && Array.isArray(char.locked) && char.locked.includes('appearance'));
  syncFillLocks();
  const prevLook = char && char.appearancePrev && char.appearancePrev !== char.appearance ? char.appearancePrev : '';
  $('charLookRestore').hidden = !prevLook;
  $('charLookRestore').onclick = () => {
    $('charAppearance').value = prevLook;
    toast('Подставлена прежняя внешность — нажми «Сохранить», чтобы вернуть её.');
  };
  $('charDelete').style.display = char && app.characters.length > 1 ? '' : 'none';
  const isActive = char && char.id === app.activeCharacterId;
  $('charPresent').checked = char ? char.present !== false : true;
  $('charPresent').disabled = !char || isActive;
  $('charPresentHint').textContent = isActive
    ? 'Ты играешь за этого героя, поэтому он в истории. Чтобы убрать другого — нажми кружок на его вкладке.'
    : 'Выключи, если этого героя сейчас нет в сцене — рассказчик перестанет его упоминать.';
  setAvatarPreview(char ? char.avatar : null);
  $('charPortraitTags').value = (char && char.portraitTags) || '';
  // Портрет можно грузить только существующему герою.
  $('charAvatarPick').disabled = !char;
  $('charAvatarClear').disabled = !char || !char.avatar;
  $('charModal').hidden = false;
  $('charName').focus();
}

function setAvatarPreview(filename) {
  const box = $('charAvatarPreview');
  if (filename) {
    box.style.backgroundImage = `url('/avatars/${filename}')`;
    box.classList.add('has-image');
  } else {
    box.style.backgroundImage = '';
    box.classList.remove('has-image');
  }
}

// Уменьшает картинку в браузере до 256px и отдаёт data URL.
function shrinkImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось открыть картинку.'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const png = file.type === 'image/png' || file.type === 'image/webp';
        resolve(canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadAvatar(file) {
  if (!editingCharId || !file) return;
  try {
    const dataUrl = await shrinkImage(file);
    const data = await api(`/api/characters/${editingCharId}/avatar`, {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
    applyState(data, { animate: false });
    const c = app.characters.find((x) => x.id === editingCharId);
    setAvatarPreview(c ? c.avatar : null);
    $('charAvatarClear').disabled = !(c && c.avatar);
  } catch (err) { toast(err.message); }
}

async function clearAvatar() {
  if (!editingCharId) return;
  try {
    const data = await api(`/api/characters/${editingCharId}/avatar`, { method: 'DELETE' });
    applyState(data, { animate: false });
    setAvatarPreview(null);
    $('charAvatarClear').disabled = true;
  } catch (err) { toast(err.message); }
}
function closeCharModal() { $('charModal').hidden = true; }
async function saveChar() {
  const name = $('charName').value.trim();
  const persona = $('charPersona').value;
  const present = $('charPresent').checked;
  const race = $('charRace').value;
  const social = $('charSocial').value;
  const appearance = $('charAppearance').value;
  const editing = editingCharId ? app.characters.find((c) => c.id === editingCharId) : null;
  const locked = new Set(editing && Array.isArray(editing.locked) ? editing.locked : []);
  if ($('charLookLock').checked) locked.add('appearance'); else locked.delete('appearance');
  if (!name) { toast('У героя должно быть имя.'); return; }
  try {
    const data = editingCharId
      ? await api(`/api/characters/${editingCharId}`, { method: 'PUT', body: JSON.stringify({ name, persona, race, social, appearance, present, locked: [...locked] }) })
      : await api('/api/characters', { method: 'POST', body: JSON.stringify({ name, persona, race, social, appearance }) });
    closeCharModal();
    blockSignatures = {};
    applyState(data, { animate: false });
    for (const b of activeChar().blocks) blockSignatures[b.id] = blockSig(b);
    snapshotCharSigs();
  } catch (err) { toast(err.message); }
}
async function deleteChar() {
  if (!editingCharId) return;
  const c = app.characters.find((x) => x.id === editingCharId);
  if (!confirm(`Удалить героя «${c ? c.name : ''}» вместе с его листом?`)) return;
  try {
    const data = await api(`/api/characters/${editingCharId}`, { method: 'DELETE' });
    closeCharModal();
    changedChars.delete(editingCharId);
    blockSignatures = {};
    applyState(data, { animate: false });
    snapshotCharSigs();
  } catch (err) { toast(err.message); }
}

// ---- Сброс ----
async function resetGame() {
  if (!confirm('Начать заново? История и листы героев будут стёрты (сами герои и настройки останутся).')) return;
  try {
    const data = await api('/api/reset', { method: 'POST' });
    changedChars.clear();
    blockSignatures = {};
    npcSigs = {};
    app.log = [];
    $('tabNpcs').classList.remove('changed');
    logEl.innerHTML = '<div class="empty-log" id="emptyLog">'
      + '<p class="empty-title">Лист пуст, история ещё не начата.</p>'
      + '<p class="empty-hint">Настрой мир, сценарий и героев — или просто нажми «Начать», и рассказчик задаст сцену сам.</p>'
      + '<button class="btn primary" id="startBtn">Начать</button></div>';
    applyState(data, { animate: false });
    snapshotCharSigs();
  } catch (err) { toast(err.message); }
}

// ---- Поле ввода ----
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}

// ---- Инициализация ----
async function init() {
  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (text) submitInput(text);
  });
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (text) submitInput(text);
    }
  });
  $('oocToggle').addEventListener('click', () => {
    oocMode = !oocMode;
    $('oocToggle').classList.toggle('active', oocMode);
    inputEl.placeholder = oocMode ? 'Сообщение рассказчику вне истории…' : 'Что ты делаешь?';
    sendBtn.textContent = oocMode ? 'Отправить' : 'Действовать';
    inputEl.focus();
  });
  document.addEventListener('click', (e) => { if (e.target.id === 'startBtn') sendAction(''); });
  logEl.addEventListener('click', (e) => {
    if (e.target.closest('.retry-btn')) { retryTurn(); return; }
    if (e.target.closest('.continue-btn')) { continueTurn(); return; }
    const b = e.target.closest('.edit-btn');
    if (b) { startEdit(b.closest('.entry')); return; }
    const cut = e.target.closest('.cut-btn');
    if (cut) { cutAt(Number(cut.closest('.entry').dataset.index)); return; }
    const br = e.target.closest('.branch-btn');
    if (br) { branchAt(Number(br.closest('.entry').dataset.index)); return; }
    const il = e.target.closest('.illus-btn');
    if (il) { openIllusModal(Number(il.closest('.entry').dataset.index)); return; }
  });

  $('statusCatalogBtn').addEventListener('click', openStatusCatalog);
  $('statusClose').addEventListener('click', closeStatusCatalog);
  $('statusCancel').addEventListener('click', closeStatusCatalog);
  $('statusSave').addEventListener('click', saveStatusCatalog);
  $('statusAdd').addEventListener('click', () => { statusDraft.unshift({ name: '', rollMod: 0, tick: null, duration: null }); renderStatusEditor(); $('statusList').querySelector('.trait-input.name')?.focus(); });
  $('statusModal').addEventListener('click', (e) => { if (e.target.id === 'statusModal') closeStatusCatalog(); });
  $('seedPoolBtn').addEventListener('click', openSeedPool);
  $('seedClose').addEventListener('click', closeSeedPool);
  $('seedCancel').addEventListener('click', closeSeedPool);
  $('seedSave').addEventListener('click', saveSeedPool);
  $('seedModal').addEventListener('click', (e) => { if (e.target.id === 'seedModal') closeSeedPool(); });
  $('traitPoolBtn').addEventListener('click', openTraitPool);
  $('traitClose').addEventListener('click', closeTraitPool);
  $('traitCancel').addEventListener('click', closeTraitPool);
  $('traitSave').addEventListener('click', saveTraitPool);
  $('traitMerge').addEventListener('click', async () => {
    try {
      const data = await api('/api/traits/merge', { method: 'POST' });
      app.traitPool = data.traitPool || [];
      traitDraft = app.traitPool.map((t) => ({ ...t, effect: t.effect ? { ...t.effect } : undefined }));
      renderTraitEditor();
      const n = data.merged?.added?.length || 0;
      toast(n ? `Добавлено черт: ${n}` : 'Все стандартные черты уже есть.');
    } catch (err) { toast(err.message); }
  });
  $('traitAdd').addEventListener('click', () => { traitDraft.unshift({ cat: 'temper', label: '', hint: '' }); renderTraitEditor(); $('traitList').querySelector('.trait-input.label')?.focus(); });
  $('traitModal').addEventListener('click', (e) => { if (e.target.id === 'traitModal') closeTraitPool(); });
  $('slotsBtn').addEventListener('click', openSlots);
  $('slotsClose').addEventListener('click', closeSlots);
  $('slotsModal').addEventListener('click', (e) => { if (e.target.id === 'slotsModal') closeSlots(); });
  $('slotList').addEventListener('click', (e) => {
    const btn = e.target.closest('.slot-act');
    const row = e.target.closest('.slot');
    if (!row) return;
    slotAction(row.dataset.id, btn ? btn.dataset.act : 'activate');
  });
  $('slotCreate').addEventListener('click', async () => {
    const name = $('newSlotName').value.trim();
    try {
      applyFullState(await api('/api/slots', { method: 'POST', body: JSON.stringify({ name }) }));
      $('newSlotName').value = '';
      closeSlots();
    } catch (err) { toast(err.message); }
  });
  installFillButtons();
  $('charLookLock').addEventListener('change', syncFillLocks);
  $('illusClose').addEventListener('click', () => { $('illusModal').hidden = true; });
  $('illusModal').addEventListener('click', (e) => { if (e.target.id === 'illusModal') $('illusModal').hidden = true; });
  $('illusReframe').addEventListener('click', illusReframe);
  $('illusDraw').addEventListener('click', () => illusDraw($('illusSeed').value.trim()));
  $('illusReseed').addEventListener('click', () => { $('illusSeed').value = ''; illusDraw(''); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('illusModal').hidden) $('illusModal').hidden = true; });
  for (const b of document.querySelectorAll('[data-image-preset]')) b.addEventListener('click', () => applyImagePreset(b.dataset.imagePreset));
  $('diagBtn').addEventListener('click', openDiag);
  $('diagClose').addEventListener('click', closeDiag);
  $('diagModal').addEventListener('click', (e) => { if (e.target.id === 'diagModal') closeDiag(); });
  $('diagRefresh').addEventListener('click', loadDiag);
  $('diagFilter').addEventListener('change', renderDiagList);
  $('diagList').addEventListener('click', (e) => { const it = e.target.closest('.diag-item'); if (it) showDiag(it.dataset.id); });
  $('diagClear').addEventListener('click', async () => {
    if (!confirm('Очистить журнал запросов?')) return;
    try { await api('/api/diag', { method: 'DELETE' }); diagItems = []; diagSelected = null; renderDiagList(); $('diagDetail').innerHTML = '<p class="sheet-empty">Журнал пуст.</p>'; refreshDiagBadge(); }
    catch (err) { toast(err.message); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('diagModal').hidden) closeDiag(); });
  refreshDiagBadge();
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsClose').addEventListener('click', closeSettings);
  $('settingsCancel').addEventListener('click', closeSettings);
  $('settingsSave').addEventListener('click', saveSettings);
  $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });

  for (const group of ['#difficultySeg', '#narrationSeg']) {
    for (const seg of document.querySelectorAll(group + ' .seg')) {
      seg.addEventListener('click', () => {
        document.querySelectorAll(group + ' .seg').forEach((x) => x.classList.remove('active'));
        seg.classList.add('active');
      });
    }
  }

  $('charAddBtn').addEventListener('click', () => openCharModal(null));
  $('charEditBtn').addEventListener('click', () => openCharModal(activeChar()));
  $('charModalClose').addEventListener('click', closeCharModal);
  $('charCancel').addEventListener('click', closeCharModal);
  $('charSave').addEventListener('click', saveChar);
  $('charDelete').addEventListener('click', deleteChar);
  $('dossierBtn').addEventListener('click', openDossier);
  $('dossierClose').addEventListener('click', closeDossier);
  $('dossierModal').addEventListener('click', (e) => { if (e.target.id === 'dossierModal') closeDossier(); });
  $('dossierEdit').addEventListener('click', () => { closeDossier(); openCharModal(activeChar()); });
  $('charAvatarPick').addEventListener('click', () => $('charAvatarFile').click());
  $('charAvatarClear').addEventListener('click', clearAvatar);
  $('charAvatarFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) uploadAvatar(file);
  });
  $('charModal').addEventListener('click', (e) => { if (e.target.id === 'charModal') closeCharModal(); });

  $('resetBtn').addEventListener('click', resetGame);

  $('tabHeroes').addEventListener('click', () => switchPanel('heroes'));
  $('tabNpcs').addEventListener('click', () => switchPanel('npcs'));
  $('tabLore').addEventListener('click', () => switchPanel('lore'));
  $('tabThreads').addEventListener('click', () => switchPanel('threads'));
  $('threadAddBtn').addEventListener('click', () => openThreadModal(null));
  $('threadList').addEventListener('click', (e) => {
    const card = e.target.closest('.thread');
    if (card) openThreadModal(app.threads.find((x) => x.id === card.dataset.id));
  });
  $('threadModalClose').addEventListener('click', closeThreadModal);
  $('threadCancel').addEventListener('click', closeThreadModal);
  $('threadSave').addEventListener('click', saveThread);
  $('threadDelete').addEventListener('click', deleteThreadNow);
  $('threadModal').addEventListener('click', (e) => { if (e.target.id === 'threadModal') closeThreadModal(); });
  $('loreAddBtn').addEventListener('click', () => openLoreModal(null));
  $('loreList').addEventListener('click', (e) => {
    const card = e.target.closest('.lore');
    if (card) openLoreModal(app.lorebook.find((x) => x.id === card.dataset.id));
  });
  $('loreModalClose').addEventListener('click', closeLoreModal);
  $('loreCancel').addEventListener('click', closeLoreModal);
  $('loreSave').addEventListener('click', saveLore);
  $('loreDelete').addEventListener('click', deleteLore);
  $('loreModal').addEventListener('click', (e) => { if (e.target.id === 'loreModal') closeLoreModal(); });
  $('npcList').addEventListener('click', (e) => {
    const card = e.target.closest('.npc');
    if (!card) return;
    const id = card.dataset.id;
    const av = e.target.closest('.npc-avatar');
    if (av) {
      const n = app.npcs.find((x) => x.id === id);
      if (n && n.avatar) { showImage(n.avatar, n.name); return; }
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'reveal') { act.classList.toggle('shown'); return; }
      if (act.dataset.act === 'edit') openNpcModal(app.npcs.find((x) => x.id === id));
      else if (act.dataset.act === 'delete') deleteNpc(id);
      return;
    }
    if (expandedNpcs.has(id)) expandedNpcs.delete(id); else expandedNpcs.add(id);
    renderNpcs(false);
  });
  $('npcSearch').addEventListener('input', (e) => {
    npcQuery = e.target.value.trim().toLowerCase();
    renderNpcs(false);
  });
  $('npcAddBtn').addEventListener('click', () => openNpcModal(null));
  $('npcAvatarPick').addEventListener('click', () => $('npcAvatarFile').click());
  $('npcAvatarClear').addEventListener('click', clearNpcAvatar);
  $('npcAvatarFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) uploadNpcAvatar(f);
  });
  $('npcModalClose').addEventListener('click', closeNpcModal);
  $('npcCancel').addEventListener('click', closeNpcModal);
  $('npcSave').addEventListener('click', saveNpc);
  $('npcDelete').addEventListener('click', deleteNpcFromModal);
  $('npcModal').addEventListener('click', (e) => { if (e.target.id === 'npcModal') closeNpcModal(); });
  for (const btn of document.querySelectorAll('#npcModal .lock')) {
    btn.addEventListener('click', () => {
      const f = btn.dataset.field;
      if (npcLocks.has(f)) npcLocks.delete(f); else npcLocks.add(f);
      renderLocks();
    });
  }
  $('sheet').addEventListener('click', (e) => {
    const btn = e.target.closest('.block-del');
    if (btn) { deleteBlock(btn.dataset.id); return; }
    const card = e.target.closest('.block');
    if (card) {
      const c = activeChar();
      const b = c && c.blocks.find((x) => x.id === card.dataset.id);
      if (b) openBlockModal(b);
    }
  });
  $('blockAddBtn').addEventListener('click', () => openBlockModal(null));
  $('blockModalClose').addEventListener('click', closeBlockModal);
  $('blockCancel').addEventListener('click', closeBlockModal);
  $('blockSave').addEventListener('click', saveBlock);
  $('blockDelete').addEventListener('click', deleteBlockFromModal);
  $('blockType').addEventListener('change', syncBlockRows);
  $('sdPingBtn').addEventListener('click', async () => {
    const note = $('sdPingNote');
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ sdUrl: $('sdUrlInput').value }) });
      const r = await api('/api/images/ping');
      note.textContent = `Связь есть. Загружена модель: ${r.model}. ` +
        (r.adetailer ? 'ADetailer установлен — лица будут дорисовываться.' : 'ADetailer не найден — лица на сценах дорисовываться не будут (установите расширение adetailer).');
    } catch (err) { note.textContent = err.message; }
  });
  $('npcAvatarDraw').addEventListener('click', () => drawPortrait('npc'));
  $('charAvatarDraw').addEventListener('click', () => drawPortrait('char'));
  $('npcAvatarRedraw').addEventListener('click', () => drawPortrait('npc', true));
  $('charAvatarRedraw').addEventListener('click', () => drawPortrait('char', true));
  $('tabEvents').addEventListener('click', () => switchPanel('events'));
  $('eventAddBtn').addEventListener('click', () => openEventModal(null));
  $('eventList').addEventListener('click', (e) => { const card = e.target.closest('.event'); if (card) openEventModal(app.events.find((x) => x.id === card.dataset.id)); });
  $('eventSearch').addEventListener('input', (e) => { eventQuery = e.target.value.trim().toLowerCase(); renderEvents(); });
  $('eventModalClose').addEventListener('click', () => { $('eventModal').hidden = true; });
  $('eventCancel').addEventListener('click', () => { $('eventModal').hidden = true; });
  $('eventSave').addEventListener('click', saveEvent);
  $('eventDelete').addEventListener('click', deleteEventNow);
  $('npcShowArchived').addEventListener('change', (e) => { showArchived = e.target.checked; renderNpcs(false); });
  const setSheet = (open) => {
    $('sidebar').classList.toggle('open', open);
    $('sheetBackdrop').hidden = !open;
    $('sheetToggle').classList.toggle('active', open);
  };
  $('sheetToggle').addEventListener('click', () => setSheet(!$('sidebar').classList.contains('open')));
  $('sheetBackdrop').addEventListener('click', () => setSheet(false));
  $('sheetClose').addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('sidebar').classList.contains('open')) setSheet(false); });
  $('syncStats').addEventListener('toggle', () => { if ($('syncStats').open) renderSyncStats(); });
  $('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('lightbox').hidden = true; });
  $('heroPortrait').addEventListener('click', () => { const c = activeChar(); if (c && c.avatar) showImage(c.avatar, c.name); else openDossier(); });
  $('sceneCard').addEventListener('click', openSceneModal);
  $('sceneModalClose').addEventListener('click', () => { $('sceneModal').hidden = true; });
  $('sceneCancel').addEventListener('click', () => { $('sceneModal').hidden = true; });
  $('sceneSave').addEventListener('click', saveScene);
  document.querySelectorAll('#sceneModal .lock-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const f = b.dataset.lock;
    if (sceneLocks.has(f)) sceneLocks.delete(f); else sceneLocks.add(f);
    renderSceneLocks();
  }));
  $('directorBtn').addEventListener('click', openDirector);
  $('directorClose').addEventListener('click', () => { $('directorModal').hidden = true; });
  $('directorCancel').addEventListener('click', () => { $('directorModal').hidden = true; });
  $('directorSave').addEventListener('click', saveDirector);

  try {
    const s = await api('/api/state');
    modelLabel.textContent = s.model || '—';
    renderLog(s.log);
    applyState(s, { animate: false });
    snapshotCharSigs();
    for (const b of activeChar().blocks) blockSignatures[b.id] = blockSig(b);
    decorateLastNarrator();
    if (s.slots) renderSlots({ slots: s.slots, activeSlotId: s.activeSlotId });
    if (!s.hasKey) toast('Ключ OpenRouter не задан — открой «Настройки», чтобы узнать, как его добавить.');
  } catch (err) {
    toast('Не удалось загрузить состояние: ' + err.message);
  }
}

init();
