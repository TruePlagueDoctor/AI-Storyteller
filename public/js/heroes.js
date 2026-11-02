// Вкладки героев и лист активного героя.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
