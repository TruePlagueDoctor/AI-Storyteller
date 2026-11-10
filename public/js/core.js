// Версия сборки — видна в консоли браузера (F12), помогает проверить, что файл обновился.
console.log('AI Storyteller UI v60 — у каждого героя своя лента и предыстория');

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

// ---- Линии героев: у каждого своя лента ----
// Реплика видна герою, если ход его, если он был рядом (with), или запись старая, без пометки (тогда лента была общей).
let feedScope = 'hero'; // 'hero' — лента активного героя, 'all' — все ходы по порядку
function heroSees(e, heroId = app.activeCharacterId) {
  if (!e || !e.hero || e.hero === heroId) return true;
  return Array.isArray(e.with) ? e.with.includes(heroId) : true;
}
// Рядом ли герой с активным (спутник): та же компания и отмечен «в истории».
function heroNear(c) { return c.id === app.activeCharacterId || (app.companions || []).includes(c.id); }
function entryVisible(e) { return feedScope === 'all' || heroSees(e); }

// ---- Применяем свежее состояние с сервера ----
function applyState(data, { animate = false } = {}) {
  // Обновляем только то, что пришло: ответ без поля не должен стирать данные.
  if (Array.isArray(data.characters)) app.characters = data.characters;
  const heroChanged = Boolean(data.activeCharacterId && app.activeCharacterId && data.activeCharacterId !== app.activeCharacterId);
  if (data.activeCharacterId) app.activeCharacterId = data.activeCharacterId;
  if (Array.isArray(data.companions)) app.companions = data.companions;
  if (Array.isArray(data.soloHeroes)) app.soloHeroes = data.soloHeroes;
  if (data.activeSlotId) app.activeSlotId = data.activeSlotId;
  if (Array.isArray(data.npcs)) app.npcs = data.npcs;
  if (Array.isArray(data.lorebook)) app.lorebook = data.lorebook;
  if (data.codexKinds) app.codexKinds = data.codexKinds;
  if (data.codexLinks) app.codexLinks = data.codexLinks;
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
  // Сменился герой — показываем его ленту.
  if (heroChanged) { feedScope = 'hero'; renderLog(Array.isArray(data.log) ? data.log : app.log); decorateLastNarrator(); }
}
