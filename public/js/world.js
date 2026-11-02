// Панели мира: лорбук, НПС, ручные блоки листа, нити, хроника.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
  // Умелость: профессионала и мастера видно сразу — против них проверки труднее.
  if ((n.competence && n.competence !== 'обычный') || (n.skills || []).length) {
    const lv = n.competence && n.competence !== 'обычный' ? n.competence : '';
    const c = mk('div', 'npc-competence' + (lv === 'мастер' ? ' master' : ''), [lv, (n.skills || []).join(', ')].filter(Boolean).join(' · '));
    c.title = lv ? `Против его умений проверки труднее: ${lv === 'мастер' ? '−4' : '−2'}` : 'Ключевые умения';
    main.appendChild(c);
  }
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
