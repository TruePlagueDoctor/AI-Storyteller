// Кнопка ✨: заполнить поле карточки по истории.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

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
    for (const ids of Object.values(FILL_TARGETS[kind])) {
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
