// Досье для чтения: персонаж (НПС) и статья кодекса. Править — кнопкой «Изменить».
// Народ в досье — ссылка на статью; в статье народа — знакомые этого народа.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

let viewingNpcId = null;
let viewingLoreId = null;

const dEl = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
function dSection(body, title, color) {
  const sec = dEl('div', 'dossier-section');
  if (color) sec.style.setProperty('--type-color', color);
  sec.appendChild(dEl('h3', null, title));
  body.appendChild(sec);
  return sec;
}
function dRow(name, value, desc) {
  const r = dEl('div', 'dossier-row');
  const top = dEl('div', 'dossier-row-top');
  top.appendChild(dEl('span', 'dossier-row-name', name));
  if (value) top.appendChild(dEl('span', 'dossier-row-value', value));
  r.appendChild(top);
  if (desc) r.appendChild(dEl('div', 'dossier-row-desc', desc));
  return r;
}
// Подпись + текст (для «Кто это», «Голос»…).
function dField(sec, label, text) {
  if (!text || !String(text).trim()) return false;
  const f = dEl('div', 'dossier-field');
  f.append(dEl('div', 'dossier-field-label', label), dEl('div', 'dossier-text', text));
  sec.appendChild(f);
  return true;
}
function dPortrait(avatar, name, glyph = '✦') {
  const p = dEl('div', 'dossier-portrait' + (avatar ? ' has-image' : ''));
  if (avatar) { p.style.backgroundImage = `url('/avatars/${avatar}')`; p.addEventListener('click', () => showImage(avatar, name)); }
  else p.textContent = glyph;
  return p;
}
const codexEntryOf = (id) => {
  const eid = (app.codexLinks || {})[id];
  return eid ? app.lorebook.find((e) => e.id === eid) : null;
};
// Ссылка на статью народа (или просто метка, если статьи нет).
function raceTag(holderId, race) {
  const entry = codexEntryOf(holderId);
  const t = dEl(entry ? 'button' : 'span', 'dossier-tag race' + (entry ? ' link' : ''), entry ? `${race} ↗` : race);
  if (entry) { t.type = 'button'; t.title = `Статья кодекса «${entry.title}»`; t.addEventListener('click', () => openCodexView(entry.id)); }
  return t;
}

// ---- Досье НПС ----
function openNpcView(id) {
  const n = app.npcs.find((x) => x.id === id);
  if (!n) return;
  viewingNpcId = id;
  $('codexViewModal').hidden = true;
  renderNpcView(n);
  $('npcViewModal').hidden = false;
  $('npcViewBody').scrollTop = 0;
}
function closeNpcView() { $('npcViewModal').hidden = true; }

function renderNpcView(n) {
  const body = $('npcViewBody');
  body.innerHTML = '';
  $('npcViewTitle').textContent = 'Досье';
  const head = dEl('div', 'dossier-head');
  head.appendChild(dPortrait(n.avatar, n.name));
  const ident = dEl('div', 'dossier-ident');
  ident.appendChild(dEl('h3', 'dossier-name', n.name));
  const att = dEl('div', 'dossier-attitude', n.attitude || 'отношение не ясно');
  att.style.color = attitudeColor(n.attitude);
  ident.appendChild(att);
  const tags = dEl('div', 'dossier-tags');
  if (n.race) tags.appendChild(raceTag(n.id, n.race));
  if (n.competence && n.competence !== 'обычный') tags.appendChild(dEl('span', 'dossier-tag', n.competence + ((n.skills || []).length ? ' · ' + n.skills.join(', ') : '')));
  else if ((n.skills || []).length) tags.appendChild(dEl('span', 'dossier-tag', n.skills.join(', ')));
  if (n.bound) tags.appendChild(dEl('span', 'dossier-tag', 'всегда с героем'));
  if (n.archived) tags.appendChild(dEl('span', 'dossier-tag muted', 'в архиве'));
  if (tags.children.length) ident.appendChild(tags);
  const sample = (n.voiceSamples || []).slice(-1)[0];
  if (sample) ident.appendChild(dEl('div', 'dossier-persona', `«${sample}»`));
  head.appendChild(ident);
  body.appendChild(head);

  // Сейчас: где он, настроение, когда виделись.
  const here = ((app.scene && app.scene.present) || []).some((p) => p.toLowerCase().split(/\s+/)[0] === n.name.toLowerCase().split(/\s+/)[0]);
  const now = [];
  if (n.status) now.push(['Где и как', n.status]);
  if (n.mood) now.push(['Настроение', n.mood + (n.moodReason ? ` — ${n.moodReason}` : '')]);
  now.push(['С героем', here ? 'сейчас рядом' : n.lastSeen ? `последняя встреча: день ${n.lastSeen.day} (ход ${n.lastSeen.turn})` : 'давно не виделись']);
  const sNow = dSection(body, 'Сейчас');
  for (const [k, v] of now) sNow.appendChild(dRow(k, null, v));

  const who = dSection(body, 'Кто это');
  let any = dField(who, 'Роль и прошлое', n.description);
  any = dField(who, 'Внешность', n.appearance) || any;
  if ((n.traits || []).length) {
    const tr = dEl('div', 'dossier-tags');
    for (const t of n.traits) { const tag = dEl('span', 'dossier-tag trait', t); const m = app.traitPool.find((x) => x.label === t); if (m && m.hint) tag.title = m.hint; tr.appendChild(tag); }
    who.appendChild(tr); any = true;
  }
  if (!any) who.appendChild(dEl('p', 'dossier-empty', 'Пока почти ничего не известно.'));

  let anyN = false;
  const tmp = dSection(body, 'Нрав и цели');
  anyN = dField(tmp, 'Характер', n.personality) || anyN;
  anyN = dField(tmp, 'Чего хочет', n.wants) || anyN;
  anyN = dField(tmp, 'Изюминка', n.quirk) || anyN;
  if (n.secret) {
    const f = dEl('div', 'dossier-field');
    const v = dEl('div', 'dossier-text npc-secret', n.secret);
    v.title = 'Показать тайну';
    v.addEventListener('click', () => v.classList.toggle('shown'));
    f.append(dEl('div', 'dossier-field-label', 'Что скрывает'), v);
    tmp.appendChild(f); anyN = true;
  }
  if (!anyN) tmp.remove();

  const voice = dSection(body, 'Голос');
  let anyV = false;
  anyV = dField(voice, 'Манера', n.voiceStyle) || anyV;
  anyV = dField(voice, 'Юмор', n.voiceHumor) || anyV;
  anyV = dField(voice, 'Словечки и привычки', n.voiceHabits) || anyV;
  anyV = dField(voice, 'Как прячет чувства', n.voiceMasks) || anyV;
  anyV = dField(voice, 'В речи никогда', n.voiceTaboos) || anyV;
  if ((n.voiceSamples || []).length) {
    const q = dEl('div', 'dossier-quotes');
    for (const s of n.voiceSamples) q.appendChild(dEl('div', 'dossier-quote', `«${s}»`));
    voice.appendChild(q); anyV = true;
  }
  if (!anyV) voice.remove();

  const items = String(n.history || '').split(/;\s+/).map((x) => x.trim()).filter(Boolean);
  if (items.length) {
    const h = dSection(body, 'Было с героем');
    const ol = dEl('ol', 'dossier-history');
    for (const it of items) ol.appendChild(dEl('li', null, it));
    h.appendChild(ol);
  }
  if (n.links) dField(dSection(body, 'Связи'), '', n.links);

  // Хроника: факты, где он участник.
  const first = n.name.toLowerCase().split(/\s+/)[0];
  const facts = (app.events || []).filter((e) => (e.participants || []).some((p) => p.toLowerCase().split(/\s+/)[0] === first));
  if (facts.length) {
    const sec = dSection(body, 'В хронике');
    for (const e of facts.slice(-8)) {
      const closed = e.status === 'done';
      sec.appendChild(dRow(e.text, (EVENT_LABEL[e.type] || 'факт') + (closed ? ` · ${OUTCOME_LABEL[e.outcome] || 'закрыто'}` : ''), null));
    }
  }
}

// ---- Статья кодекса ----
const normC = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
// «Эльфы» в строке отношений → статья народа (как на сервере: короткое слово без последней буквы — начало длинного).
function peopleByName(name) {
  const w = normC(name).split(/[^\p{L}]+/u).filter((x) => x.length >= 3);
  const eq = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; const base = s.length > 3 ? s.slice(0, -1) : s; return s.length >= 3 && l.startsWith(base) && l.length - base.length <= 5; };
  return app.lorebook.find((e) => e.kind === 'people' && (normC(e.title) === normC(name) ||
    w.some((x) => [...normC(e.title).split(/\s+/), ...(e.keys || []).map(normC)].some((c) => eq(x, c))))) || null;
}

function openCodexView(id) {
  const e = app.lorebook.find((x) => x.id === id);
  if (!e) return;
  viewingLoreId = id;
  $('npcViewModal').hidden = true;
  renderCodexView(e);
  $('codexViewModal').hidden = false;
  $('codexViewBody').scrollTop = 0;
}
function closeCodexView() { $('codexViewModal').hidden = true; }

// Иллюстрация статьи: арт «типичного представителя» и управление им.
function renderCodexArt(e) {
  const kind = e.kind || 'other';
  const col = dEl('div', 'codex-art');
  const frame = dEl('div', `codex-frame kind-${kind}` + (e.image ? ' has-image' : ''));
  if (e.image) {
    frame.style.backgroundImage = `url('/avatars/${e.image}')`;
    frame.title = 'Открыть крупно';
    frame.addEventListener('click', () => showImage(e.image, e.title));
  } else {
    frame.appendChild(dEl('span', 'codex-frame-glyph', CODEX_GLYPH[kind]));
    frame.appendChild(dEl('span', 'codex-frame-hint', kind === 'place' ? 'Как выглядит это место?' : 'Нарисовать типичного представителя'));
  }
  col.appendChild(frame);
  // Инструменты — маленькой полоской значков поверх картинки, чтобы место доставалось арту.
  // Теги спрятаны за «#» и открываются по нажатию.
  const acts = dEl('div', 'codex-art-tools');
  const tool = (glyph, title) => { const b = dEl('button', 'codex-tool', glyph); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); return b; };
  const draw = tool('🎨', e.image ? 'Перерисовать по тегам (пусто — модель составит их по статье)' : 'Нарисовать по статье');
  const fresh = tool('↻', 'Составить теги заново по статье и нарисовать');
  const tagsBtn = tool('#', 'Теги иллюстрации — поправить и перерисовать');
  const up = tool('⤒', 'Загрузить свою картинку');
  const clear = tool('✕', 'Убрать иллюстрацию');
  clear.disabled = !e.image;
  acts.append(draw, fresh, tagsBtn, up, clear);
  acts.addEventListener('click', (ev) => ev.stopPropagation()); // щелчок по значку не открывает картинку крупно
  frame.appendChild(acts);
  const det = dEl('div', 'codex-tags');
  det.hidden = true;
  const ta = dEl('textarea');
  ta.rows = 4;
  ta.placeholder = 'Пусто — модель составит теги по статье при рисовании';
  ta.value = e.imageTags || '';
  det.appendChild(ta);
  const go = dEl('button', 'btn ghost', '🎨 Нарисовать по этим тегам');
  go.type = 'button';
  det.appendChild(go);
  col.appendChild(det);
  tagsBtn.addEventListener('click', () => { det.hidden = !det.hidden; tagsBtn.classList.toggle('on', !det.hidden); if (!det.hidden) ta.focus(); });

  const status = dEl('div', 'codex-busy');
  frame.appendChild(status);
  const busy = (on, label) => { for (const b of [draw, fresh, up, clear, go]) b.disabled = on || (b === clear && !e.image); status.textContent = on ? label : ''; frame.classList.toggle('busy', on); };
  const run = async (tags) => {
    busy(true, tags ? 'Рисую…' : 'Составляю теги и рисую…');
    try {
      const data = await api(`/api/lore/${e.id}/illustrate`, { method: 'POST', body: JSON.stringify({ tags }) });
      applyState(data);
      for (const w of (data.illustration && data.illustration.warnings) || []) toast('A1111: ' + w);
      if (viewingLoreId === e.id && !$('codexViewModal').hidden) renderCodexView(app.lorebook.find((x) => x.id === e.id));
    } catch (err) {
      toast(err.message);
      busy(false);
    }
  };
  draw.addEventListener('click', () => run(ta.value.trim()));
  go.addEventListener('click', () => run(ta.value.trim()));
  fresh.addEventListener('click', () => run(''));
  up.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const dataUrl = await shrinkImage(f);
        applyState(await api(`/api/lore/${e.id}/image`, { method: 'POST', body: JSON.stringify({ dataUrl }) }));
        renderCodexView(app.lorebook.find((x) => x.id === e.id));
      } catch (err) { toast(err.message); }
    });
    inp.click();
  });
  clear.addEventListener('click', async () => {
    try { applyState(await api(`/api/lore/${e.id}/image`, { method: 'DELETE' })); renderCodexView(app.lorebook.find((x) => x.id === e.id)); }
    catch (err) { toast(err.message); }
  });
  return col;
}

function renderCodexView(e) {
  const body = $('codexViewBody');
  body.innerHTML = '';
  const kind = e.kind || 'other';
  $('codexViewTitle').textContent = CODEX_TITLE[kind] || 'Кодекс';
  // Как в книге: слева крупная иллюстрация, справа текст статьи.
  const layout = dEl('div', 'codex-layout');
  layout.appendChild(renderCodexArt(e));
  const text = dEl('div', 'codex-text');
  layout.appendChild(text);
  body.appendChild(layout);
  renderCodexText(e, text, kind);
}

function renderCodexText(e, body, kind) {
  const head = dEl('div', 'codex-head');
  const ident = dEl('div', 'dossier-ident');
  ident.appendChild(dEl('h3', 'dossier-name', e.title));
  const tags = dEl('div', 'dossier-tags');
  tags.appendChild(dEl('span', 'dossier-tag', (app.codexKinds && app.codexKinds.labels[kind]) || kind));
  if (kind === 'creature' && e.fields && e.fields.danger) { const d = dEl('span', 'dossier-tag danger', '☠'.repeat(e.fields.danger)); d.title = `Опасность ${e.fields.danger} из 5`; tags.appendChild(d); }
  if (e.always) tags.appendChild(dEl('span', 'dossier-tag muted', 'всегда в контексте'));
  if (e.enabled === false) tags.appendChild(dEl('span', 'dossier-tag muted', 'выключена'));
  ident.appendChild(tags);
  const brief = String(e.brief || '').trim();
  if (brief) ident.appendChild(dEl('div', 'dossier-persona', brief));
  head.appendChild(ident);
  body.appendChild(head);

  const fields = codexFields(kind).filter(([k]) => k !== 'danger' && e.fields && e.fields[k]);
  if (fields.length) {
    const sec = dSection(body, 'Главное');
    for (const [k, label] of fields) dField(sec, label, e.fields[k]);
  }
  if (kind === 'people' && (e.relations || []).length) {
    const sec = dSection(body, 'Отношение к другим народам', 'var(--relation)');
    for (const r of e.relations) {
      const row = dRow(r.to, null, r.text);
      const target = peopleByName(r.to);
      if (target && target.id !== e.id) {
        const name = row.querySelector('.dossier-row-name');
        name.classList.add('link'); name.textContent = `${r.to} ↗`;
        name.addEventListener('click', () => openCodexView(target.id));
      }
      sec.appendChild(row);
    }
  }
  if (String(e.content || '').trim()) {
    const sec = dSection(body, 'Подробно');
    for (const para of e.content.split(/\n{2,}|\n/).map((x) => x.trim()).filter(Boolean)) sec.appendChild(dEl('p', 'dossier-text para', para));
  }
  // Знакомые этого народа — ссылками на их досье.
  if (kind === 'people') {
    const links = app.codexLinks || {};
    const people = app.npcs.filter((n) => links[n.id] === e.id);
    const heroes = app.characters.filter((c) => links[c.id] === e.id);
    if (people.length || heroes.length) {
      const sec = dSection(body, 'Знакомые этого народа');
      for (const c of heroes) sec.appendChild(dRow(c.name, 'герой', c.social || null));
      for (const n of people) {
        const row = dRow(`${n.name} ↗`, n.attitude || '', n.description ? n.description.split(/(?<=[.!?…])\s/)[0] : null);
        const nm = row.querySelector('.dossier-row-name');
        nm.classList.add('link');
        nm.addEventListener('click', () => openNpcView(n.id));
        sec.appendChild(row);
      }
    }
  }
  if (!fields.length && !brief && !String(e.content || '').trim()) body.appendChild(dEl('p', 'dossier-empty', 'Статья пока пустая — нажми «Изменить».'));
  if ((e.keys || []).length) body.appendChild(dEl('p', 'codex-keys', 'Узнаётся по словам: ' + e.keys.join(', ')));
}

function installDossiers() {
  $('npcViewClose').addEventListener('click', closeNpcView);
  $('npcViewModal').addEventListener('click', (e) => { if (e.target.id === 'npcViewModal') closeNpcView(); });
  $('npcViewEdit').addEventListener('click', () => { const n = app.npcs.find((x) => x.id === viewingNpcId); closeNpcView(); if (n) openNpcModal(n); });
  $('codexViewClose').addEventListener('click', closeCodexView);
  $('codexViewModal').addEventListener('click', (e) => { if (e.target.id === 'codexViewModal') closeCodexView(); });
  $('codexViewEdit').addEventListener('click', () => { const e = app.lorebook.find((x) => x.id === viewingLoreId); closeCodexView(); if (e) openLoreModal(e); });
}
