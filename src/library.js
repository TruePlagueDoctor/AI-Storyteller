// Библиотека персонажей — общая для всех историй (data/library.json): понравившегося героя или НПС сохраняют сюда
// и берут в любую историю КОПИЕЙ. Связи с библиотекой у копии нет: учётчик одной истории не должен переписывать
// персонажа в остальных. В библиотеку идёт только постоянное (кто это, внешность, характер, голос, желания, тайна,
// умения, портрет); привязанное к истории — отношение к герою, «что между ними было», где он сейчас, настроение —
// остаётся в истории. Герой и НПС взаимозаменяемы: НПС можно взять героем и наоборот.
import { readFile, writeFile, rename, mkdir, copyFile, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, AVATAR_DIR } from './paths.js';
import { getState, addNpc, setNpcAvatar, addCharacter, setCharacterAvatar, upsertBlock } from './state.js';

const LIBRARY_PATH = join(DATA_DIR, 'library.json');
export const FILE_FORMAT = 'chronicle-character';
const TEXT = ['race', 'appearance', 'description', 'personality', 'wants', 'secret', 'quirk', 'links', 'social',
  'voiceStyle', 'voiceHumor', 'voiceHabits', 'voiceMasks', 'voiceTaboos', 'competence', 'portraitTags'];
const LISTS = ['traits', 'voiceSamples', 'skills'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();
export class LibraryError extends Error { constructor(message, code = 400, extra = {}) { super(message); this.code = code; Object.assign(this, extra); } }

async function readAll() {
  try { const raw = JSON.parse(await readFile(LIBRARY_PATH, 'utf8')); return Array.isArray(raw.items) ? raw.items : []; }
  catch { return []; }
}
async function writeAll(items) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${LIBRARY_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify({ items }, null, 2), 'utf8');
  await rename(tmp, LIBRARY_PATH);
}
export async function listLibrary() {
  return (await readAll()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

// Портреты библиотеки — отдельные копии файлов: удалили портрет в истории — библиотечный цел, и наоборот.
async function copyAvatar(filename) {
  if (!filename) return null;
  const ext = extname(filename) || '.png';
  const copy = `${randomUUID()}${ext}`;
  try { await mkdir(AVATAR_DIR, { recursive: true }); await copyFile(join(AVATAR_DIR, filename), join(AVATAR_DIR, copy)); return copy; }
  catch { return null; }
}
const dropAvatar = async (filename) => { if (filename) { try { await unlink(join(AVATAR_DIR, filename)); } catch { /* уже нет */ } } };

// Карточка библиотеки — общая для героя и НПС: у героя «кто это» берётся из его описания (persona).
function cardOf(kind, src) {
  const card = {};
  for (const k of TEXT) if (str(src[k])) card[k] = str(src[k]);
  for (const k of LISTS) if (Array.isArray(src[k]) && src[k].length) card[k] = src[k].map((x) => str(x, 300)).filter(Boolean);
  if (kind === 'hero' && str(src.persona)) card.description = str(src.persona);
  if (kind === 'npc' && src.self) card.self = true;
  return card;
}
const abilitiesOf = (src) => (src.blocks || []).filter((b) => b.type === 'ability' && str(b.name))
  .map((b) => ({ name: str(b.name, 80), value: str(b.value, 40), description: str(b.description, 400) || undefined }));

// Сохранить персонажа из текущей истории. Запись с тем же именем обновляется, а не появляется вторая.
export async function saveToLibrary({ kind, id }) {
  const state = getState();
  const src = kind === 'hero' ? state.characters.find((c) => c.id === id) : (state.npcs || []).find((n) => n.id === id);
  if (!src) throw new LibraryError(kind === 'hero' ? 'Герой не найден.' : 'Персонаж не найден.', 404);
  const items = await readAll();
  const old = items.find((x) => same(x.name, src.name));
  const entry = {
    id: old ? old.id : randomUUID(),
    name: str(src.name, 80) || 'Без имени',
    from: kind === 'hero' ? 'hero' : 'npc',
    savedAt: Date.now(),
    card: cardOf(kind, src),
    abilities: kind === 'hero' ? abilitiesOf(src) : [],
    avatar: await copyAvatar(src.avatar),
  };
  if (old) { await dropAvatar(old.avatar); items[items.indexOf(old)] = entry; } else items.push(entry);
  await writeAll(items);
  return { entry, updated: Boolean(old) };
}

// Описание героя из карточки НПС: кто это, характер, желание — одним текстом (у героя одно поле описания).
function personaOf(card) {
  return [card.description, card.personality ? `Характер: ${card.personality}` : '', card.quirk ? `Изюминка: ${card.quirk}` : '', card.wants ? `Хочет: ${card.wants}` : '']
    .filter(Boolean).join('\n');
}

// Взять персонажа в текущую историю копией: героем или НПС. force — добавить, даже если такое имя уже есть.
export async function importFromLibrary(entryId, { as = 'npc', separate = false, force = false } = {}) {
  const entry = (await readAll()).find((x) => x.id === entryId);
  if (!entry) throw new LibraryError('В библиотеке нет такого персонажа.', 404);
  const state = getState();
  const taken = [...state.characters, ...(state.npcs || []).filter((n) => !n.archived)].some((x) => same(x.name, entry.name));
  if (taken && !force) throw new LibraryError(`В этой истории уже есть «${entry.name}».`, 409, { duplicate: true });
  const card = entry.card || {};
  const avatar = await copyAvatar(entry.avatar);
  if (as === 'hero') {
    const hero = await addCharacter({ name: entry.name, persona: personaOf(card), race: card.race, social: card.social, appearance: card.appearance, separate });
    // Умения: свои (если был героем) плюс умения из карточки НПС.
    const seen = new Set();
    for (const a of [...(entry.abilities || []), ...(card.skills || []).map((name) => ({ name, value: '' }))]) {
      if (!str(a.name) || seen.has(str(a.name).toLowerCase())) continue;
      seen.add(str(a.name).toLowerCase());
      await upsertBlock(hero.id, { type: 'ability', name: a.name, value: a.value || '', description: a.description || '' });
    }
    if (avatar) await setCharacterAvatar(hero.id, avatar);
    if (card.portraitTags) hero.portraitTags = card.portraitTags;
    return { as: 'hero', id: hero.id, name: hero.name };
  }
  const data = { name: entry.name, self: card.self === true };
  for (const k of TEXT) if (k !== 'social' && k !== 'portraitTags' && card[k]) data[k] = card[k];
  for (const k of LISTS) if (card[k]) data[k] = card[k];
  // Бывший герой как НПС: его положение — в описание, умения героя — в умения НПС (их не больше трёх).
  if (card.social) data.description = [data.description, `Положение: ${card.social}`].filter(Boolean).join('\n');
  const skills = [...new Set([...(data.skills || []), ...(entry.abilities || []).map((a) => a.name)])].slice(0, 3);
  if (skills.length) data.skills = skills;
  const npc = await addNpc(data);
  if (avatar) await setNpcAvatar(npc.id, avatar);
  if (card.portraitTags) npc.portraitTags = card.portraitTags;
  return { as: 'npc', id: npc.id, name: npc.name };
}

export async function removeFromLibrary(entryId) {
  const items = await readAll();
  const entry = items.find((x) => x.id === entryId);
  if (!entry) throw new LibraryError('В библиотеке нет такого персонажа.', 404);
  await dropAvatar(entry.avatar);
  await writeAll(items.filter((x) => x.id !== entryId));
}

// Файл персонажа: карточка и портрет внутри — для резервной копии или чтобы поделиться.
export async function exportEntry(entryId) {
  const entry = (await readAll()).find((x) => x.id === entryId);
  if (!entry) throw new LibraryError('В библиотеке нет такого персонажа.', 404);
  let avatarData = null;
  if (entry.avatar) {
    try { avatarData = `data:${MIME[extname(entry.avatar).toLowerCase()] || 'image/png'};base64,` + (await readFile(join(AVATAR_DIR, entry.avatar))).toString('base64'); }
    catch { /* портрета нет — файл без него */ }
  }
  return { format: FILE_FORMAT, version: 1, name: entry.name, from: entry.from, card: entry.card, abilities: entry.abilities || [], avatarData };
}

// Загрузить персонажа из файла. Поля берутся только известные; запись с тем же именем обновляется.
export async function uploadEntry(file) {
  if (!file || typeof file !== 'object' || file.format !== FILE_FORMAT) throw new LibraryError('Это не файл персонажа из «Хроники».');
  const name = str(file.name, 80);
  if (!name) throw new LibraryError('В файле нет имени персонажа.');
  const card = cardOf('npc', file.card && typeof file.card === 'object' ? file.card : {});
  if (file.card && file.card.self === true) card.self = true;
  let avatar = null;
  const m = String(file.avatarData || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (m) {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length <= 3 * 1024 * 1024) { avatar = `${randomUUID()}.${EXT[m[1]]}`; await mkdir(AVATAR_DIR, { recursive: true }); await writeFile(join(AVATAR_DIR, avatar), buf); }
  }
  const abilities = (Array.isArray(file.abilities) ? file.abilities : []).filter((a) => a && str(a.name))
    .map((a) => ({ name: str(a.name, 80), value: str(a.value, 40), description: str(a.description, 400) || undefined })).slice(0, 40);
  const items = await readAll();
  const old = items.find((x) => same(x.name, name));
  const entry = { id: old ? old.id : randomUUID(), name, from: file.from === 'hero' ? 'hero' : 'npc', savedAt: Date.now(), card, abilities, avatar };
  if (old) { await dropAvatar(old.avatar); items[items.indexOf(old)] = entry; } else items.push(entry);
  await writeAll(items);
  return { entry, updated: Boolean(old) };
}
