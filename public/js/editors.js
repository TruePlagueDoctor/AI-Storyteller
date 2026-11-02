// Редакторы: НПС, досье героя, каталог статусов, заготовки, черты.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
