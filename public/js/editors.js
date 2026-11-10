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
  mood: 'npcMood', moodReason: 'npcMoodReason', race: 'npcRace',
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
  refreshPeopleList();
  resetFill('npc');
  $('npcModalTitle').textContent = npc ? 'Досье персонажа' : 'Новый персонаж';
  npcTraitsOpen = false;
  for (const [field, id] of Object.entries(NPC_FIELD_IDS)) $(id).value = npc ? (npc[field] || '') : '';
  npcLocks = new Set(npc && Array.isArray(npc.locked) ? npc.locked : []);
  $('npcBound').checked = Boolean(npc && npc.bound);
  $('npcSelf').checked = Boolean(npc && npc.self);
  $('npcVoiceSamples').value = npc && Array.isArray(npc.voiceSamples) ? npc.voiceSamples.join('\n') : '';
  $('npcCompetence').value = (npc && npc.competence) || '';
  $('npcSkills').value = npc && Array.isArray(npc.skills) ? npc.skills.join(', ') : '';
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
  const body = { locked: [...npcLocks], traits: [...npcTraitSel], bound: $('npcBound').checked, self: $('npcSelf').checked,
    voiceSamples: $('npcVoiceSamples').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(-8),
    competence: $('npcCompetence').value, skills: $('npcSkills').value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 3) };
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
// Уровни умений и пороги опыта — как в src/progress.js (рост от удачных бросков).
const SKILL_LEVELS = ['новичок', 'ученик', 'опытный', 'мастер'];
const SKILL_NEED = { 'ученик': 3, 'опытный': 7, 'мастер': 14 };

function renderDossier() {
  const c = activeChar();
  if (!c) return;
  const body = $('dossierBody');
  body.innerHTML = '';
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const blocks = c.blocks || [];
  const ofType = (t) => blocks.filter((b) => b.type === t);

  // Шапка: портрет в раме, имя, раса и положение, описание.
  const head = el('div', 'dossier-head');
  const portrait = el('div', 'dossier-portrait' + (c.avatar ? ' has-image' : ''));
  portrait.addEventListener('click', () => { if (c.avatar) showImage(c.avatar, c.name); });
  if (c.avatar) portrait.style.backgroundImage = `url('/avatars/${c.avatar}')`;
  else portrait.textContent = '✦';
  head.appendChild(portrait);
  const ident = el('div', 'dossier-ident');
  ident.appendChild(el('h3', 'dossier-name', c.name));
  const tags = el('div', 'dossier-tags');
  if (c.race && c.race.trim()) tags.appendChild(raceTag(c.id, c.race.trim())); // ссылка на статью народа, если она есть
  if (c.social && c.social.trim()) tags.appendChild(el('span', 'dossier-tag', c.social));
  if (tags.children.length) ident.appendChild(tags);
  if (c.persona && c.persona.trim()) ident.appendChild(el('div', 'dossier-persona', c.persona));
  head.appendChild(ident);
  body.appendChild(head);

  const section = (title, color) => {
    const sec = el('div', 'dossier-section');
    if (color) sec.style.setProperty('--type-color', color);
    sec.appendChild(el('h3', null, title));
    body.appendChild(sec);
    return sec;
  };
  const empty = (sec, text) => sec.appendChild(el('p', 'dossier-empty', text));
  const row = (name, value, desc) => {
    const r = el('div', 'dossier-row');
    const top = el('div', 'dossier-row-top');
    top.appendChild(el('span', 'dossier-row-name', name));
    if (value) top.appendChild(el('span', 'dossier-row-value', value));
    r.appendChild(top);
    if (desc) r.appendChild(el('div', 'dossier-row-desc', desc));
    return r;
  };

  // Внешность
  const look = section('Внешность');
  if (c.appearance && c.appearance.trim()) look.appendChild(el('div', 'dossier-text', c.appearance));
  else empty(look, 'Не описана. Задай её в редакторе героя — рассказчик будет дополнять по ходу.');

  // Состояние: показатели с полосами и состояния с эффектами.
  const stats = ofType('stat');
  const statuses = ofType('status');
  if (stats.length || statuses.length) {
    const sc = section('Состояние', 'var(--stat)');
    if (stats.length) {
      const grid = el('div', 'hero-stat-grid');
      for (const st of stats) {
        const cell = el('div', 'hero-stat');
        const top = el('div', 'dossier-row-top');
        top.appendChild(el('span', 'dossier-row-name', st.name));
        top.appendChild(el('span', 'dossier-row-value', st.max != null ? `${st.value ?? '?'} / ${st.max}` : String(st.value ?? '')));
        cell.appendChild(top);
        const ratio = Number(st.value) / st.max;
        if (st.max != null && Number.isFinite(ratio)) {
          const bar = el('div', 'hero-stat-bar');
          const fill = el('span');
          fill.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
          if (ratio <= 0.25) cell.classList.add('low');
          bar.appendChild(fill);
          cell.appendChild(bar);
        }
        grid.appendChild(cell);
      }
      sc.appendChild(grid);
    }
    if (statuses.length) {
      const chips = el('div', 'dossier-tags status-chips');
      for (const st of statuses) {
        const def = (app.statusCatalog || []).find((d) => d.name.toLowerCase() === st.name.toLowerCase());
        const rm = st.rollMod ?? def?.rollMod;
        const tk = st.tick ?? def?.tick;
        const fx = [rm ? `${rm > 0 ? '+' : ''}${rm} к броскам` : '', tk && tk.stat ? `${tk.stat} ${tk.delta > 0 ? '+' : ''}${tk.delta}/ход` : '', st.duration != null ? `ещё ${st.duration} х.` : ''].filter(Boolean);
        const chip = el('span', 'dossier-tag status-chip');
        chip.appendChild(el('b', null, st.value ? `${st.name}: ${st.value}` : st.name));
        if (fx.length) chip.appendChild(el('span', null, ' · ' + fx.join(' · ')));
        if (st.description) chip.title = st.description;
        chips.appendChild(chip);
      }
      sc.appendChild(chips);
    }
  }

  // Умения: уровень делениями и опыт до следующего.
  const ab = section('Умения', 'var(--relation)');
  const abilities = ofType('ability');
  if (abilities.length) {
    for (const a of abilities) {
      const lvl = SKILL_LEVELS.indexOf(String(a.value || '').trim().toLowerCase());
      const r = row(a.name, null, a.description);
      const top = r.firstChild;
      const pips = el('span', 'skill-pips');
      if (lvl >= 0) {
        for (let i = 0; i < SKILL_LEVELS.length; i++) pips.appendChild(el('i', i <= lvl ? 'on' : ''));
        pips.title = a.value;
      }
      top.appendChild(el('span', 'dossier-row-value', a.value || ''));
      top.appendChild(pips);
      const next = lvl >= 0 ? SKILL_LEVELS[lvl + 1] : null;
      if (next) {
        const key = a.name.trim().toLowerCase();
        const xp = Math.max((c.skillXp || {})[key] || 0, SKILL_NEED[SKILL_LEVELS[lvl]] || 0);
        r.appendChild(el('div', 'skill-xp', `опыт ${xp} из ${SKILL_NEED[next]} до «${next}» — растёт от удачных проверок и тренировок`));
      }
      ab.appendChild(r);
    }
  } else empty(ab, 'Пока никаких. Появятся, когда герой чему-то научится.');

  // Снаряжение
  const items = ofType('item');
  if (items.length) {
    const it = section('Снаряжение', 'var(--item)');
    for (const b of items) it.appendChild(row(b.name, b.value, b.description));
  }

  // Отношения с группами
  const rels = ofType('relationship');
  if (rels.length) {
    const rs = section('Отношения', 'var(--relation)');
    for (const b of rels) rs.appendChild(row(b.name, b.value, b.description));
  }

  // Другие герои — можно убрать из истории, не переключаясь на них.
  const others = app.characters.filter((x) => x.id !== c.id);
  if (others.length) {
    const os = section('Другие герои');
    for (const o of others) {
      const r = row(o.name + (heroNear(o) ? '' : ' · не рядом'), null, o.persona);
      const btn = el('button', 'btn ghost small', heroNear(o) ? 'Убрать из сцены' : 'Присоединить');
      btn.addEventListener('click', async () => {
        await togglePresence(o.id, !heroNear(o));
        renderDossier();
      });
      r.firstChild.appendChild(btn);
      os.appendChild(r);
    }
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
