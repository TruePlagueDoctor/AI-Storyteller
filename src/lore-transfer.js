// Переносимый лорбук содержит статьи и сами изображения, без путей из чужой партии.
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, open, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { CODEX_KINDS, KIND_FIELDS, normalizeEntry } from './codex.js';
import { AVATAR_DIR } from './paths.js';

const FORMAT = 'ai-storyteller-lorebook';
const TEXT = ['title', 'brief', 'content', 'imageTags'];
const FLAGS = ['always', 'enabled', 'locked', 'briefAuto'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const norm = (s) => s.trim().toLowerCase().replace(/ё/g, 'е');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export class LoreFormatError extends Error {}

function portable(raw, index) {
  function check(ok, field) {
    if (!ok) throw new LoreFormatError(`Статья №${index + 1}: проверьте поле «${field}».`);
  }
  check(object(raw) && typeof raw.title === 'string' && raw.title.trim(), 'title');
  const data = {};
  for (const k of TEXT) if (raw[k] !== undefined) { check(typeof raw[k] === 'string', k); data[k] = raw[k]; }
  for (const k of FLAGS) if (raw[k] !== undefined) { check(typeof raw[k] === 'boolean', k); data[k] = raw[k]; }
  if (raw.id != null) { check(typeof raw.id === 'string' && /^[\w-]+$/.test(raw.id), 'id'); data.id = raw.id; }
  check(raw.kind == null || CODEX_KINDS.includes(raw.kind), 'kind');
  data.kind = raw.kind || 'other';
  check(raw.keys == null || typeof raw.keys === 'string' || (Array.isArray(raw.keys) && raw.keys.every((s) => typeof s === 'string')), 'keys');
  data.keys = raw.keys;
  if (raw.fields != null) {
    check(object(raw.fields), 'fields');
    for (const [k, v] of Object.entries(raw.fields)) {
      check(KIND_FIELDS[data.kind].some(([f]) => f === k) && ['string', 'number'].includes(typeof v), 'fields.' + k);
    }
    data.fields = raw.fields;
  }
  if (raw.relations != null) {
    check(Array.isArray(raw.relations) && raw.relations.every((r) => data.kind === 'people' && object(r) && typeof r.to === 'string' && r.to.trim() && typeof r.text === 'string' && r.text.trim()), 'relations');
    data.relations = raw.relations;
  }
  data.author = raw.author === 'narrator' ? 'narrator' : 'player';
  return normalizeEntry(data);
}

export async function exportLorebook(book) {
  const entries = [];
  for (const [i, raw] of book.entries()) {
    const entry = portable(raw, i);
    if (raw.image) {
      const mime = MIME[extname(raw.image).toLowerCase()];
      if (!mime || !/^[\w-]+\.(png|jpe?g|webp)$/i.test(raw.image)) throw new Error('Не удалось экспортировать иллюстрацию: ' + raw.title);
      const bytes = await readFile(join(AVATAR_DIR, raw.image));
      entry.imageData = `data:${mime};base64,${bytes.toString('base64')}`;
    }
    entries.push(entry);
  }
  return { format: FORMAT, version: 1, entries };
}

export function planLoreImport(file, current) {
  const rawEntries = Array.isArray(file) ? file : file?.format === FORMAT && file.version === 1 ? file.entries : null;
  if (!Array.isArray(rawEntries)) throw new LoreFormatError('Ожидается JSON-массив статей или экспорт кодекса версии 1.');
  const ids = new Set(current.map((e) => e.id));
  const titles = new Set(current.map((e) => norm(e.title)));
  const added = [], skipped = [];
  for (const [i, raw] of rawEntries.entries()) {
    const entry = portable(raw, i);
    if (ids.has(entry.id) || titles.has(norm(entry.title))) { skipped.push(entry.title); continue; }
    ids.add(entry.id);
    if (!raw.id) titles.add(norm(entry.title));
    let bytes;
    if (raw.imageData != null) {
      const m = typeof raw.imageData === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw.imageData);
      if (!m) throw new LoreFormatError('Некорректная иллюстрация: ' + entry.title);
      bytes = Buffer.from(m[2], 'base64');
      if (!bytes.length || bytes.toString('base64') !== m[2]) throw new LoreFormatError('Повреждены данные иллюстрации: ' + entry.title);
      entry.image = randomUUID() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    }
    added.push({ entry, bytes });
  }
  return { added, skipped };
}

export async function installLoreImages(added, commit) {
  const paths = [];
  try {
    if (added.some((x) => x.bytes)) await mkdir(AVATAR_DIR, { recursive: true });
    for (const { entry, bytes } of added) {
      if (!bytes) continue;
      const path = join(AVATAR_DIR, entry.image);
      const file = await open(path, 'wx');
      paths.push(path);
      try { await file.writeFile(bytes); } finally { await file.close(); }
    }
    await commit(added.map((x) => x.entry));
  } catch (e) {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
    throw e;
  }
}
