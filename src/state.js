// Хранилище игрового состояния. Один слот сохранения в data/save.json.
// Одна история, несколько героев; у каждого героя свой лист блоков.

import { DEFAULT_CLICHE_PHRASES, normalizeCliches } from './contradictions.js';
import { switchRelations, dropRelations, migrateRelations, reconcileRelations, groupOf, companionIds } from './relations.js';
import { switchLine, dropLine, migrateLines, reconcileLines } from './lines.js';
import { emptyScene, normalizeScene } from './scene.js';
import { normalizeEvents, EVENT_TYPES } from './chronicle.js';
import { DEFAULT_IMAGE_SETTINGS } from './images.js';
import { readFile, writeFile, mkdir, unlink, rm, readdir, cp, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SYSTEM_PROMPT, LEGACY_SYSTEM_PROMPTS } from './prompt.js';
import { DEFAULT_TRAITS } from './traits.js';
import { DEFAULT_SEEDS, normalizeSeeds } from './seeds.js';
import { normalizeStatusCatalog } from './statuses.js';
import { normalizeEntry } from './codex.js';

const SAVE_PATH = join(DATA_DIR, 'save.json');          // старый формат, для миграции
const SLOTS_DIR = join(DATA_DIR, 'slots');
const GLOBAL_PATH = join(DATA_DIR, 'settings.json');    // общие настройки: модель, промт рассказчика
const INDEX_PATH = join(DATA_DIR, 'slots.json');        // список партий и активная

// Что живёт в общих настройках, а не в партии.
const GLOBAL_FIELDS = ['syncPromptStyle', 'promptLayout', 'clichePhrases', 'model', 'toolModel', 'systemPrompt', 'temperature', 'repetitionPenalty', 'frequencyPenalty', 'traitPool', 'seedPool', 'statusCatalog', 'sdUrl', 'imageStyle', 'imageNegative', 'imageSize', 'imageSteps', 'imageCfg', 'imageSampler', 'sceneStyle', 'sceneNegative', 'sceneSize', 'imageClipSkip', 'faceFix', 'sceneHires', 'hiresScale', 'hiresDenoise', 'hiresUpscaler', 'handFix', 'portraitHires', 'imageScheduler'];
const IMAGE_FIELDS = ['sdUrl', 'imageStyle', 'imageNegative', 'imageSize', 'imageSteps', 'imageCfg', 'imageSampler', 'sceneStyle', 'sceneNegative', 'sceneSize', 'imageClipSkip', 'faceFix', 'sceneHires', 'hiresScale', 'hiresDenoise', 'hiresUpscaler', 'handFix', 'portraitHires', 'imageScheduler'];

export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function newCharacter(name = 'Герой', persona = '') {
  return {
    id: randomUUID(), name, persona, avatar: null,
    race: '', social: '', appearance: '', present: true,   // паспорт героя
    blocks: [],
  };
}

function emptyState() {
  const c = newCharacter();
  return {
    characters: [c],
    activeCharacterId: c.id,
    npcs: [],              // встреченные персонажи мира: {id,name,description,attitude,status}
    lorebook: [],           // записи мира: {id,title,keys[],content,always,enabled}
    threads: [],            // сюжетные нити: {id,title,status,progress,notes,openedTurn}
    scene: emptyScene(),    // где герой, какое время, кто рядом
    events: [],             // хроника: установленные факты и события
    traitPool: DEFAULT_TRAITS.map((t) => ({ ...t })), // палитра черт характера
    seedPool: normalizeSeeds(DEFAULT_SEEDS),            // изюминки и тайны для персонажей
    statusCatalog: normalizeStatusCatalog(null),        // статусы с эффектами
    turn: 0,                // номер хода (для отслеживания устаревших карточек)
    loreAutoWrite: false,   // можно ли рассказчику дописывать лорбук
    diceEnabled: true,      // проверки умений броском кубика
    messages: [],          // история для модели (без system): user/assistant/tool
    log: [],               // то, что показываем игроку
    systemPrompt: DEFAULT_SYSTEM_PROMPT,  // поведение рассказчика
    worldPrompt: '',       // мир / сеттинг
    scenarioPrompt: '',    // сценарий
    difficulty: 'normal',  // story | normal | hard | brutal
    narration: 'second_ty', // third | second_ty | second_vy — лицо повествования
    stateSync: true,       // двухпроходный ход с отдельным шагом учёта
    summary: '',           // свёрнутая предыстория (заменяет старые ходы)
    autoSummarize: true,   // сворачивать историю автоматически
    historyKeep: 20,       // сколько последних сообщений держать сырыми
    model: DEFAULT_MODEL,  // модель рассказа
    toolModel: '',         // отдельная модель для прохода учёта (пусто = как рассказ)
    temperature: 0.8,      // «температура» рассказа
    repetitionPenalty: 0.3, // presence_penalty — мягкий штраф за повтор тем
    frequencyPenalty: 0,    // frequency_penalty — калечит пунктуацию, по умолчанию 0
    lastSnapshot: null,    // снимок мира до последнего хода (для регенерации)
  };
}

export const DIFFICULTIES = ['story', 'normal', 'hard', 'brutal'];
export const NARRATIONS = ['third', 'second_ty', 'second_vy'];

// Приводит любое загруженное состояние к актуальной схеме
// (в т.ч. миграция со старого формата с общим массивом blocks).
function migrate(s) {
  s = s || {};
  const out = {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    worldPrompt: '',
    scenarioPrompt: '',
    difficulty: 'normal',
    narration: 'second_ty',
    stateSync: true,
    summary: '',
    autoSummarize: true,
    historyKeep: 20,
    model: DEFAULT_MODEL,
    messages: [],
    log: [],
    ...s,
  };

  if (!Array.isArray(out.characters) || out.characters.length === 0) {
    const c = newCharacter();
    if (Array.isArray(s.blocks)) c.blocks = s.blocks; // миграция v1
    out.characters = [c];
  }
  delete out.blocks;

  for (const c of out.characters) {
    if (!c.id) c.id = randomUUID();
    if (typeof c.name !== 'string' || !c.name) c.name = 'Герой';
    if (typeof c.persona !== 'string') c.persona = '';
    if (typeof c.avatar !== 'string') c.avatar = null;
    if (typeof c.race !== 'string') c.race = '';
    if (typeof c.social !== 'string') c.social = '';
    if (typeof c.appearance !== 'string') c.appearance = '';
    // Присутствует ли герой в истории. Неактивные не попадают в контекст,
    // чтобы рассказчик не вплетал персонажей, которых в сцене нет.
    if (typeof c.present !== 'boolean') c.present = true;
    if (!c.skillXp || typeof c.skillXp !== 'object') c.skillXp = {};
    if (!c.practiceDays || typeof c.practiceDays !== 'object') c.practiceDays = {}; // умение → игровой день последней тренировки
    if (!Array.isArray(c.appearanceLog)) c.appearanceLog = []; // перемены внешности, расы, имени и кто их видел
    if (!Array.isArray(c.aliases)) c.aliases = []; // прежние имена героя («известен также как»)
    if (!Array.isArray(c.blocks)) c.blocks = [];
    for (const b of c.blocks) if (!b.id) b.id = randomUUID();
  }

  if (!out.activeCharacterId || !out.characters.find((c) => c.id === out.activeCharacterId)) {
    out.activeCharacterId = out.characters[0].id;
  }

  if (typeof out.systemPrompt !== 'string' || !out.systemPrompt) out.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  // Промт, который игрок не правил, обновляется вместе с программой; свой — не трогаем.
  if (LEGACY_SYSTEM_PROMPTS.some((p) => p.trim() === out.systemPrompt.trim())) out.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  if (typeof out.worldPrompt !== 'string') out.worldPrompt = '';
  if (typeof out.scenarioPrompt !== 'string') out.scenarioPrompt = '';
  out.scene = normalizeScene(out.scene);
  out.events = normalizeEvents(out.events);
  // Список заезженных оборотов: нет — берём стандартный; пустой — выбор игрока.
  out.clichePhrases = normalizeCliches(out.clichePhrases) || [...DEFAULT_CLICHE_PHRASES];
  migrateLines(out); // предыстория — по героям (прежняя общая остаётся у всех прежних героев)
  if (Array.isArray(out.npcs)) migrateRelations(out); // отношения НПС — по героям (старое значение остаётся у всех прежних героев)
  for (const f of IMAGE_FIELDS) if (out[f] === undefined) out[f] = DEFAULT_IMAGE_SETTINGS[f];
  if (typeof out.directorNote !== 'string') out.directorNote = '';
  if (!DIFFICULTIES.includes(out.difficulty)) out.difficulty = 'normal';
  if (!NARRATIONS.includes(out.narration)) out.narration = 'second_ty';
  out.stateSync = out.stateSync !== false;
  if (typeof out.summary !== 'string') out.summary = '';
  out.autoSummarize = out.autoSummarize !== false;
  const keep = Number(out.historyKeep);
  out.historyKeep = Number.isFinite(keep) ? Math.min(200, Math.max(6, Math.round(keep))) : 20;

  if (typeof out.turn !== 'number') out.turn = 0;
  out.loreAutoWrite = out.loreAutoWrite === true;
  out.diceEnabled = out.diceEnabled !== false;
  if (!Array.isArray(out.traitPool) || !out.traitPool.length) {
    out.traitPool = DEFAULT_TRAITS.map((t) => ({ ...t }));
  }
  for (const t of out.traitPool) {
    if (!t.id) t.id = randomUUID();
    if (typeof t.label !== 'string') t.label = 'Черта';
    if (typeof t.hint !== 'string') t.hint = '';
    if (typeof t.cat !== 'string') t.cat = 'temper';
  }
  if (!out.seedPool || typeof out.seedPool !== 'object') out.seedPool = normalizeSeeds(DEFAULT_SEEDS);
  else out.seedPool = normalizeSeeds(out.seedPool);
  out.statusCatalog = normalizeStatusCatalog(Array.isArray(out.statusCatalog) ? out.statusCatalog : null);
  if (!Array.isArray(out.threads)) out.threads = [];
  for (const t of out.threads) {
    if (!t.id) t.id = randomUUID();
    if (typeof t.title !== 'string') t.title = 'Нить';
    if (!['open', 'done', 'failed'].includes(t.status)) t.status = 'open';
    if (typeof t.progress !== 'string') t.progress = '';
    if (typeof t.notes !== 'string') t.notes = '';
    if (typeof t.openedTurn !== 'number') t.openedTurn = 0;
  }
  // Кодекс (бывший лорбук): у старых записей появляются раздел «прочее», пустая выжимка и поля.
  if (!Array.isArray(out.lorebook)) out.lorebook = [];
  out.lorebook = out.lorebook.filter((e) => e && typeof e === 'object').map((e) => {
    const n = normalizeEntry(e);
    if (n.author !== 'narrator') n.author = 'player';
    return n;
  });

  if (!Array.isArray(out.npcs)) out.npcs = [];
  for (const n of out.npcs) {
    if (!n.id) n.id = randomUUID();
    if (typeof n.name !== 'string') n.name = 'Некто';
    if (typeof n.description !== 'string') n.description = '';
    if (typeof n.appearance !== 'string') n.appearance = '';
    if (typeof n.personality !== 'string') n.personality = '';
    if (typeof n.history !== 'string') n.history = '';
    if (typeof n.wants !== 'string') n.wants = '';
    if (typeof n.secret !== 'string') n.secret = '';
    if (typeof n.quirk !== 'string') n.quirk = '';
    if (typeof n.links !== 'string') n.links = '';
    if (typeof n.avatar !== 'string') n.avatar = null;
    if (!Array.isArray(n.traits)) n.traits = [];
    if (!Array.isArray(n.locked)) n.locked = [];
    if (typeof n.updatedTurn !== 'number') n.updatedTurn = 0;
    if (typeof n.attitude !== 'string') n.attitude = '';
    if (typeof n.status !== 'string') n.status = '';
    if (n.competence !== undefined && !['обычный', 'профессионал', 'мастер'].includes(n.competence)) delete n.competence;
    if (n.skills !== undefined && !Array.isArray(n.skills)) delete n.skills;
  }
  if (typeof out.model !== 'string' || !out.model) out.model = DEFAULT_MODEL;
  if (typeof out.toolModel !== 'string') out.toolModel = '';
  const temp = Number(out.temperature);
  out.temperature = Number.isFinite(temp) ? Math.min(2, Math.max(0, temp)) : 0.8;
  const pen = Number(out.repetitionPenalty);
  out.repetitionPenalty = Number.isFinite(pen) ? Math.min(2, Math.max(0, pen)) : 0.3;
  const fpen = Number(out.frequencyPenalty);
  out.frequencyPenalty = Number.isFinite(fpen) ? Math.min(2, Math.max(0, fpen)) : 0;
  if (!Array.isArray(out.messages)) out.messages = [];
  if (!Array.isArray(out.log)) out.log = [];
  return out;
}

let state = emptyState();

let slots = [];          // [{ id, name, updatedAt }]
let activeSlotId = null;
let globals = {};        // общие настройки

const slotPath = (id) => join(SLOTS_DIR, `${id}.json`);
// Снимки ходов лежат рядом со слотом, по файлу на реплику рассказчика:
// data/slots/<id>.turns/<индекс в ленте>.json — { variants: [{entry, snap}], current }.
const turnsDir = (id) => join(SLOTS_DIR, `${id}.turns`);
const turnPath = (id, index) => join(turnsDir(id), `${index}.json`);

// Обёртка реплики «вне истории» — одна на сервер и на восстановление ветки.
export function oocWrap(text) {
  return '[ВНЕ ИСТОРИИ — указание от игрока рассказчику, это НЕ действие и не реплика персонажа]\n' + text + '\n\n' +
    'Учти это указание. Если игрок просит переиграть или поправить последнюю сцену — внеси правку в повествование. ' +
    'Если это общее пожелание по тону, стилю или поведению — коротко подтверди вне истории и следуй ему дальше. ' +
    'Не считай это репликой или поступком персонажа.';
}

// Нет файла — fallback. Файл есть, но битый — тоже fallback, но громко: иначе
// партия молча загрузилась бы пустой и следующее сохранение затёрло бы её.
async function readJson(path, fallback) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch { return fallback; }
  try { return JSON.parse(text); } catch (e) {
    const bad = `${path}.broken-${Date.now()}`;
    try { await writeFile(bad, text, 'utf8'); } catch { /* не вышло — хотя бы предупредим */ }
    console.warn(`[сохранение] Файл ${path} повреждён (${e.message}). Копия: ${bad}`);
    return fallback;
  }
}

// Запись через временный файл и переименование: сбой посреди записи
// (выключили компьютер, кончилось место) не оставит полузаписанную партию.
let tmpSeq = 0;
async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

function pickGlobals(src) {
  const out = {};
  for (const f of GLOBAL_FIELDS) if (src[f] !== undefined) out[f] = src[f];
  return out;
}

// Партия хранится без общих полей — они подмешиваются при загрузке.
function slotPayload(st) {
  const out = { ...st };
  for (const f of GLOBAL_FIELDS) delete out[f];
  return out;
}

export async function loadState() {
  const index = await readJson(INDEX_PATH, null);
  globals = await readJson(GLOBAL_PATH, {});

  if (index && Array.isArray(index.slots) && index.slots.length) {
    slots = index.slots;
    activeSlotId = index.activeSlotId && slots.find((x) => x.id === index.activeSlotId)
      ? index.activeSlotId
      : slots[0].id;
    const raw = await readJson(slotPath(activeSlotId), null);
    state = migrate({ ...(raw || {}), ...globals });
    return state;
  }

  // Первый запуск или переход со старого формата: заводим слот из save.json.
  const legacy = await readJson(SAVE_PATH, null);
  const base = migrate(legacy || {});
  globals = pickGlobals(base);
  activeSlotId = randomUUID();
  slots = [{ id: activeSlotId, name: legacy ? 'Моя история' : 'Новая история', updatedAt: Date.now() }];
  state = base;
  await writeJson(GLOBAL_PATH, globals);
  await writeJson(slotPath(activeSlotId), slotPayload(state));
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return state;
}

export async function saveState() {
  if (!activeSlotId) return;
  globals = pickGlobals(state);
  const entry = slots.find((x) => x.id === activeSlotId);
  if (entry) entry.updatedAt = Date.now();
  await writeJson(slotPath(activeSlotId), slotPayload(state));
  await writeJson(GLOBAL_PATH, globals);
  await writeJson(INDEX_PATH, { slots, activeSlotId });
}

// ---- Управление партиями ----
export function listSlots() {
  return {
    slots: slots
      .map((x) => ({ ...x, active: x.id === activeSlotId }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    activeSlotId,
  };
}

export async function createSlot(name) {
  await saveState();
  const id = randomUUID();
  slots.push({ id, name: (name || 'Новая история').trim() || 'Новая история', updatedAt: Date.now() });
  activeSlotId = id;
  state = migrate({ ...globals });   // чистая партия, общие настройки сохраняются
  await writeJson(slotPath(id), slotPayload(state));
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return state;
}

export async function switchSlot(id) {
  if (id === activeSlotId) return state;
  const entry = slots.find((x) => x.id === id);
  if (!entry) throw new Error('История не найдена.');
  await saveState();
  activeSlotId = id;
  const raw = await readJson(slotPath(id), {});
  state = migrate({ ...raw, ...globals });
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return state;
}

export async function renameSlot(id, name) {
  const entry = slots.find((x) => x.id === id);
  if (!entry) throw new Error('История не найдена.');
  const n = String(name || '').trim();
  if (!n) throw new Error('Нужно название.');
  entry.name = n;
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return listSlots();
}

export async function deleteSlot(id) {
  if (slots.length <= 1) throw new Error('Нельзя удалить последнюю историю.');
  slots = slots.filter((x) => x.id !== id);
  try { await unlink(slotPath(id)); } catch { /* файла может не быть */ }
  try { await rm(turnsDir(id), { recursive: true, force: true }); } catch { /* нет снимков — не страшно */ }
  if (activeSlotId === id) {
    activeSlotId = slots[0].id;
    const raw = await readJson(slotPath(activeSlotId), {});
    state = migrate({ ...raw, ...globals });
  }
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return state;
}

// Партия из резервной копии — новой историей рядом с текущими (ничего не затирая).
// Снимков ходов у неё нет: свайпы и обрезка начинаются с этого момента.
export async function importSlot(raw, name) {
  if (!raw || typeof raw !== 'object') throw new Error('Пустая копия.');
  await saveState();
  const id = randomUUID();
  slots.push({ id, name: String(name || 'Восстановленная история').trim(), updatedAt: Date.now() });
  activeSlotId = id;
  const payload = { ...raw };
  delete payload.preSync; delete payload.lastSnapshot;
  // Вариантов (свайпов) в копии нет — счётчики «1/3» иначе обещали бы то, чего нет.
  payload.log = (Array.isArray(payload.log) ? payload.log : []).map((e) => { const x = { ...e }; delete x.variants; delete x.variant; return x; });
  state = migrate({ ...payload, ...globals });
  await writeJson(slotPath(id), slotPayload(state));
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return state;
}

// Копия партии — удобно перед рискованным поворотом сюжета.
export async function duplicateSlot(id) {
  const entry = slots.find((x) => x.id === id);
  if (!entry) throw new Error('История не найдена.');
  if (id === activeSlotId) await saveState();
  const raw = await readJson(slotPath(id), {});
  const newId = randomUUID();
  slots.push({ id: newId, name: `${entry.name} (копия)`, updatedAt: Date.now() });
  await writeJson(slotPath(newId), raw);
  try { await cp(turnsDir(id), turnsDir(newId), { recursive: true }); } catch { /* снимков может не быть */ }
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  return listSlots();
}

// ---- История как дерево: снимки ходов, обрезка, варианты, ветки ----

// Полный снимок после хода: мир + переписка с моделью + предыстория.
// ---- Ручные правки переживают откат ----
// Откат хода (перегенерация, свайп, обрезка, сбой) возвращает мир к снимку — и раньше затирал всё,
// что игрок поправил руками после снимка: кодекс, НПС, лист, нити, хронику. Теперь каждая ручная
// правка запоминается с отметкой времени, и после отката поверх снимка заново накладываются правки,
// сделанные ПОЗЖЕ него. То, что записали рассказчик и учётчик за отменённый ход, — откатывается.
let lastStamp = 0;
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
const MANUAL_COLLECTIONS = { npc: 'npcs', lore: 'lorebook', thread: 'threads', event: 'events' };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
// Запоминаем только то, что игрок реально изменил, — по полям и со своим временем у каждого:
// иначе вместе с правкой «впечатывалось» бы и то, что учётчик записал за отменяемый ход.
// before === null — создано игроком; after === null — удалено. charId — для блоков листа.
export function noteManual(kind, id, before, after, charId) {
  if (!state.manual || typeof state.manual !== 'object') state.manual = {};
  const key = `${kind}:${charId ? charId + '/' : ''}${id}`;
  const now = stamp();
  const rec = state.manual[key] || { kind, id, charId, fields: {} };
  rec.at = now;
  if (after == null) { rec.deletedAt = now; state.manual[key] = rec; return; }
  delete rec.deletedAt;
  if (before == null) { rec.created = true; rec.createdAt = now; }
  if (rec.created) rec.full = deepCopy(after); // созданное игроком после снимка — вернуть целиком
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'id') continue;
    if (before && same(before[k], after[k])) continue;
    rec.fields[k] = k in after ? { at: now, v: deepCopy(after[k]) } : { at: now, del: true };
  }
  state.manual[key] = rec;
  const all = Object.keys(state.manual);
  if (all.length > 600) { // не растём бесконечно: самые старые правки уже есть во всех снимках
    all.sort((x, y) => state.manual[x].at - state.manual[y].at).slice(0, all.length - 600).forEach((k) => delete state.manual[k]);
  }
}
function applyManualOverlay(since) {
  const recs = Object.values(state.manual || {}).filter((r) => r && r.at > since).sort((x, y) => x.at - y.at);
  for (const r of recs) {
    let arr = null;
    if (MANUAL_COLLECTIONS[r.kind]) arr = Array.isArray(state[MANUAL_COLLECTIONS[r.kind]]) ? state[MANUAL_COLLECTIONS[r.kind]] : (state[MANUAL_COLLECTIONS[r.kind]] = []);
    else if (r.kind === 'block') { const c = state.characters.find((x) => x.id === r.charId); arr = c ? c.blocks : null; }
    let target = null;
    if (arr) {
      const i = arr.findIndex((x) => x.id === r.id);
      if (r.deletedAt > since) { if (i !== -1) arr.splice(i, 1); continue; }
      if (i === -1) { if (r.created && r.createdAt > since && r.full) arr.push(deepCopy(r.full)); continue; }
      target = arr[i];
    } else if (r.kind === 'char') target = state.characters.find((x) => x.id === r.id);
    else if (r.kind === 'scene') target = state.scene;
    if (!target) continue;
    for (const [k, f] of Object.entries(r.fields || {})) {
      if (!(f.at > since)) continue;
      if (f.del) delete target[k]; else target[k] = deepCopy(f.v);
    }
  }
  if (state.scene) state.scene = normalizeScene(state.scene);
}

function captureFullSnapshot() {
  return {
    at: stamp(),
    blocksByChar: Object.fromEntries(state.characters.map((c) => [c.id, deepCopy(c.blocks)])),
    charsByid: Object.fromEntries(state.characters.map((c) => [c.id, { skillXp: deepCopy(c.skillXp || {}), practiceDays: deepCopy(c.practiceDays || {}), appearanceLog: deepCopy(c.appearanceLog || []), appearance: c.appearance, social: c.social, name: c.name, race: c.race, aliases: deepCopy(c.aliases || []) }])),
    npcs: deepCopy(state.npcs),
    threads: deepCopy(state.threads),
    scene: deepCopy(state.scene),
    events: deepCopy(state.events || []),
    lorebook: deepCopy(state.lorebook || []),
    turn: state.turn || 0,
    correctionNote: state.correctionNote,
    messages: deepCopy(state.messages),
    summary: state.summary || '',
    summaries: deepCopy(state.summaries || {}), // предыстории остальных героев
    activeCharacterId: state.activeCharacterId,
    relFor: state.activeCharacterId, // чьи отношения лежат в полях НПС этого снимка
  };
}

function applyFullSnapshot(snap) {
  applySnapshot(snap, { reconcile: false });
  if (Array.isArray(snap.messages)) state.messages = deepCopy(snap.messages);
  if (typeof snap.summary === 'string') state.summary = snap.summary;
  if (snap.activeCharacterId && state.characters.some((c) => c.id === snap.activeCharacterId)) state.activeCharacterId = snap.activeCharacterId;
  reconcileRelations(state, snap);
  reconcileLines(state, snap);
}

// Номер варианта и их число — свойства ленты, в файл хода не пишем.
const stripEntry = (e) => { const rest = { ...e }; delete rest.variants; delete rest.variant; return rest; };

// Вызывается после удачного хода: кладёт реплику рассказчика и снимок мира
// после неё в файл хода. Повторная генерация того же хода добавляет вариант.
// ---- Снимок «перед учётом» для кнопки «переучесть» ----
// Мир после текста хода, но до записей учётчика. Привязан к индексу реплики
// в ленте: после обрезки, свайпа или регенерации он недействителен.
export function clearPreSync() { state.preSync = null; }
export function capturePreSync() { state.preSync = { index: null, snap: captureFullSnapshot() }; }
export function bindPreSync(index) { if (state.preSync && state.preSync.index == null) state.preSync.index = index; }
export function canResync() {
  const i = state.log.length - 1;
  return Boolean(state.preSync && state.preSync.index === i && state.log[i] && state.log[i].role === 'narrator');
}
// Возвращает мир к состоянию до учёта. Переписку не трогаем: текст хода мог
// быть исправлен игроком — тогда учёт пойдёт уже по исправленному.
export function restorePreSync() {
  if (!canResync()) return false;
  applySnapshot(deepCopy(state.preSync.snap));
  return true;
}

// Ход дополнился после записи (кнопка «Договорить» + учёт) — обновляем текущий
// вариант на месте, а не заводим новый: иначе свайп назад потерял бы дописанное.
// Контекст реплики рассказчика для иллюстрации: её текст и мир на тот момент
// (снимок варианта), а не нынешний — старая сцена могла быть в другом месте.
export async function entryContext(index) {
  const entry = state.log[index];
  if (!entry || entry.role !== 'narrator') throw new Error('Иллюстрировать можно только реплику рассказчика.');
  const file = await readJson(turnPath(activeSlotId, index), null);
  const snap = file && file.variants[file.current] && file.variants[file.current].snap;
  const prevPlayer = [...state.log.slice(0, index)].reverse().find((e) => e.role === 'player');
  return {
    text: entry.text,
    action: prevPlayer ? prevPlayer.text : '',
    scene: deepCopy(snap?.scene || state.scene),
    npcs: deepCopy(snap?.npcs || state.npcs || []),
    characters: state.characters.map((c) => ({
      id: c.id, name: c.name, race: c.race, social: c.social, portraitTags: c.portraitTags,
      appearance: snap?.charsByid?.[c.id]?.appearance ?? c.appearance,
      present: c.present !== false, active: c.id === state.activeCharacterId,
    })),
  };
}

// Картинки реплики: в ленте и в файле текущего варианта, чтобы пережили перелистывание.
export async function setEntryImages(index, images) {
  const entry = state.log[index];
  if (!entry || entry.role !== 'narrator') throw new Error('Реплика не найдена.');
  entry.images = images;
  const file = await readJson(turnPath(activeSlotId, index), null);
  if (file && file.variants[file.current] && file.variants[file.current].entry) {
    file.variants[file.current].entry.images = images;
    await writeJson(turnPath(activeSlotId, index), file);
  }
  await saveState();
  return entry;
}

export async function refreshTurnOutcome() {
  const index = state.log.length - 1;
  const entry = state.log[index];
  if (!entry || entry.role !== 'narrator') return;
  const file = await readJson(turnPath(activeSlotId, index), null);
  if (!file || !file.variants[file.current]) return;
  file.variants[file.current] = { entry: stripEntry(entry), snap: captureFullSnapshot() };
  await writeJson(turnPath(activeSlotId, index), file);
}

export async function recordTurnOutcome() {
  const index = state.log.length - 1;
  const entry = state.log[index];
  if (!entry || entry.role !== 'narrator') return;
  // Перед первым ответом рассказчика запоминаем исходную точку — к ней
  // откатываемся, если обрезать или ветвить историю с самого начала.
  if (lastNarratorBefore(index - 1) < 0 && state.lastSnapshot) {
    const base = deepCopy(state.lastSnapshot);
    base.messages = []; // переписка до первого хода пуста
    await writeJson(join(turnsDir(activeSlotId), 'base.json'), { variants: [{ entry: null, snap: base }], current: 0 });
  }
  const file = (await readJson(turnPath(activeSlotId, index), null)) || { variants: [], current: -1 };
  file.variants.push({ entry: stripEntry(entry), snap: captureFullSnapshot() });
  if (file.variants.length > 12) file.variants.splice(0, file.variants.length - 12);
  file.current = file.variants.length - 1;
  await writeJson(turnPath(activeSlotId, index), file);
  entry.variants = file.variants.length;
  entry.variant = file.current;
}

async function dropTurnFilesAfter(index) {
  let names = [];
  try { names = await readdir(turnsDir(activeSlotId)); } catch { return; }
  for (const n of names) {
    const i = Number(n.replace('.json', ''));
    if (Number.isFinite(i) && i > index) { try { await unlink(turnPath(activeSlotId, i)); } catch { /* пусто */ } }
  }
}

// Последняя реплика рассказчика в ленте до index включительно.
function lastNarratorBefore(index) {
  for (let i = index; i >= 0; i--) if (state.log[i] && state.log[i].role === 'narrator') return i;
  return -1;
}

// Запасной путь для старых ходов без снимка: переписку собираем из ленты,
// мир остаётся как есть.
function rebuildMessagesFromLog() {
  const keep = state.historyKeep || 20;
  const tail = state.log.slice(-keep);
  state.messages = tail.map((e) =>
    e.role === 'narrator' ? { role: 'assistant', content: e.text, hero: e.hero, with: e.with }
      : e.role === 'ooc' ? { role: 'user', content: oocWrap(e.text), ooc: true, hero: e.hero, with: e.with }
      : { role: 'user', content: e.text, hero: e.hero, with: e.with });
}

// Обрезать историю: всё после index исчезает. Если index — реплика
// рассказчика, мир откатывается к состоянию сразу после неё. Если реплика
// игрока — к состоянию до неё, а сама реплика остаётся «неотправленной»
// (кнопка «Повторить» или редактирование → новый ответ).
export async function truncateLog(index) {
  state.preSync = null;
  const entry = state.log[index];
  if (!entry) throw new Error('Сообщение не найдено.');
  let restored = false;
  const anchor = entry.role === 'narrator' ? index : lastNarratorBefore(index - 1);
  const file = anchor >= 0
    ? await readJson(turnPath(activeSlotId, anchor), null)
    : await readJson(join(turnsDir(activeSlotId), 'base.json'), null);
  const v = file && file.variants[file.current];
  if (v) { applyFullSnapshot(v.snap); restored = true; }
  else if (entry.role !== 'narrator' && anchor < 0) { state.messages = []; state.summary = ''; state.summaries = {}; restored = true; }
  state.log = state.log.slice(0, index + 1);
  if (!restored) rebuildMessagesFromLog();
  if (entry.role !== 'narrator') {
    // Реплика игрока остаётся ждать ответа.
    state.messages.push(entry.role === 'ooc' ? { role: 'user', content: oocWrap(entry.text), ooc: true, hero: entry.hero, with: entry.with } : { role: 'user', content: entry.text, hero: entry.hero, with: entry.with });
    entry.failed = true; entry.error = 'Ответа ещё нет — отправь заново.';
    delete entry.variants; delete entry.variant;
  }
  // Снимок «до хода» для регенерации последней реплики рассказчика.
  if (entry.role === 'narrator') {
    const prev = lastNarratorBefore(index - 1);
    const pf = prev >= 0 ? await readJson(turnPath(activeSlotId, prev), null) : await readJson(join(turnsDir(activeSlotId), 'base.json'), null);
    const pv = pf && pf.variants[pf.current];
    state.lastSnapshot = pv ? deepCopy(pv.snap) : null;
  } else {
    state.lastSnapshot = restored ? captureFullSnapshot() : null;
    if (state.lastSnapshot) { state.lastSnapshot.messages = state.messages.slice(0, -1); }
  }
  await dropTurnFilesAfter(index);
  await saveState();
  return { restored };
}

// Переключить вариант последней реплики рассказчика (свайп).
export async function switchVariant(index, dir) {
  state.preSync = null;
  const entry = state.log[index];
  if (!entry || entry.role !== 'narrator') throw new Error('Варианты есть только у реплик рассказчика.');
  if (index !== state.log.length - 1) throw new Error('Переключать варианты можно только у последней реплики.');
  const file = await readJson(turnPath(activeSlotId, index), null);
  if (!file || file.variants.length < 2) throw new Error('У этой реплики один вариант.');
  const next = Math.max(0, Math.min(file.variants.length - 1, file.current + (dir < 0 ? -1 : 1)));
  if (next === file.current) return state;
  file.current = next;
  const v = file.variants[next];
  applyFullSnapshot(v.snap);
  state.log[index] = { ...v.entry, variants: file.variants.length, variant: next };
  await writeJson(turnPath(activeSlotId, index), file);
  await saveState();
  return state;
}

// Ветка: копия истории, обрезанная до index, становится активной.
export async function branchAt(index) {
  if (!state.log[index]) throw new Error('Сообщение не найдено.');
  const src = slots.find((x) => x.id === activeSlotId);
  await saveState();
  const newId = randomUUID();
  const turnNo = state.log.slice(0, index + 1).filter((e) => e.role === 'player').length;
  slots.push({ id: newId, name: `${src ? src.name : 'История'} ⑂ ${turnNo}`, updatedAt: Date.now() });
  await writeJson(slotPath(newId), slotPayload(state));
  try { await cp(turnsDir(activeSlotId), turnsDir(newId), { recursive: true }); } catch { /* пусто */ }
  activeSlotId = newId;
  await writeJson(INDEX_PATH, { slots, activeSlotId });
  await truncateLog(index);
  return state;
}


export function getState() {
  return state;
}


// ---- Управление героями ----
export async function addCharacter({ name, persona, separate, race, social, appearance } = {}) {
  const c = newCharacter((name || 'Новый герой').trim(), (persona || '').trim());
  // Раньше народ, положение и внешность из формы нового героя терялись — сохранялись только при правке.
  if (typeof race === 'string') c.race = race;
  if (typeof social === 'string') c.social = social;
  if (typeof appearance === 'string') c.appearance = appearance;
  // Новый герой сразу становится активным — прежний запоминает, где остался,
  // иначе после переключения обратно он оказался бы там, где ходил новый.
  const prev = state.characters.find((x) => x.id === state.activeCharacterId);
  switchRelations(state, state.activeCharacterId, c.id); // новый герой ни с кем не знаком
  switchLine(state, state.activeCharacterId, c.id);      // и предыстория у него своя — пока пустая
  if (prev && state.scene) prev.scene = deepCopy(state.scene);
  state.characters.push(c);
  state.activeCharacterId = c.id;
  // «Своя отдельная история»: герой начинает не рядом с прежним — место ещё не задано, часы общие.
  if (separate) {
    c.group = c.id; // своя компания: ни с кем не рядом, своя лента и предыстория
    if (state.scene) state.scene = { ...emptyScene(), day: state.scene.day, minute: state.scene.minute };
  } else if (prev) c.group = prev.group; // спутник нынешнего героя
  await saveState();
  return c;
}

export const HERO_LOCKS = ['appearance', 'social', 'name', 'race'];
export async function updateCharacter(id, { name, persona, race, social, appearance, present, locked, separate } = {}) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) throw new Error('Герой не найден.');
  const before = { appearance: c.appearance, social: c.social, name: c.name, race: c.race };
  if (typeof name === 'string' && name.trim()) c.name = name.trim();
  if (typeof persona === 'string') c.persona = persona;
  if (typeof race === 'string') c.race = race;
  if (typeof social === 'string') c.social = social;
  if (typeof appearance === 'string') { if (appearance.trim() !== (c.appearance || '')) delete c.portraitTags; c.appearance = appearance; }
  if (typeof present === 'boolean') { if (present && c.id !== state.activeCharacterId) joinActive(c); else c.present = present; }
  // «Своя отдельная история»: отделить героя от остальных или вернуть к активному.
  if (typeof separate === 'boolean') {
    const alone = !state.characters.some((x) => x.id !== c.id && groupOf(x) === groupOf(c));
    if (separate && !alone) c.group = c.id;
    else if (!separate && alone && c.id !== state.activeCharacterId) joinActive(c);
  }
  if (Array.isArray(locked)) c.locked = locked.filter((f) => HERO_LOCKS.includes(f));
  noteManual('char', c.id, before, { appearance: c.appearance, social: c.social, name: c.name, race: c.race }); // откатываемые поля героя
  await saveState();
  return c;
}

// Герой присоединяется к активному: та же компания, и он здесь, а не там, где его оставили.
function joinActive(c) {
  const active = state.characters.find((x) => x.id === state.activeCharacterId);
  if (!active || active.id === c.id) return;
  if (groupOf(active) === 'main') delete c.group; else c.group = active.group;
  c.present = true;
  delete c.scene;
}

// Переключить присутствие героя в истории.
export async function toggleCharacterPresence(id, present) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) throw new Error('Герой не найден.');
  // «Рядом» — значит спутник активного героя; герой из другой компании для активного «не рядом».
  const withActive = companionIds(state).includes(c.id);
  c.present = present === undefined ? !withActive : Boolean(present);
  // Активный герой всегда присутствует — иначе играть будет некем.
  if (c.id === state.activeCharacterId) c.present = true;
  // Вернули «в историю» — значит, он теперь здесь, рядом с активным: та же компания, то же место.
  if (c.present && c.id !== state.activeCharacterId) joinActive(c);
  await saveState();
  return c;
}

export async function setCharacterAvatar(id, filename) {
  const c = state.characters.find((x) => x.id === id);
  if (!c) throw new Error('Герой не найден.');
  const previous = c.avatar;
  c.avatar = filename;
  await saveState();
  return { character: c, previous };
}

export async function deleteCharacter(id) {
  if (state.characters.length <= 1) throw new Error('Нельзя удалить последнего героя.');
  state.characters = state.characters.filter((c) => c.id !== id);
  if (state.activeCharacterId === id) {
    state.activeCharacterId = state.characters[0].id;
    switchRelations(state, null, state.activeCharacterId); // отношения удалённого уходят, оставшемуся возвращаются его
    switchLine(state, null, state.activeCharacterId);
  }
  dropRelations(state, id);
  dropLine(state, id);
  await saveState();
}

export async function setActiveCharacter(id) {
  const next = state.characters.find((c) => c.id === id);
  if (next && id !== state.activeCharacterId) {
    const prev = state.characters.find((c) => c.id === state.activeCharacterId);
    // У каждого героя своя сцена: уходя, запоминаем, где был прежний; приходя —
    // возвращаем новому его место, если он был в другом. Часы общие — время идёт для всех.
    // Отношения НПС — тоже у каждого свои (до смены сцены: «кто рядом» — по сцене уходящего).
    switchRelations(state, state.activeCharacterId, id);
    switchLine(state, state.activeCharacterId, id);
    if (prev && state.scene) prev.scene = deepCopy(state.scene);
    const own = next.scene;
    if (own && state.scene && own.location && own.location !== state.scene.location) {
      state.scene = { ...deepCopy(own), day: state.scene.day, minute: state.scene.minute, time: '' };
    }
    state.activeCharacterId = id;
    await saveState();
  } else if (next) {
    state.activeCharacterId = id;
    await saveState();
  }
  return state.characters.find((c) => c.id === state.activeCharacterId) || state.characters[0];
}

// ---- Сброс и настройки ----
export async function resetGame() {
  state.preSync = null;
  state.messages = [];
  state.log = [];
  state.npcs = [];
  state.threads = [];
  state.scene = emptyScene();
  state.events = [];
  state.turn = 0;
  state.summary = '';
  state.summaries = {};
  state.lastSnapshot = null;
  state.manual = {};
  try { await rm(turnsDir(activeSlotId), { recursive: true, force: true }); } catch { /* пусто */ }
  for (const c of state.characters) { c.blocks = []; c.skillXp = {}; c.practiceDays = {}; c.appearanceLog = []; }
  await saveState();
  return state;
}

// ---- Снимок мира для регенерации ----
const deepCopy = (x) => JSON.parse(JSON.stringify(x ?? null));

// Снимок блоков всех героев и списка НПС — до начала хода.
export function captureTurnSnapshot() {
  // Снимок «до хода» — полный, с перепиской и предысторией: регенерация после
  // сжатия истории иначе начинала бы с уже «съеденной» предысторией.
  state.lastSnapshot = captureFullSnapshot();
}

// Общий откат мира к снимку: блоки, опыт, внешность, НПС, нити, лорбук, номер хода.
function applySnapshot(snap, { reconcile = true } = {}) {
  for (const c of state.characters) {
    c.blocks = deepCopy(snap.blocksByChar[c.id] || []);
    const extra = snap.charsByid && snap.charsByid[c.id];
    if (extra) {
      c.skillXp = deepCopy(extra.skillXp || {});
      c.practiceDays = deepCopy(extra.practiceDays || {});
      c.appearanceLog = deepCopy(extra.appearanceLog || []);
      if (extra.appearance !== undefined) c.appearance = extra.appearance;
      if (extra.social !== undefined) c.social = extra.social;
      if (extra.name) c.name = extra.name;
      if (extra.race !== undefined) c.race = extra.race;
      if (extra.aliases) c.aliases = deepCopy(extra.aliases);
    }
  }
  state.npcs = deepCopy(snap.npcs);
  if (snap.threads) state.threads = deepCopy(snap.threads);
  if (snap.scene) state.scene = normalizeScene(deepCopy(snap.scene));
  if (snap.events) state.events = normalizeEvents(deepCopy(snap.events));
  if (snap.lorebook) state.lorebook = deepCopy(snap.lorebook);
  if (typeof snap.turn === 'number') state.turn = snap.turn;
  if ('correctionNote' in snap) state.correctionNote = snap.correctionNote;
  if (reconcile) reconcileRelations(state, snap);
  applyManualOverlay(Number(snap.at) || 0);
}

export function canRegenerate() {
  return Boolean(state.lastSnapshot) && state.log.length > 0 && state.log[state.log.length - 1].role === 'narrator';
}

// Откатывает мир к снимку и убирает последний ход рассказчика из истории и ленты.
// Снимок НЕ удаляется — можно перегенерировать несколько раз с той же точки.
export function rewindLastTurn() {
  state.preSync = null;
  if (!state.lastSnapshot) throw new Error('Нечего перегенерировать.');
  // Реплика игрока, на которую переигрываем ответ.
  let pending = null;
  for (let i = state.messages.length - 1; i >= 0; i--) if (state.messages[i].role === 'user') { pending = state.messages[i]; break; }
  applyFullSnapshot(state.lastSnapshot);

  // Убрать все сообщения после последнего хода игрока (само действие оставляем).
  while (state.messages.length && state.messages[state.messages.length - 1].role !== 'user') {
    state.messages.pop();
  }
  // Снимок мог быть сделан до реплики игрока (после обрезки) — вернуть её.
  const last = state.messages[state.messages.length - 1];
  if (pending && (!last || last.content !== pending.content)) state.messages.push(pending);
  // Убрать последнюю реплику рассказчика из ленты.
  if (state.log.length && state.log[state.log.length - 1].role === 'narrator') state.log.pop();
}

// Ход сорвался: помечаем реплику игрока как неотправленную и откатываем
// побочные эффекты, чтобы её можно было переотправить с той же точки.
export async function markTurnFailed(error) {
  const last = state.log[state.log.length - 1];
  if (last && (last.role === 'player' || last.role === 'ooc')) {
    last.failed = true;
    last.error = String(error || 'Не удалось получить ответ.');
  }
  await saveState();
  return state;
}

// Вернуть мир к снимку, сделанному перед ходом, не трогая историю.
// Нужно при сбое: в одно-проходном режиме инструменты могли сработать
// до того, как запрос упал, и состояние осталось бы полуизменённым.
export function restoreWorldSnapshot() {
  if (!state.lastSnapshot) return;
  applySnapshot(state.lastSnapshot);
}

// Есть ли незавершённый ход, который можно повторить.
export function hasPendingTurn() {
  // Решаем по ленте, а не по messages: при сбое там мог остаться хвост
  // (пустой ответ модели или незавершённый вызов инструмента), и строгая
  // проверка на 'user' ложно запрещала повтор.
  const last = state.log[state.log.length - 1];
  if (!last) return false;
  return last.role === 'player' || last.role === 'ooc';
}

// Убирает хвост неудачного хода: всё, что модель успела вернуть после
// последней реплики игрока. Иначе повтор пойдёт с испорченным контекстом.
export function trimFailedTail() {
  while (state.messages.length && state.messages[state.messages.length - 1].role !== 'user') {
    state.messages.pop();
  }
}

// Снять пометку перед повтором.
export async function clearTurnFailure() {
  const last = state.log[state.log.length - 1];
  if (last) { delete last.failed; delete last.error; }
  await saveState();
}

// Убрать незавершённый ход целиком (когда игрок пишет что-то новое вместо повтора).
export async function dropPendingTurn() {
  if (!hasPendingTurn()) return;
  state.log.pop();
  while (state.messages.length && state.messages[state.messages.length - 1].role !== 'user') state.messages.pop();
  if (state.messages.length) state.messages.pop();
  await saveState();
}

export async function editMessage(index, newText) {
  const entry = state.log[index];
  if (!entry) throw new Error('Сообщение не найдено.');
  const oldText = entry.text;
  const text = String(newText);
  entry.text = text;

  // Сопоставляем по порядковому номеру среди одинаковых текстов, а не по
  // последнему вхождению — иначе правка дубля уходила бы не в ту реплику.
  const wantRole = (entry.role === 'player' || entry.role === 'ooc') ? 'user' : 'assistant';
  let occurrence = 0;
  for (let i = 0; i < index; i++) {
    const e = state.log[i];
    const r = (e.role === 'player' || e.role === 'ooc') ? 'user' : 'assistant';
    if (r === wantRole && e.text === oldText) occurrence++;
  }
  let seen = 0;
  for (const m of state.messages) {
    if (m.role !== wantRole || typeof m.content !== 'string') continue;
    // OOC-сообщения обёрнуты служебным текстом — сверяем по вхождению.
    const matches = m.content === oldText || (m.ooc && m.content.includes(oldText));
    if (!matches) continue;
    if (seen === occurrence) {
      m.content = m.ooc && m.content !== oldText ? m.content.replace(oldText, text) : text;
      break;
    }
    seen++;
  }
  await saveState();
  return state;
}

// ---- Лорбук ----
function normalizeKeys(keys) {
  if (Array.isArray(keys)) return keys.map((k) => String(k).trim()).filter(Boolean);
  if (typeof keys === 'string') return keys.split(',').map((k) => k.trim()).filter(Boolean);
  return [];
}

export async function addLoreEntry({ title, keys, content, always, kind, brief, fields, relations } = {}) {
  const entry = normalizeEntry({
    title: (title || 'Без названия').trim(),
    keys: normalizeKeys(keys),
    content: String(content || ''),
    always: always === true,
    enabled: true,
    author: 'player',
    kind, brief, fields, relations,
  });
  state.lorebook.push(entry);
  noteManual('lore', entry.id, null, entry);
  await saveState();
  return entry;
}

export async function updateLoreEntry(id, { title, keys, content, always, enabled, kind, brief, briefAuto, fields, relations } = {}) {
  const e = state.lorebook.find((x) => x.id === id);
  if (!e) throw new Error('Запись не найдена.');
  const before = deepCopy(e);
  if (typeof title === 'string' && title.trim()) e.title = title.trim();
  // Переименовали общую статью группы магии — разновидности идут за ней (иначе группа распалась бы).
  if (e.title !== before.title) {
    const flat = (t) => String(t || '').trim().toLowerCase().replace(/ё/g, 'е');
    for (const x of state.lorebook) {
      if (x.id === e.id || x.kind !== 'magic' || !x.fields || flat(x.fields.group) !== flat(before.title)) continue;
      const was = deepCopy(x);
      x.fields = { ...x.fields, group: e.title };
      noteManual('lore', x.id, was, x);
    }
  }
  if (keys !== undefined) e.keys = normalizeKeys(keys);
  if (typeof content === 'string') e.content = content;
  if (typeof always === 'boolean') e.always = always;
  if (typeof enabled === 'boolean') e.enabled = enabled;
  if (typeof kind === 'string') e.kind = kind;
  if (typeof brief === 'string') { e.brief = brief; if (briefAuto !== undefined) e.briefAuto = Boolean(briefAuto); else delete e.briefAuto; }
  if (fields && typeof fields === 'object') e.fields = fields;
  if (Array.isArray(relations)) e.relations = relations;
  const idx = state.lorebook.indexOf(e);
  state.lorebook[idx] = normalizeEntry(e);
  noteManual('lore', id, before, state.lorebook[idx]);
  await saveState();
  return state.lorebook[idx];
}

export async function deleteLoreEntry(id) {
  state.lorebook = state.lorebook.filter((e) => e.id !== id);
  noteManual('lore', id, {}, null);
  await saveState();
  return state;
}

// Ручное добавление/правка блока игроком. locked — рассказчик не может
// менять и удалять такой блок через инструменты (но видит его).
const BLOCK_TYPES_MANUAL = ['stat', 'status', 'item', 'ability', 'relationship'];
export async function upsertBlock(characterId, data = {}) {
  const c = state.characters.find((x) => x.id === characterId);
  if (!c) throw new Error('Герой не найден.');
  const name = String(data.name || '').trim();
  if (!name) throw new Error('У блока нужно название.');
  const type = BLOCK_TYPES_MANUAL.includes(data.type) ? data.type : 'status';
  let b = data.id ? c.blocks.find((x) => x.id === data.id) : null;
  const before = b ? deepCopy(b) : null;
  if (!b) {
    b = { id: randomUUID(), type, name };
    if (type === 'status') b.sinceTurn = state.turn || 0;
    c.blocks.push(b);
  }
  b.type = type;
  b.name = name;
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
  if (type === 'stat') {
    b.value = data.value != null && String(data.value).trim() !== '' ? String(data.value).trim() : (b.value ?? '0');
    const max = num(data.max);
    if (max !== undefined) b.max = max; else if (data.max === '' || data.max === null) delete b.max;
  } else if (type === 'status') {
    delete b.value; delete b.max;
    const d = num(data.duration); if (d !== undefined && d > 0) b.duration = d; else delete b.duration;
    const rm = num(data.rollMod); if (rm !== undefined && rm !== 0) b.rollMod = rm; else delete b.rollMod;
    if (data.tick && data.tick.stat && num(data.tick.delta) !== undefined && num(data.tick.delta) !== 0) {
      b.tick = { stat: String(data.tick.stat).trim(), delta: num(data.tick.delta) };
    } else if (data.tick === null || (data.tick && !data.tick.stat)) delete b.tick;
  } else {
    if (typeof data.value === 'string') { const v = data.value.trim(); if (v) b.value = v; else delete b.value; }
    delete b.max;
  }
  if (typeof data.description === 'string') { const d = data.description.trim(); if (d) b.description = d; else delete b.description; }
  if (typeof data.locked === 'boolean') { if (data.locked) b.locked = true; else delete b.locked; }
  // descLocked — закреплено только описание (и имя): учётчик меняет значение, но не описание.
  if (typeof data.descLocked === 'boolean') { if (data.descLocked && !b.locked) b.descLocked = true; else delete b.descLocked; }
  noteManual('block', b.id, before, b, c.id);
  await saveState();
  return b;
}

export async function deleteBlock(characterId, blockId) {
  const c = state.characters.find((x) => x.id === characterId);
  if (!c) throw new Error('Герой не найден.');
  c.blocks = c.blocks.filter((b) => b.id !== blockId);
  noteManual('block', blockId, {}, null, c.id);
  await saveState();
  return c;
}

const NPC_FIELDS = ['name', 'description', 'appearance', 'personality', 'attitude', 'status', 'history', 'wants', 'secret', 'quirk', 'links',
  'voiceStyle', 'voiceHumor', 'voiceHabits', 'voiceMasks', 'voiceTaboos', 'mood', 'moodReason', 'competence', 'race'];
const NPC_ARRAY_FIELDS = ['traits', 'voiceSamples', 'skills'];

// Умелость — только из списка (пусто — не задана), умения — до трёх непустых строк.
function tidyCompetence(n) {
  if (!['обычный', 'профессионал', 'мастер'].includes(n.competence)) delete n.competence;
  if (Array.isArray(n.skills)) { n.skills = n.skills.map((x) => String(x).trim()).filter(Boolean).slice(0, 3); if (!n.skills.length) delete n.skills; }
}

export async function addNpc(data = {}) {
  const npc = { id: randomUUID(), name: (data.name || 'Новый персонаж').trim(), description: '', appearance: '', personality: '', attitude: '', status: '', history: '', wants: '', secret: '', quirk: '', links: '', traits: [], avatar: null, locked: [], updatedTurn: state.turn };
  for (const f of NPC_FIELDS) if (typeof data[f] === 'string') npc[f] = data[f].trim();
  for (const f of NPC_ARRAY_FIELDS) if (Array.isArray(data[f])) npc[f] = data[f].map(String);
  tidyCompetence(npc);
  if (typeof data.bound === 'boolean') npc.bound = data.bound;
  if (data.self === true) npc.self = true;
  if (Array.isArray(data.locked)) npc.locked = data.locked.filter((x) => [...NPC_FIELDS, ...NPC_ARRAY_FIELDS].includes(x));
  state.npcs.push(npc);
  noteManual('npc', npc.id, null, npc);
  await saveState();
  return npc;
}

export async function updateNpcManual(id, data = {}) {
  const n = state.npcs.find((x) => x.id === id);
  if (!n) throw new Error('Персонаж не найден.');
  const before = deepCopy(n);
  if (typeof data.appearance === 'string' && data.appearance.trim() !== (n.appearance || '')) delete n.portraitTags;
  // Переименовали вручную — прежнее имя остаётся псевдонимом для поиска по истории.
  if (typeof data.name === 'string' && data.name.trim() && n.name && data.name.trim() !== n.name) {
    n.aliases = [...new Set([...(n.aliases || []), n.name])].slice(-6);
  }
  for (const f of NPC_FIELDS) if (typeof data[f] === 'string') n[f] = data[f].trim();
  for (const f of NPC_ARRAY_FIELDS) if (Array.isArray(data[f])) n[f] = data[f].map(String);
  tidyCompetence(n);
  if (typeof data.bound === 'boolean') { if (data.bound) n.bound = true; else delete n.bound; }
  if (typeof data.self === 'boolean') { if (data.self) n.self = true; else delete n.self; }
  if (Array.isArray(data.locked)) n.locked = data.locked.filter((x) => [...NPC_FIELDS, ...NPC_ARRAY_FIELDS, 'voice'].includes(x));
  if (!n.name) n.name = 'Без имени';
  noteManual('npc', n.id, before, n);
  await saveState();
  return n;
}

// Дополнить пул черт стандартными, которых в нём ещё нет.
// Существующие черты (в том числе изменённые игроком) остаются нетронутыми.
export async function mergeDefaultTraits() {
  const have = new Set((state.traitPool || []).map((t) => t.label.trim().toLowerCase()));
  const added = [];
  for (const t of DEFAULT_TRAITS) {
    if (have.has(t.label.trim().toLowerCase())) continue;
    state.traitPool.push({ ...t, id: randomUUID() });
    added.push(t.label);
  }
  if (added.length) await saveState();
  return { added, total: state.traitPool.length };
}

export async function upsertThread(data = {}) {
  let t = data.id ? state.threads.find((x) => x.id === data.id) : null;
  const before = t ? deepCopy(t) : null;
  if (!t) {
    t = { id: randomUUID(), title: '', status: 'open', progress: '', notes: '', openedTurn: state.turn || 0 };
    state.threads.push(t);
  }
  if (typeof data.title === 'string' && data.title.trim()) t.title = data.title.trim();
  if (['open', 'done', 'failed'].includes(data.status)) t.status = data.status;
  if (typeof data.progress === 'string') t.progress = data.progress.trim();
  if (typeof data.notes === 'string') t.notes = data.notes.trim();
  if (!t.title) t.title = 'Без названия';
  noteManual('thread', t.id, before, t);
  await saveState();
  return t;
}

// Ручная правка сцены игроком. locked — список полей, которые учётчик не трогает.
export async function updateSceneManual(data = {}) {
  const s = normalizeScene(state.scene);
  const pick = (x) => ({ location: x.location, time: x.time, note: x.note, present: x.present, day: x.day, minute: x.minute, locked: x.locked });
  const before = pick(s);
  if (typeof data.location === 'string') s.location = data.location.trim();
  if (typeof data.time === 'string') s.time = data.time.trim();
  if (typeof data.note === 'string') s.note = data.note.trim();
  if (Array.isArray(data.present)) s.present = data.present.map((x) => String(x).trim()).filter(Boolean);
  else if (typeof data.present === 'string') s.present = data.present.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (data.day !== undefined) s.day = Math.max(1, Number(data.day) || 1);
  if (data.clock !== undefined) {
    const m = String(data.clock).match(/(\d{1,2})[:.](\d{2})/);
    if (m) s.minute = Math.min(1439, Number(m[1]) * 60 + Number(m[2]));
  }
  if (Array.isArray(data.locked)) s.locked = data.locked.filter((f) => ['location', 'time', 'present', 'note', 'clock'].includes(f));
  state.scene = s;
  noteManual('scene', 'scene', before, pick(s));
  await saveState();
  return s;
}

// Хроника вручную.
export async function upsertEvent(data = {}) {
  if (!Array.isArray(state.events)) state.events = [];
  let e = data.id ? state.events.find((x) => x.id === data.id) : null;
  const before = e ? deepCopy(e) : null;
  if (!e) {
    e = { id: randomUUID(), turn: state.turn || 0, type: 'fact', text: '', participants: [], knownBy: [], status: 'open', outcome: '', when: '', at: null, locked: false };
    state.events.push(e);
  }
  if (typeof data.text === 'string' && data.text.trim()) e.text = data.text.trim();
  if (EVENT_TYPES.includes(data.type)) e.type = data.type;
  const list = (v) => Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : null;
  const p = list(data.participants); if (p) e.participants = p.map((x) => String(x).trim()).filter(Boolean);
  const k = list(data.knownBy); if (k) e.knownBy = k.map((x) => String(x).trim()).filter(Boolean);
  // Статус из интерфейса: open | done | broken | past (последние три — закрыто с исходом).
  if (data.status === 'open') { e.status = 'open'; e.outcome = ''; }
  else if (['done', 'broken', 'past'].includes(data.status)) { e.status = 'done'; e.outcome = data.status; }
  if (typeof data.when === 'string' && data.when.trim() !== (e.when || '')) {
    e.when = data.when.trim();
    const sc = state.scene;
    e.at = e.when && sc && Number.isFinite(sc.day) ? { day: sc.day, minute: sc.minute } : null;
  }
  if (typeof data.locked === 'boolean') e.locked = data.locked;
  if (data.turn !== undefined && Number.isFinite(Number(data.turn))) e.turn = Number(data.turn);
  if (!e.text) throw new Error('У записи нужен текст.');
  noteManual('event', e.id, before, e);
  await saveState();
  return e;
}
export async function deleteEvent(id) {
  state.events = (state.events || []).filter((e) => e.id !== id);
  noteManual('event', id, {}, null);
  await saveState();
  return state;
}

export async function deleteThread(id) {
  state.threads = state.threads.filter((t) => t.id !== id);
  noteManual('thread', id, {}, null);
  await saveState();
  return state;
}

export async function updateStatusCatalog(raw) {
  state.statusCatalog = normalizeStatusCatalog(Array.isArray(raw) ? raw : null);
  await saveState();
  return state;
}

export async function updateSeedPool(raw) {
  state.seedPool = normalizeSeeds(raw);
  await saveState();
  return state;
}

export async function updateTraitPool(pool) {
  if (!Array.isArray(pool)) throw new Error('Нужен список черт.');
  state.traitPool = pool
    .filter((t) => t && String(t.label || '').trim())
    .map((t) => ({
      id: t.id || randomUUID(),
      cat: String(t.cat || 'temper'),
      label: String(t.label).trim(),
      hint: String(t.hint || '').trim(),
      ...(t.effect && t.effect.skill
        ? { effect: { skill: String(t.effect.skill).trim(), mod: Number(t.effect.mod) || 0, note: String(t.effect.note || '').trim() } }
        : {}),
    }));
  await saveState();
  return state;
}

export async function setNpcAvatar(id, filename) {
  const n = state.npcs.find((x) => x.id === id);
  if (!n) throw new Error('Персонаж не найден.');
  const previous = n.avatar;
  noteManual('npc', n.id, { avatar: n.avatar }, { avatar: filename });
  n.avatar = filename;
  await saveState();
  return { npc: n, previous };
}

export async function deleteNpc(id) {
  state.npcs = state.npcs.filter((n) => n.id !== id);
  noteManual('npc', id, {}, null);
  await saveState();
  return state;
}

export async function updateSettings({ systemPrompt, worldPrompt, scenarioPrompt, directorNote, difficulty, narration, stateSync, loreAutoWrite, diceEnabled, summary, autoSummarize, historyKeep, model, toolModel, temperature, repetitionPenalty, frequencyPenalty, ...rest } = {}) {
  if (typeof systemPrompt === 'string') state.systemPrompt = systemPrompt;
  if (typeof worldPrompt === 'string') state.worldPrompt = worldPrompt;
  if (typeof directorNote === 'string') state.directorNote = directorNote;
  for (const f of IMAGE_FIELDS) {
    if (rest[f] === undefined) continue;
    const d = DEFAULT_IMAGE_SETTINGS[f];
    if (typeof d === 'boolean') state[f] = rest[f] === true || rest[f] === 'true';
    else if (typeof d === 'number') { const n = Number(rest[f]); state[f] = String(rest[f]).trim() !== '' && Number.isFinite(n) ? n : d; }
    else state[f] = String(rest[f]);
  }
  if (typeof scenarioPrompt === 'string') state.scenarioPrompt = scenarioPrompt;
  if (DIFFICULTIES.includes(difficulty)) state.difficulty = difficulty;
  if (NARRATIONS.includes(narration)) state.narration = narration;
  if (typeof stateSync === 'boolean') state.stateSync = stateSync;
  if (typeof loreAutoWrite === 'boolean') state.loreAutoWrite = loreAutoWrite;
  if (rest.syncPromptStyle === 'legacy' || rest.syncPromptStyle === 'technical') state.syncPromptStyle = rest.syncPromptStyle;
  if (rest.promptLayout === 'classic' || rest.promptLayout === 'cache') state.promptLayout = rest.promptLayout;
  if (rest.clichePhrases !== undefined) { const list = normalizeCliches(rest.clichePhrases); if (list) state.clichePhrases = list; }
  if (typeof diceEnabled === 'boolean') state.diceEnabled = diceEnabled;
  if (typeof summary === 'string') state.summary = summary;
  if (typeof autoSummarize === 'boolean') state.autoSummarize = autoSummarize;
  if (historyKeep !== undefined) {
    const k = Number(historyKeep);
    if (Number.isFinite(k)) state.historyKeep = Math.min(200, Math.max(6, Math.round(k)));
  }
  if (typeof model === 'string' && model.trim()) state.model = model.trim();
  if (typeof toolModel === 'string') state.toolModel = toolModel.trim();
  if (temperature !== undefined) {
    const t = Number(temperature);
    if (Number.isFinite(t)) state.temperature = Math.min(2, Math.max(0, t));
  }
  if (repetitionPenalty !== undefined) {
    const p = Number(repetitionPenalty);
    if (Number.isFinite(p)) state.repetitionPenalty = Math.min(2, Math.max(0, p));
  }
  if (frequencyPenalty !== undefined) {
    const p = Number(frequencyPenalty);
    if (Number.isFinite(p)) state.frequencyPenalty = Math.min(2, Math.max(0, p));
  }
  await saveState();
  return state;
}
