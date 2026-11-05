import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  loadState, saveState, getState, resetGame, updateSettings, importSlot,
  addCharacter, updateCharacter, deleteCharacter, setActiveCharacter, deleteNpc, deleteBlock, upsertBlock, updateSceneManual, toggleCharacterPresence,
  recordTurnOutcome, refreshTurnOutcome, truncateLog, entryContext, setEntryImages,
  clearPreSync, capturePreSync, bindPreSync, canResync, restorePreSync, switchVariant, branchAt, oocWrap, upsertEvent, deleteEvent,
  captureTurnSnapshot, canRegenerate, rewindLastTurn, setCharacterAvatar, editMessage,
  markTurnFailed, hasPendingTurn, clearTurnFailure, dropPendingTurn, trimFailedTail, restoreWorldSnapshot,
  listSlots, createSlot, switchSlot, renameSlot, deleteSlot, duplicateSlot,
  addLoreEntry, updateLoreEntry, deleteLoreEntry, addNpc, updateNpcManual, setNpcAvatar, updateTraitPool, mergeDefaultTraits, updateSeedPool, updateStatusCatalog, upsertThread, deleteThread,
} from './src/state.js';
import { runTurn, afterSync } from './src/turn.js';
import { planSummary, computeSummary, applySummary } from './src/summary.js';
import { composeStorySystem, storyPromptSections } from './src/narrator.js';
import { syncNarration, resyncNarration } from './src/sync.js';
import { replayRequest } from './src/llm.js';
import { portraitTags, sceneTags, codexTags, codexStyle } from './src/art.js';
import { DEFAULT_IMAGE_SETTINGS } from './src/images.js';
import { fillField, writeBrief } from './src/fill.js';
import { CODEX_KINDS, KIND_LABEL, KIND_FIELDS, findPeople } from './src/codex.js';
import { listRequests, getRequest, clearRequests, diagCounts } from './src/diag.js';
import { txt2img, pingSd } from './src/images.js';
import { advanceStatuses } from './src/statuses.js';
import { PUBLIC_DIR, AVATAR_DIR, SCENE_DIR } from './src/paths.js';
import { makeBackup, listBackups, maybeDailyBackup, readBackupSlot } from './src/backup.js';

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json({ limit: '6mb' }));
// Статику не кэшируем: иначе браузер показывает старый app.js после обновления
// и кажется, что правки не приехали.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (/\.(js|css|html)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/avatars', express.static(AVATAR_DIR, { maxAge: '365d', immutable: true }));
app.use('/scenes', express.static(SCENE_DIR, { maxAge: '365d', immutable: true }));

const apiKey = () => process.env.OPENROUTER_API_KEY;

// Публичное состояние для интерфейса (без служебной истории модели).
function publicState() {
  const s = getState();
  return {
    characters: s.characters,
    activeCharacterId: s.activeCharacterId,
    npcs: s.npcs,
    lorebook: s.lorebook,
    codexKinds: { kinds: CODEX_KINDS, labels: KIND_LABEL, fields: KIND_FIELDS },
    // Народ героя и НПС → статья кодекса (то же правило, что и для промта): для ссылок в досье.
    codexLinks: Object.fromEntries([...(s.npcs || []), ...s.characters]
      .map((x) => [x.id, x.race ? findPeople(s.lorebook, x.race) : null]).filter(([, e]) => e).map(([id, e]) => [id, e.id])),
    traitPool: s.traitPool,
    seedPool: s.seedPool,
    statusCatalog: s.statusCatalog,
    threads: s.threads,
    scene: s.scene,
    events: s.events || [],
    turn: s.turn,
    pendingTurn: hasPendingTurn(),
    canResync: canResync(),
    toolModel: s.toolModel || '',
    ...listSlots(),
    log: s.log,
    systemPrompt: s.systemPrompt,
    worldPrompt: s.worldPrompt,
    scenarioPrompt: s.scenarioPrompt,
    directorNote: s.directorNote || '',
    sdUrl: s.sdUrl, imageStyle: s.imageStyle, imageNegative: s.imageNegative, imageSize: s.imageSize,
    imageSteps: s.imageSteps, imageCfg: s.imageCfg, imageSampler: s.imageSampler,
    sceneStyle: s.sceneStyle, sceneNegative: s.sceneNegative, sceneSize: s.sceneSize,
    imageClipSkip: s.imageClipSkip, faceFix: s.faceFix, sceneHires: s.sceneHires, handFix: s.handFix, portraitHires: s.portraitHires, imageScheduler: s.imageScheduler, hiresScale: s.hiresScale, hiresDenoise: s.hiresDenoise, hiresUpscaler: s.hiresUpscaler,
    difficulty: s.difficulty,
    narration: s.narration,
    stateSync: s.stateSync,
    loreAutoWrite: s.loreAutoWrite,
    syncPromptStyle: s.syncPromptStyle || 'technical',
    diceEnabled: s.diceEnabled,
    summary: s.summary,
    compressing: compression.running,
    autoSummarize: s.autoSummarize,
    historyKeep: s.historyKeep,
    model: s.model,
    toolModel: s.toolModel,
    temperature: s.temperature,
    repetitionPenalty: s.repetitionPenalty,
    frequencyPenalty: s.frequencyPenalty,
    hasKey: Boolean(apiKey()),
  };
}

const ok = (res) => res.json(publicState());

// Пока идёт ход, нельзя менять то, на что он опирается: партию, ленту, героев.
// Иначе ответ хода запишется не туда (например, в другую партию).
function whileIdle(_req, res, next) {
  if (turnInFlight) return res.status(409).json({ error: 'Ход уже выполняется — дождись ответа.' });
  next();
}
const fail = (res, err, code = 500) => res.status(code).json({ error: String(err.message || err) });

app.get('/api/state', (_req, res) => ok(res));
// Собранный системный промт рассказчика — как его видит модель на следующем ходу.
app.get('/api/prompt', (_req, res) => {
  const state = getState();
  res.type('text/plain; charset=utf-8').send(composeStorySystem(state, { withTools: state.stateSync === false }));
});

// Из чего состоит запрос рассказчику и сколько весит каждая часть — чтобы видеть, что разрастается.
app.get('/api/prompt/breakdown', (_req, res) => {
  const state = getState();
  const tok = (n) => Math.round(n / 3.2); // русский текст: ~3 символа на токен у DeepSeek/GLM
  const sections = storyPromptSections(state, { withTools: state.stateSync === false })
    .map((s) => ({ label: s.label, chars: s.text.length, tokens: tok(s.text.length) }));
  const msgs = (state.messages || []).filter((m) => typeof m.content === 'string');
  const histChars = msgs.reduce((a, m) => a + m.content.length, 0);
  sections.push({ label: `История дословно (${msgs.length} сообщ.)`, chars: histChars, tokens: tok(histChars), history: true });
  const total = sections.reduce((a, s) => a + s.tokens, 0);
  const live = (state.npcs || []).filter((n) => !n.archived).length;
  res.json({
    total, sections,
    counts: { npcs: live, archived: (state.npcs || []).length - live, events: (state.events || []).length, lore: (state.lorebook || []).length,
      summaryWords: String(state.summary || '').split(/\s+/).filter(Boolean).length, historyKeep: state.historyKeep, turn: state.turn },
  });
});

app.post('/api/settings', async (req, res) => {
  try { await updateSettings(req.body || {}); ok(res); } catch (e) { fail(res, e); }
});

app.post('/api/reset', whileIdle, async (_req, res) => {
  try { await resetGame(); ok(res); } catch (e) { fail(res, e); }
});

// ---- Герои ----
app.post('/api/characters', whileIdle, async (req, res) => {
  try { await addCharacter(req.body || {}); ok(res); } catch (e) { fail(res, e); }
});
app.put('/api/characters/:id', async (req, res) => {
  try { await updateCharacter(req.params.id, req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/characters/:id', whileIdle, async (req, res) => {
  try {
    const doomed = getState().characters.find((c) => c.id === req.params.id);
    const avatar = doomed ? doomed.avatar : null;
    await deleteCharacter(req.params.id);
    await removeAvatarFile(avatar);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});
app.post('/api/characters/:id/presence', async (req, res) => {
  try { await toggleCharacterPresence(req.params.id, req.body?.present); ok(res); } catch (e) { fail(res, e, 400); }
});

app.post('/api/characters/:id/activate', whileIdle, async (req, res) => {
  try { await setActiveCharacter(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});

app.post('/api/npcs', async (req, res) => {
  try { await addNpc(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.put('/api/npcs/:id', async (req, res) => {
  try { await updateNpcManual(req.params.id, req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/npcs/:id', async (req, res) => {
  try { await deleteNpc(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});

app.post('/api/characters/:id/blocks', async (req, res) => {
  try { await upsertBlock(req.params.id, req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/characters/:id/blocks/:blockId', async (req, res) => {
  try { await deleteBlock(req.params.id, req.params.blockId); ok(res); } catch (e) { fail(res, e, 400); }
});

// ---- История как дерево ----
app.post('/api/log/:index/truncate', whileIdle, async (req, res) => {
  try {
    const { restored } = await truncateLog(Number(req.params.index));
    res.json({ ...publicState(), restored });
  } catch (e) { fail(res, e, 400); }
});
app.post('/api/log/:index/swipe', whileIdle, async (req, res) => {
  try { await switchVariant(Number(req.params.index), Number(req.body?.dir) || 1); ok(res); } catch (e) { fail(res, e, 400); }
});
app.post('/api/log/:index/branch', whileIdle, async (req, res) => {
  try { await branchAt(Number(req.params.index)); ok(res); } catch (e) { fail(res, e, 400); }
});

app.put('/api/log/:index', whileIdle, async (req, res) => {
  try {
    await editMessage(Number(req.params.index), String(req.body?.text ?? ''));
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

app.post('/api/traits/merge', async (_req, res) => {
  try {
    const result = await mergeDefaultTraits();
    res.json({ ...publicState(), merged: result });
  } catch (e) { fail(res, e, 400); }
});

app.put('/api/scene', async (req, res) => {
  try { await updateSceneManual(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});

// ---- Диагностика запросов к модели ----
app.get('/api/diag', async (req, res) => {
  try { res.json({ items: await listRequests(), counts: await diagCounts(req.query.since) }); } catch (e) { fail(res, e); }
});
app.get('/api/diag/counts', async (req, res) => {
  try { res.json(await diagCounts(req.query.since)); } catch (e) { fail(res, e); }
});
app.get('/api/diag/:id', async (req, res) => {
  try {
    const r = await getRequest(req.params.id);
    if (!r) return res.status(404).json({ error: 'Запись не найдена.' });
    res.json(r);
  } catch (e) { fail(res, e); }
});
app.delete('/api/diag', async (req, res) => {
  try { await clearRequests(); res.json({ items: [] }); } catch (e) { fail(res, e); }
});
app.post('/api/diag/:id/replay', async (req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  try { res.json({ summary: await replayRequest({ id: req.params.id, model: (req.body || {}).model, apiKey: apiKey() }) }); }
  catch (e) { fail(res, e, 400); }
});

app.post('/api/events', async (req, res) => {
  try { await upsertEvent(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/events/:id', async (req, res) => {
  try { await deleteEvent(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});

app.post('/api/threads', async (req, res) => {
  try { await upsertThread(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/threads/:id', async (req, res) => {
  try { await deleteThread(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});

app.put('/api/statuses', async (req, res) => {
  try { await updateStatusCatalog(req.body?.catalog); ok(res); } catch (e) { fail(res, e, 400); }
});

app.put('/api/seeds', async (req, res) => {
  try { await updateSeedPool(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});

app.put('/api/traits', async (req, res) => {
  try { await updateTraitPool(req.body?.pool); ok(res); } catch (e) { fail(res, e, 400); }
});

// ---- Истории (слоты сохранений) ----
app.get('/api/slots', (_req, res) => res.json(listSlots()));

app.post('/api/slots', whileIdle, async (req, res) => {
  try { await createSlot(req.body?.name); ok(res); } catch (e) { fail(res, e, 400); }
});
app.post('/api/slots/:id/activate', whileIdle, async (req, res) => {
  try { await switchSlot(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});
app.put('/api/slots/:id', async (req, res) => {
  try { await renameSlot(req.params.id, req.body?.name); ok(res); } catch (e) { fail(res, e, 400); }
});
app.post('/api/slots/:id/duplicate', async (req, res) => {
  try { await duplicateSlot(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/slots/:id', whileIdle, async (req, res) => {
  try { await deleteSlot(req.params.id); ok(res); } catch (e) { fail(res, e, 400); }
});

// ---- Резервные копии ----
app.get('/api/backups', async (_req, res) => {
  try { res.json({ items: await listBackups() }); } catch (e) { fail(res, e); }
});
app.post('/api/backups', whileIdle, async (_req, res) => {
  try { await saveState(); const b = await makeBackup('вручную'); res.json({ backup: b, items: await listBackups() }); } catch (e) { fail(res, e); }
});
// Восстановить партию из копии — новой историей рядом с текущими.
app.post('/api/backups/:id/restore', whileIdle, async (req, res) => {
  try {
    const slotId = String(req.body?.slotId || '');
    const b = (await listBackups()).find((x) => x.id === req.params.id);
    const meta = b && b.slots.find((x) => x.id === slotId);
    if (!meta) throw new Error('Копия не найдена.');
    const raw = await readBackupSlot(b.id, slotId);
    await importSlot(raw, `${meta.name} (копия от ${b.label})`);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

// ---- ✨ Выжимки кодекса ----
// Одна статья (из формы редактора, не сохраняется — игрок посмотрит и сохранит сам).
app.post('/api/lore/brief', async (req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  try { res.json({ brief: await writeBrief({ state: getState(), apiKey: apiKey(), entry: req.body?.entry }) }); }
  catch (e) { fail(res, e, 502); }
});
// Всем статьям без выжимки — по очереди, сразу с сохранением (помечаются как написанные ✨).
app.post('/api/lore/briefs', whileIdle, async (_req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  const state = getState();
  const todo = (state.lorebook || []).filter((e) => !String(e.brief || '').trim() && (String(e.content || '').trim() || Object.keys(e.fields || {}).length));
  let done = 0; const failed = [];
  for (const e of todo) {
    try { await updateLoreEntry(e.id, { brief: await writeBrief({ state, apiKey: apiKey(), entry: e }), briefAuto: true }); done++; }
    catch (err) { failed.push(`${e.title}: ${String(err.message || err).slice(0, 120)}`); }
  }
  res.json({ ...publicState(), briefs: { done, failed } });
});

// ---- Лорбук ----
app.post('/api/lore', async (req, res) => {
  try { await addLoreEntry(req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.put('/api/lore/:id', async (req, res) => {
  try { await updateLoreEntry(req.params.id, req.body || {}); ok(res); } catch (e) { fail(res, e, 400); }
});
app.delete('/api/lore/:id', async (req, res) => {
  try {
    const img = (getState().lorebook.find((x) => x.id === req.params.id) || {}).image;
    await deleteLoreEntry(req.params.id);
    await removeAvatarFile(img);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

// ---- Аватар героя ----
const AVATAR_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function removeAvatarFile(filename) {
  if (!filename) return;
  try { await unlink(join(AVATAR_DIR, filename)); } catch { /* уже нет — не страшно */ }
}

app.post('/api/characters/:id/avatar', async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Нужен PNG, JPEG или WebP.');

    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new Error('Картинка слишком большая.');

    await mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${randomUUID()}.${AVATAR_EXT[m[1]]}`;
    await writeFile(join(AVATAR_DIR, filename), buf);

    const { previous } = await setCharacterAvatar(req.params.id, filename);
    await removeAvatarFile(previous);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

app.post('/api/npcs/:id/avatar', async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Нужен PNG, JPEG или WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new Error('Картинка слишком большая.');
    await mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${randomUUID()}.${AVATAR_EXT[m[1]]}`;
    await writeFile(join(AVATAR_DIR, filename), buf);
    const { previous } = await setNpcAvatar(req.params.id, filename);
    await removeAvatarFile(previous);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

// ---- Портреты через локальный A1111 ----
app.get('/api/images/ping', async (_req, res) => {
  try { res.json(await pingSd(getState().sdUrl || 'http://127.0.0.1:7860')); } catch (e) { fail(res, e, 502); }
});

async function generatePortrait(res, subject, assign) {
  const state = getState();
  const tags = String(subject.tagsOverride || '').trim() || await portraitTags({ state, apiKey: apiKey(), subject });
  const { png, prompt, warnings } = await txt2img(state, tags);
  await mkdir(AVATAR_DIR, { recursive: true });
  const filename = `${randomUUID()}.png`;
  await writeFile(join(AVATAR_DIR, filename), png);
  const { previous } = await assign(filename);
  await removeAvatarFile(previous);
  subject.ref.portraitTags = tags; // чтобы можно было поправить и перерисовать
  await saveState();
  res.json({ ...publicState(), portrait: { filename, tags, prompt, warnings } });
}

// ---- Иллюстрация статьи кодекса ----
// Теги — из поля (игрок поправил) или модель составляет по статье; рисует A1111 портретным кадром.
async function setLoreImage(id, filename, tags) {
  const e = getState().lorebook.find((x) => x.id === id);
  if (!e) throw new Error('Статья не найдена.');
  const previous = e.image;
  if (filename) e.image = filename; else delete e.image;
  if (tags !== undefined) e.imageTags = tags;
  await saveState();
  if (previous && previous !== filename) await removeAvatarFile(previous);
}
app.post('/api/lore/:id/illustrate', async (req, res) => {
  try {
    const state = getState();
    const e = state.lorebook.find((x) => x.id === req.params.id);
    if (!e) throw new Error('Статья не найдена.');
    let tags = String(req.body?.tags || '').trim();
    if (!tags) {
      if (!apiKey()) throw new Error('Не задан OPENROUTER_API_KEY — впиши теги вручную или добавь ключ.');
      tags = await codexTags({ state, apiKey: apiKey(), entry: e });
    }
    const style = codexStyle(state.imageStyle || DEFAULT_IMAGE_SETTINGS.imageStyle) + ', full body, detailed background';
    const { png, prompt, warnings } = await txt2img({ ...state, imageStyle: style }, tags, { seed: req.body?.seed });
    const still = getState().lorebook.find((x) => x.id === e.id);
    if (!still) throw new Error('Пока рисовалась картинка, статью удалили.');
    await mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${randomUUID()}.png`;
    await writeFile(join(AVATAR_DIR, filename), png);
    await setLoreImage(e.id, filename, tags);
    res.json({ ...publicState(), illustration: { filename, tags, prompt, warnings } });
  } catch (err) { fail(res, err, 502); }
});
app.post('/api/lore/:id/image', async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Нужен PNG, JPEG или WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw new Error('Картинка слишком большая.');
    if (!getState().lorebook.some((x) => x.id === req.params.id)) throw new Error('Статья не найдена.');
    await mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${randomUUID()}.${AVATAR_EXT[m[1]]}`;
    await writeFile(join(AVATAR_DIR, filename), buf);
    await setLoreImage(req.params.id, filename);
    ok(res);
  } catch (err) { fail(res, err, 400); }
});
app.delete('/api/lore/:id/image', async (req, res) => {
  try { await setLoreImage(req.params.id, null); ok(res); } catch (err) { fail(res, err, 400); }
});

// ---- Заполнить поле карточки по истории (✨) ----
// card — то, что сейчас в форме (с несохранёнными правками); ничего не сохраняем.
app.post('/api/fill', async (req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  try {
    const { kind, id, field, mode, card } = req.body || {};
    const state = getState();
    const merged = { ...(card || {}) };
    if (kind === 'npc' && id) {
      const n = (state.npcs || []).find((x) => x.id === id);
      if (n) { merged.aliases = n.aliases || []; if (!merged.name) merged.name = n.name; }
    } else if (kind === 'hero' && id) {
      const c = state.characters.find((x) => x.id === id);
      if (c && !merged.name) merged.name = c.name;
    }
    res.json(await fillField({ state, apiKey: apiKey(), kind: kind === 'hero' ? 'hero' : 'npc', field: String(field || ''), mode, card: merged }));
  } catch (e) { fail(res, e, 502); }
});

// ---- Иллюстрации сцен ----
const MAX_SCENE_IMAGES = 8; // на одну реплику
const entryIndex = (req) => {
  const i = Number(req.params.index);
  if (!Number.isInteger(i) || !getState().log[i]) throw new Error('Сообщение не найдено.');
  return i;
};
// Шаг 1: описание кадра (теги) — показывается игроку для правки.
app.post('/api/log/:index/scene-prompt', async (req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  try {
    const ctx = await entryContext(entryIndex(req));
    res.json(await sceneTags({ state: getState(), apiKey: apiKey(), ctx }));
  } catch (e) { fail(res, e, 502); }
});
// Шаг 2: рисуем. Реплика могла смениться за время генерации (регенерация, правка) — тогда не прикрепляем.
app.post('/api/log/:index/illustrate', async (req, res) => {
  try {
    const index = entryIndex(req);
    const state = getState();
    const entry = state.log[index];
    if (entry.role !== 'narrator') throw new Error('Иллюстрировать можно только реплику рассказчика.');
    const tags = String(req.body?.tags || '').trim();
    if (!tags) throw new Error('Пустое описание кадра.');
    const textBefore = entry.text;
    const { png, prompt, seed, width, height, warnings, hires, faceFix } = await txt2img(state, tags, { kind: 'scene', seed: req.body?.seed });
    const now = getState().log[index];
    if (!now || now.text !== textBefore) throw new Error('Пока рисовалась картинка, реплика изменилась — картинка не прикреплена.');
    await mkdir(SCENE_DIR, { recursive: true });
    const file = `${randomUUID()}.png`;
    await writeFile(join(SCENE_DIR, file), png);
    const image = { file, tags, prompt, seed, width, height, hires, faceFix, moment: String(req.body?.moment || '').slice(0, 300), at: Date.now() };
    const images = [...(now.images || []), image].slice(-MAX_SCENE_IMAGES);
    await setEntryImages(index, images);
    res.json({ ...publicState(), image, index, warnings });
  } catch (e) { fail(res, e, 502); }
});
// Убрать картинку из реплики. Файл не удаляем: его может держать ветка истории или другой вариант.
app.delete('/api/log/:index/images/:n', async (req, res) => {
  try {
    const index = entryIndex(req);
    const images = [...(getState().log[index].images || [])];
    const n = Number(req.params.n);
    if (!images[n]) throw new Error('Картинка не найдена.');
    images.splice(n, 1);
    await setEntryImages(index, images);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

app.post('/api/npcs/:id/portrait', async (req, res) => {
  try {
    const n = getState().npcs.find((x) => x.id === req.params.id);
    if (!n) throw new Error('Персонаж не найден.');
    await generatePortrait(res, { ...n, ref: n, kind: 'npc', tagsOverride: req.body?.tags }, (f) => setNpcAvatar(n.id, f));
  } catch (e) { fail(res, e, 502); }
});
app.post('/api/characters/:id/portrait', async (req, res) => {
  try {
    const c = getState().characters.find((x) => x.id === req.params.id);
    if (!c) throw new Error('Герой не найден.');
    await generatePortrait(res, { ...c, ref: c, kind: 'hero', tagsOverride: req.body?.tags }, (f) => setCharacterAvatar(c.id, f));
  } catch (e) { fail(res, e, 502); }
});

app.delete('/api/npcs/:id/avatar', async (req, res) => {
  try {
    const { previous } = await setNpcAvatar(req.params.id, null);
    await removeAvatarFile(previous);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

app.delete('/api/characters/:id/avatar', async (req, res) => {
  try {
    const { previous } = await setCharacterAvatar(req.params.id, null);
    await removeAvatarFile(previous);
    ok(res);
  } catch (e) { fail(res, e, 400); }
});

// ---- Ход игры ----
app.post('/api/action', async (req, res) => {
  if (!apiKey()) {
    return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY. Скопируй .env.example в .env и впиши ключ.' });
  }

  const state = getState();
  const text = (req.body?.text || '').trim();

  // Игрок пишет новое вместо повтора — убираем незавершённый ход,
  // иначе в истории окажутся две реплики игрока подряд.
  await dropPendingTurn();

  if (state.messages.length === 0 && !text) {
    state.messages.push({
      role: 'user',
      content: 'Начни игру: задай вступительную сцену и создай стартовые блоки для героев.',
    });
  } else {
    // hero — за кого сделан ход: после переключения рассказчик не должен путать, с кем что было.
    state.messages.push({ role: 'user', content: text || 'Продолжай.', hero: state.activeCharacterId });
    if (text) state.log.push({ role: 'player', text, hero: state.activeCharacterId });
  }

  await runPlayerTurn(state, res);
});

// Общий прогон хода: при сбое помечает реплику игрока как неотправленную,
// чтобы её можно было повторить, и сообщает причину.
// Один ход за раз: вторая вкладка или переключение слота во время запроса
// не должны править то же состояние параллельно.
let turnInFlight = false;

// ---- Сжатие истории в фоне ----
// Ход отвечает игроку сразу; предыстория досчитывается потом. Применяем результат,
// только когда никакой ход не идёт и история не поменялась (см. applySummary).
const compression = { running: false, startedAt: 0, lastError: '', lastMs: 0, lastAt: 0 };
function scheduleCompression() {
  if (compression.running || !apiKey()) return;
  const plan = planSummary(getState());
  if (!plan) return;
  compression.running = true; compression.startedAt = Date.now();
  (async () => {
    try {
      const text = await computeSummary(plan, apiKey());
      // Дождаться окна без хода (не дольше 5 минут).
      for (let i = 0; turnInFlight && i < 600; i++) await new Promise((r) => setTimeout(r, 500));
      if (!turnInFlight && applySummary(plan, text, getState())) {
        await saveState();
        compression.lastError = '';
      } else compression.lastError = 'история изменилась, пока шло сжатие — повторится позже';
    } catch (e) {
      compression.lastError = String(e.message || e).slice(0, 300);
      console.warn('[сжатие]', compression.lastError);
    } finally {
      compression.lastMs = Date.now() - compression.startedAt; compression.lastAt = Date.now();
      compression.running = false;
    }
  })();
}

function lockTurn(res) {
  if (turnInFlight) {
    res.status(409).json({ error: 'Ход уже выполняется — дождись ответа.' });
    return false;
  }
  turnInFlight = true;
  return true;
}

async function runPlayerTurn(state, res, { ooc = false, regen = false } = {}) {
  if (!lockTurn(res)) return;
  const turnStart = Date.now();
  // При регенерации снимок уже есть и мир к нему откачен — не перезаписываем.
  if (!regen) captureTurnSnapshot();
  let ticks = [];
  if (!ooc) {
    state.turn = (state.turn || 0) + 1;
    // Время идёт: яд действует, усталость проходит. Рассказчик узнаёт об этом
    // заметкой и вплетает в текст.
    ticks = advanceStatuses(state);
    state.tickNote = ticks.length
      ? '[За прошедшее время: ' + ticks.join('; ') + '. Отрази это в повествовании.]'
      : undefined;
  }
  state._growth = [];
  try {
    clearPreSync();
    const { narration, rolls, issues, truncated, sync, timing } = await runTurn({ state, apiKey: apiKey(), skipSync: ooc, beforeSync: capturePreSync });
    const growth = state._growth || [];
    if (ooc) {
      // Ответ на реплику вне истории не должен попасть в предысторию.
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'assistant') { state.messages[i].ooc = true; break; }
      }
    }
    const entry = {
      role: 'narrator', text: narration, hero: state.activeCharacterId,
      timing: { narrate: (timing && timing.narrate) || [] },
      sync: sync || undefined,
      rolls: rolls && rolls.length ? rolls : undefined,
      issues: issues && issues.length ? issues : undefined,
      truncated: truncated || undefined,
      ticks: ticks.length ? ticks : undefined,
      growth: growth.length ? growth : undefined,
    };
    state.log.push(entry);
    bindPreSync(state.log.length - 1);
    entry.timing.totalMs = Date.now() - turnStart;
    try { await recordTurnOutcome(); } catch { /* снимок хода не критичен */ }
    await saveState();
    // Полное состояние, а не выборка: иначе интерфейс не узнаёт о сцене,
    // справочнике мира и прочем, что могло измениться за ход.
    res.json({ ...publicState(), narration });
    turnInFlight = false;
    if (!ooc) scheduleCompression();
  } catch (err) {
    const message = String(err.message || err);
    restoreWorldSnapshot(); // возвращает и номер хода
    await markTurnFailed(message);
    res.status(502).json({ error: message, log: state.log, pendingTurn: true });
  } finally {
    turnInFlight = false;
  }
}

// Повторить сорвавшийся ход.
app.post('/api/retry', async (_req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  const state = getState();
  if (!hasPendingTurn()) return res.status(400).json({ error: 'Нечего повторять.' });
  trimFailedTail();          // выбросить недоделанный ответ прошлой попытки
  await clearTurnFailure();
  const last = state.log[state.log.length - 1];
  await runPlayerTurn(state, res, { ooc: last && last.role === 'ooc' });
});

// ---- Сообщение рассказчику вне истории (OOC) ----
app.post('/api/ooc', async (req, res) => {
  if (!apiKey()) {
    return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  }
  const state = getState();
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустое сообщение.' });
  await dropPendingTurn();

  const wrapped = oocWrap(text);

  state.messages.push({ role: 'user', content: wrapped, ooc: true });
  state.log.push({ role: 'ooc', text });
  await runPlayerTurn(state, res, { ooc: true });
});

// Договорить оборванный ответ: добавляем скрытую просьбу продолжить.
app.post('/api/continue', async (_req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  const state = getState();
  const last = state.log[state.log.length - 1];
  if (!last || last.role !== 'narrator') return res.status(400).json({ error: 'Нечего продолжать.' });

  if (!lockTurn(res)) return;
  state.messages.push({ role: 'user', content: 'Продолжи ровно с того места, где оборвалось. Не повторяй уже написанное.', ooc: true });
  try {
    const contStart = Date.now();
    const { narration, timing } = await runTurn({ state, apiKey: apiKey(), skipSync: true });
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') { state.messages[i].ooc = true; break; }
    }
    last.text = last.text + (/[.!?…»"]$/.test(last.text.trim()) ? '\n\n' : ' ') + narration;
    delete last.truncated;
    // Дописанный кусок тоже проходит учёт: там мог появиться предмет или рана.
    const extra = await syncNarration({ state, apiKey: apiKey(), narration, force: true });
    if (extra.calls.length || extra.status === 'failed') {
      const prev = last.sync || { status: 'done', calls: [] };
      last.sync = {
        status: extra.status === 'failed' ? 'failed' : (prev.status === 'skipped' ? 'done' : prev.status),
        error: extra.error || prev.error,
        calls: [...(prev.calls || []), ...extra.calls.map((c) => ({ ...c, cont: true }))],
        model: prev.model,
        timing: [...(prev.timing || []), ...(extra.timing || []).map((t) => ({ ...t, cont: true }))],
      };
    }
    last.timing = last.timing || { narrate: [] };
    last.timing.narrate = [...(last.timing.narrate || []), ...((timing && timing.narrate) || []).map((t) => ({ ...t, cont: true }))];
    last.timing.totalMs = (last.timing.totalMs || 0) + (Date.now() - contStart);
    try { await refreshTurnOutcome(); } catch { /* снимок не критичен */ }
    await saveState();
    res.json({ ...publicState(), narration });
  } catch (err) {
    await saveState();
    fail(res, err, 502);
  } finally {
    turnInFlight = false;
  }
});

// ---- Переучесть последний ход (по желанию — другой моделью) ----
app.post('/api/resync', async (req, res) => {
  if (!apiKey()) return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  if (!lockTurn(res)) return;
  const state = getState();
  try {
    if (!canResync()) {
      return res.status(400).json({ error: 'Переучесть можно только последний ход и только сыгранный после обновления (до обрезки или свайпа).' });
    }
    const last = state.log[state.log.length - 1];
    restorePreSync();
    const model = String(req.body?.model || '').trim();
    const sync = await resyncNarration({ state, apiKey: apiKey(), narration: last.text, model });
    const { issues } = afterSync(state, last.text, last.rolls || []);
    // Прежний учёт оставляем рядом — для сравнения моделей.
    if (last.sync) last.syncHistory = [...(last.syncHistory || []), last.sync].slice(-4);
    last.sync = sync;
    last.issues = issues.length ? issues : undefined;
    try { await refreshTurnOutcome(); } catch { /* снимок не критичен */ }
    await saveState();
    res.json(publicState());
  } catch (err) {
    await saveState();
    fail(res, err, 502);
  } finally {
    turnInFlight = false;
  }
});

// ---- Регенерация последнего хода рассказчика ----
app.post('/api/regenerate', async (_req, res) => {
  if (!apiKey()) {
    return res.status(400).json({ error: 'Не задан OPENROUTER_API_KEY.' });
  }
  const state = getState();
  if (turnInFlight) return res.status(409).json({ error: 'Ход уже выполняется — дождись ответа.' });
  if (!canRegenerate()) {
    return res.status(400).json({ error: 'Нечего перегенерировать.' });
  }
  try {
    rewindLastTurn(); // мир, опыт, лорбук и номер хода — к точке до хода
    const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
    const ooc = Boolean(lastUser && lastUser.ooc);
    // Тот же путь, что и обычный ход: снова идёт время, тикают статусы, ведётся учёт.
    await runPlayerTurn(state, res, { ooc, regen: true });
  } catch (err) {
    await saveState();
    fail(res, err, 502);
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* откроют руками */ }
}

await loadState();
// Раз в сутки при запуске — копия всех партий (data/backups, последние 10).
try { const b = await maybeDailyBackup(); if (b) console.log(`  Резервная копия партий: data/backups/${b.id}`); }
catch (e) { console.warn('  Не удалось сделать резервную копию:', e.message); }
app.listen(PORT, () => {
  console.log(`\n  ИИ-рассказчик запущен: http://localhost:${PORT}`);
  // Запуск двойным щелчком (Запуск.bat) — сразу открыть игру в браузере.
  if (process.env.OPEN_BROWSER === '1') openBrowser(`http://localhost:${PORT}`);
  console.log(apiKey() ? '' : '  ⚠  OPENROUTER_API_KEY не задан — создай .env из .env.example.\n');
});
