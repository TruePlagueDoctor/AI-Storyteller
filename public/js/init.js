// Инициализация: обработчики событий и первый запрос состояния. Подключается последним.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
  $('backupsBox').addEventListener('toggle', () => { if ($('backupsBox').open) loadBackups(); });
  $('backupNow').addEventListener('click', async () => {
    try { renderBackups((await api('/api/backups', { method: 'POST' })).items || []); toast('Копия сделана.'); }
    catch (err) { toast(err.message); }
  });
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
  $('diagPrompt').addEventListener('click', showPromptBreakdown);
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
  installSettingsNav();
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
    installQol();
    installSearch();
  } catch (err) {
    toast('Не удалось загрузить состояние: ' + err.message);
  }
}

init();
