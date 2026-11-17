// Библиотека персонажей: общая для всех историй. Сохранить героя или НПС, взять в историю копией, файл.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

let libraryItems = [];

async function openLibrary() {
  $('libraryModal').hidden = false;
  // Героя в идущую историю можно взять спутником или с отдельной историей.
  $('libraryHeroModeWrap').hidden = !app.log.length;
  $('libraryList').innerHTML = '<p class="sheet-empty">Загружаю…</p>';
  try { libraryItems = (await api('/api/library')).items || []; } catch (err) { toast(err.message); libraryItems = []; }
  renderLibrary();
}
function closeLibrary() { $('libraryModal').hidden = true; }

function renderLibrary() {
  const list = $('libraryList');
  list.innerHTML = '';
  if (!libraryItems.length) {
    const p = document.createElement('p'); p.className = 'sheet-empty';
    p.textContent = 'Пока пусто. Открой досье понравившегося персонажа или героя и нажми «В библиотеку» — он появится здесь и будет доступен в любой истории.';
    list.appendChild(p);
    return;
  }
  const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  for (const it of libraryItems) {
    const card = mk('div', 'lib-card');
    card.dataset.id = it.id;
    const face = mk('div', 'lib-face' + (it.avatar ? ' has-image' : ''));
    if (it.avatar) face.style.backgroundImage = `url('/avatars/${it.avatar}')`; else face.textContent = (it.name || '?').trim().charAt(0).toUpperCase();
    card.appendChild(face);
    const main = mk('div', 'lib-main');
    main.appendChild(mk('div', 'lib-name', it.name));
    const c = it.card || {};
    main.appendChild(mk('div', 'lib-sub', [it.from === 'hero' ? 'был героем' : 'был НПС', c.race, c.competence && c.competence !== 'обычный' ? c.competence : ''].filter(Boolean).join(' · ')));
    const about = String(c.description || c.personality || '').split(/(?<=[.!?…])\s/)[0];
    if (about) main.appendChild(mk('div', 'lib-about', about.length > 160 ? about.slice(0, 159) + '…' : about));
    const acts = mk('div', 'lib-acts');
    const btn = (act, text, title, cls = '') => { const b = mk('button', 'btn ghost small ' + cls, text); b.type = 'button'; b.dataset.act = act; b.title = title; return b; };
    acts.appendChild(btn('npc', 'Взять как НПС', 'Добавить копию в эту историю как персонажа'));
    acts.appendChild(btn('hero', 'Взять героем', 'Добавить копию в эту историю как героя — он станет активным'));
    const file = mk('a', 'btn ghost small', '⬇ Файл'); file.href = `/api/library/${it.id}/export`; file.title = 'Сохранить файлом с портретом — для копии или чтобы поделиться';
    acts.appendChild(file);
    acts.appendChild(btn('delete', '✕', 'Убрать из библиотеки (в историях персонаж останется)', 'danger'));
    main.appendChild(acts);
    card.appendChild(main);
    list.appendChild(card);
  }
}

async function libraryAction(id, act) {
  const it = libraryItems.find((x) => x.id === id);
  if (!it) return;
  if (act === 'delete') {
    if (!confirm(`Убрать «${it.name}» из библиотеки? В историях, куда он уже взят, он останется.`)) return;
    try { libraryItems = (await api(`/api/library/${id}`, { method: 'DELETE' })).items || []; renderLibrary(); } catch (err) { toast(err.message); }
    return;
  }
  const body = { as: act === 'hero' ? 'hero' : 'npc', separate: act === 'hero' && $('libraryHeroMode').value === 'separate' };
  const send = (extra = {}) => api(`/api/library/${id}/import`, { method: 'POST', body: JSON.stringify({ ...body, ...extra }) });
  try {
    let data;
    try { data = await send(); }
    catch (err) {
      // В истории уже есть персонаж с таким именем — спрашиваем, добавлять ли второго.
      if (!(err.payload && err.payload.duplicate)) throw err;
      if (!confirm(`${err.message} Добавить ещё одного с тем же именем?`)) return;
      data = await send({ force: true });
    }
    blockSignatures = {};
    applyState(data, { animate: false });
    snapshotCharSigs();
    closeLibrary();
    toast(act === 'hero' ? `«${it.name}» — теперь герой этой истории.` : `«${it.name}» добавлен в персонажи этой истории.`);
  } catch (err) { toast(err.message); }
}

// «В библиотеку» из досье НПС и героя.
async function saveToLibrary(kind, id) {
  if (!id) return;
  try {
    const r = await api('/api/library', { method: 'POST', body: JSON.stringify({ kind, id }) });
    libraryItems = r.items || [];
    toast(r.updated ? 'Запись в библиотеке обновлена.' : 'Сохранён в библиотеку — теперь его можно взять в любую историю.');
  } catch (err) { toast(err.message); }
}

async function uploadLibraryFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  try {
    let doc;
    try { doc = JSON.parse(await f.text()); } catch { throw new Error('Не удалось прочитать файл: это не файл персонажа.'); }
    const r = await api('/api/library/upload', { method: 'POST', body: JSON.stringify({ file: doc }) });
    libraryItems = r.items || [];
    renderLibrary();
    toast(r.updated ? 'Запись в библиотеке обновлена из файла.' : 'Персонаж добавлен в библиотеку.');
  } catch (err) { toast(err.message); }
}

function installLibrary() {
  $('libraryBtn').addEventListener('click', openLibrary);
  $('libraryHeroBtn').addEventListener('click', openLibrary);
  $('libraryClose').addEventListener('click', closeLibrary);
  $('libraryModal').addEventListener('click', (e) => { if (e.target.id === 'libraryModal') closeLibrary(); });
  $('libraryList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) libraryAction(b.closest('.lib-card').dataset.id, b.dataset.act);
  });
  $('libraryUpload').addEventListener('click', () => $('libraryFile').click());
  $('libraryFile').addEventListener('change', () => uploadLibraryFile($('libraryFile')));
  $('npcViewToLibrary').addEventListener('click', () => saveToLibrary('npc', viewingNpcId));
  $('dossierToLibrary').addEventListener('click', () => saveToLibrary('hero', app.activeCharacterId));
}
