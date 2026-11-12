// Истории (слоты), настройки, редактор героя, сброс, поле ввода.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
      // «Начать заново» — только у текущей истории; раньше кнопка стояла в шапке рядом с настройками.
      ...(sl.active ? [['reset', '↺', 'Начать эту историю заново: лента и листы сотрутся, герои и настройки останутся', 'danger']] : []),
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
  if ($('backupsBox').open) loadBackups();
}

// ---- Резервные копии ----
async function loadBackups() {
  const list = $('backupList');
  list.innerHTML = '<p class="sheet-empty">Загружаю…</p>';
  let items = [];
  try { items = (await api('/api/backups')).items || []; } catch (err) { list.innerHTML = ''; toast(err.message); return; }
  renderBackups(items);
}
function renderBackups(items) {
  const list = $('backupList');
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<p class="sheet-empty">Копий пока нет.</p>'; return; }
  for (const b of items) {
    const box = document.createElement('div');
    box.className = 'backup';
    const head = document.createElement('div');
    head.className = 'backup-head';
    head.textContent = `${b.label}${b.reason ? ' · ' + b.reason : ''}`;
    box.appendChild(head);
    for (const sl of b.slots) {
      const row = document.createElement('div');
      row.className = 'backup-slot';
      const nm = document.createElement('span');
      nm.textContent = `${sl.name} — ${sl.turns} ${plural(sl.turns, 'ход', 'хода', 'ходов')}`;
      const btn = document.createElement('button');
      btn.className = 'link-btn';
      btn.textContent = 'восстановить';
      btn.title = 'Создать новую историю из этой копии. Текущие истории не изменятся.';
      btn.addEventListener('click', async () => {
        try {
          applyFullState(await api(`/api/backups/${b.id}/restore`, { method: 'POST', body: JSON.stringify({ slotId: sl.id }) }));
          toast(`Восстановлено: «${sl.name}» — новой историей.`);
          closeSlots();
        } catch (err) { toast(err.message); }
      });
      row.append(nm, btn);
      box.appendChild(row);
    }
    list.appendChild(box);
  }
}
function closeSlots() { $('slotsModal').hidden = true; }

// Переключение партии перерисовывает всё: история, герои, НПС, мир.
function applyFullState(data) {
  blockSignatures = {}; npcSigs = {}; charSigs = {}; changedChars.clear();
  if (data.activeCharacterId) app.activeCharacterId = data.activeCharacterId; // до ленты: она рисуется глазами активного героя
  if (Array.isArray(data.characters)) app.characters = data.characters;
  // Другая история — свой черновик хода.
  if (data.activeSlotId && data.activeSlotId !== app.activeSlotId) {
    app.activeSlotId = data.activeSlotId;
    inputEl.value = lsGet(draftKey());
    autoGrow();
  }
  renderLog(data.log);
  applyState(data, { animate: false });
  snapshotCharSigs();
  decorateLastNarrator();
  if (data.slots) renderSlots({ slots: data.slots, activeSlotId: data.activeSlotId });
}

async function slotAction(id, act) {
  try {
    if (act === 'reset') { await resetGame(); if (!app.log.length) $('slotsModal').hidden = true; return; }
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
    $('fallbackModelInput').value = s.fallbackModel || '';
    $('temperatureInput').value = s.temperature ?? 0.8;
    $('repetitionInput').value = s.repetitionPenalty ?? 0.3;
    $('frequencyInput').value = s.frequencyPenalty ?? 0;
    $('worldInput').value = s.worldPrompt || '';
    $('scenarioInput').value = s.scenarioPrompt || '';
    $('promptInput').value = s.systemPrompt || '';
    $('clicheInput').value = (s.clichePhrases || []).join('\n');
    for (const seg of document.querySelectorAll('#difficultySeg .seg')) {
      seg.classList.toggle('active', seg.dataset.value === (s.difficulty || 'normal'));
    }
    for (const seg of document.querySelectorAll('#narrationSeg .seg')) {
      seg.classList.toggle('active', seg.dataset.value === (s.narration || 'second_ty'));
    }
    $('stateSyncInput').checked = s.stateSync !== false;
    $('loreAutoWriteInput').checked = s.loreAutoWrite === true;
    $('syncPromptStyleInput').value = s.syncPromptStyle === 'legacy' ? 'legacy' : 'technical';
    $('promptLayoutInput').value = s.promptLayout === 'classic' ? 'classic' : 'cache';
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
    $('handFixInput').checked = s.handFix !== false;
    $('portraitHiresInput').checked = s.portraitHires !== false;
    $('imageSchedulerInput').value = s.imageScheduler ?? 'Karras';
    $('sceneHiresInput').checked = s.sceneHires !== false;
    $('hiresScaleInput').value = s.hiresScale ?? 1.5;
    $('hiresDenoiseInput').value = s.hiresDenoise ?? 0.4;
    $('hiresUpscalerInput').value = s.hiresUpscaler || 'R-ESRGAN 4x+';
    $('historyKeepInput').value = s.historyKeep || 20;
    $('summaryInput').value = s.summary || '';
    $('summaryLabel').textContent = app.characters.length > 1 && activeChar() ? `Предыстория героя «${activeChar().name}»` : 'Предыстория';
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
    markSettingsNav(true);
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
        fallbackModel: $('fallbackModelInput').value,
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
        handFix: $('handFixInput').checked,
        portraitHires: $('portraitHiresInput').checked,
        imageScheduler: $('imageSchedulerInput').value,
        sceneHires: $('sceneHiresInput').checked,
        hiresScale: $('hiresScaleInput').value,
        hiresDenoise: $('hiresDenoiseInput').value,
        hiresUpscaler: $('hiresUpscalerInput').value,
        difficulty,
        narration,
        stateSync: $('stateSyncInput').checked,
        loreAutoWrite: $('loreAutoWriteInput').checked,
        syncPromptStyle: $('syncPromptStyleInput').value,
        promptLayout: $('promptLayoutInput').value,
        diceEnabled: $('diceEnabledInput').checked,
        autoSummarize: $('autoSummarizeInput').checked,
        historyKeep: $('historyKeepInput').value,
        summary: $('summaryInput').value,
        systemPrompt: $('promptInput').value,
        clichePhrases: $('clicheInput').value,
      }),
    });
    modelLabel.textContent = data.model;
    closeSettings();
  } catch (err) { toast(err.message); }
}

// ---- Редактор героя ----
// Замки полей героя: имя, раса, положение — кнопками у подписей; внешность — галочкой под полем.
let charLocks = new Set();
function renderCharLocks() {
  document.querySelectorAll('#charModal .lock-btn').forEach((b) => {
    const on = charLocks.has(b.dataset.lock);
    b.textContent = on ? '🔒' : '🔓';
    b.classList.toggle('on', on);
  });
}
function openCharModal(char) {
  refreshPeopleList();
  editingCharId = char ? char.id : null;
  resetFill('hero');
  $('charModalTitle').textContent = char ? 'Изменить героя' : 'Новый герой';
  $('charName').value = char ? char.name : '';
  $('charPersona').value = char ? char.persona : '';
  $('charRace').value = char ? (char.race || '') : '';
  $('charSocial').value = char ? (char.social || '') : '';
  $('charAppearance').value = char ? (char.appearance || '') : '';
  $('charLookLock').checked = Boolean(char && Array.isArray(char.locked) && char.locked.includes('appearance'));
  charLocks = new Set(char && Array.isArray(char.locked) ? char.locked : []);
  renderCharLocks();
  const aliases = char && Array.isArray(char.aliases) ? char.aliases : [];
  $('charAliasesHint').hidden = !aliases.length;
  $('charAliasesHint').textContent = aliases.length ? `Прежде звался: ${aliases.join(', ')} — так его зовут те, кто не слышал о перемене.` : '';
  syncFillLocks();
  const prevLook = char && char.appearancePrev && char.appearancePrev !== char.appearance ? char.appearancePrev : '';
  $('charLookRestore').hidden = !prevLook;
  $('charLookRestore').onclick = () => {
    $('charAppearance').value = prevLook;
    toast('Подставлена прежняя внешность — нажми «Сохранить», чтобы вернуть её.');
  };
  $('charDelete').style.display = char && app.characters.length > 1 ? '' : 'none';
  const isActive = char && char.id === app.activeCharacterId;
  $('charPresent').checked = char ? heroNear(char) : true;
  $('charPresent').disabled = !char || isActive;
  // Новый герой в идущей партии: спутник нынешнего или своя отдельная история.
  $('charSeparateField').hidden = char ? app.characters.length < 2 : !app.log.length;
  $('charSeparate').checked = Boolean(char && (app.soloHeroes || []).includes(char.id));
  $('charSeparate').dataset.was = $('charSeparate').checked ? '1' : '';
  $('charPresentHint').textContent = isActive
    ? 'Ты играешь за этого героя. Чтобы убрать или присоединить другого — нажми кружок на его вкладке.'
    : 'Включено — он спутник: в сцене рядом с героем, история у них общая. Выключи, если его сейчас нет в сцене.';
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
// Что изменилось в «рядом / отдельно»: шлём только перемену, иначе сохранение героя заново «присоединяло» бы его.
function charGroupChange(char, present) {
  const out = {};
  const sep = $('charSeparate').checked;
  if (sep !== Boolean($('charSeparate').dataset.was)) out.separate = sep;
  if (char && char.id !== app.activeCharacterId && present !== heroNear(char) && !(sep && present)) out.present = present;
  return out;
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
  const locked = new Set(editing ? charLocks : []);
  if ($('charLookLock').checked) locked.add('appearance'); else locked.delete('appearance');
  if (!name) { toast('У героя должно быть имя.'); return; }
  try {
    const data = editingCharId
      ? await api(`/api/characters/${editingCharId}`, { method: 'PUT', body: JSON.stringify({ name, persona, race, social, appearance, locked: [...locked], ...charGroupChange(editing, present) }) })
      : await api('/api/characters', { method: 'POST', body: JSON.stringify({ name, persona, race, social, appearance, separate: $('charSeparate').checked }) });
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
    logEl.innerHTML = emptyLogHtml();
    applyState(data, { animate: false });
    snapshotCharSigs();
  } catch (err) { toast(err.message); }
}

// ---- Поле ввода ----
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}

// Разделы настроек: строка переходов сверху, текущий раздел подсвечивается при прокрутке.
function installSettingsNav() {
  const nav = document.querySelector('.settings-nav');
  if (!nav) return;
  const scroller = nav.closest('.modal-body');
  const buttons = [...nav.querySelectorAll('button[data-target]')];
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-target]');
    if (!b) return;
    const sec = $(b.dataset.target);
    scroller.scrollTo({ top: sec.offsetTop - nav.offsetHeight - 8, behavior: 'smooth' });
  });
  const mark = () => {
    const y = scroller.scrollTop + nav.offsetHeight + 24;
    let current = buttons[0];
    for (const b of buttons) if ($(b.dataset.target).offsetTop <= y) current = b;
    buttons.forEach((b) => b.classList.toggle('active', b === current));
  };
  scroller.addEventListener('scroll', mark, { passive: true });
  // Пока окно скрыто, у разделов нет размеров — подсветку считаем при открытии.
  markSettingsNav = (toTop) => { if (toTop) scroller.scrollTop = 0; mark(); };
}
let markSettingsNav = () => {};
