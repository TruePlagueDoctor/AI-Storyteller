// Резервные копии партий: data/backups/<время>/ — список партий, общие настройки и файлы партий.
// Делаются раз в сутки при запуске и по кнопке. Снимки ходов (свайпы) не копируются — они
// большие; восстановленная партия просто начинается без истории вариантов.
// Восстанавливают копию новой историей рядом с текущими — ничего не затирая.
import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';

const BACKUP_DIR = join(DATA_DIR, 'backups');
export const BACKUP_KEEP = 10;
const DAY_MS = 20 * 3600 * 1000; // «раз в сутки» с запасом: запуск каждое утро в разное время
const ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
export const backupLabel = (at) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export async function makeBackup(reason = 'вручную') {
  const index = await readJson(join(DATA_DIR, 'slots.json'), null);
  if (!index || !Array.isArray(index.slots) || !index.slots.length) return null;
  const now = new Date();
  let id = stampOf(now);
  const existing = new Set(await readdir(BACKUP_DIR).catch(() => []));
  for (let n = 2; existing.has(id); n++) id = `${stampOf(now)}-${n}`;
  const dir = join(BACKUP_DIR, id);
  await mkdir(join(dir, 'slots'), { recursive: true });
  const slots = [];
  for (const s of index.slots) {
    try {
      await copyFile(join(DATA_DIR, 'slots', `${s.id}.json`), join(dir, 'slots', `${s.id}.json`));
      const raw = await readJson(join(dir, 'slots', `${s.id}.json`), {});
      slots.push({ id: s.id, name: s.name, updatedAt: s.updatedAt, turns: (raw.log || []).filter((e) => e.role === 'player').length });
    } catch { /* файла партии нет — пропускаем */ }
  }
  try { await copyFile(join(DATA_DIR, 'settings.json'), join(dir, 'settings.json')); } catch { /* нет настроек */ }
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ at: now.getTime(), reason, slots }, null, 1));
  await prune();
  return { id, at: now.getTime(), reason, slots };
}

async function prune() {
  const list = await listBackups();
  for (const b of list.slice(BACKUP_KEEP)) await rm(join(BACKUP_DIR, b.id), { recursive: true, force: true });
}

// Свежие — первыми.
export async function listBackups() {
  const names = (await readdir(BACKUP_DIR).catch(() => [])).filter((n) => ID_RE.test(n));
  const out = [];
  for (const id of names) {
    const meta = await readJson(join(BACKUP_DIR, id, 'meta.json'), null);
    if (meta) out.push({ id, at: meta.at, label: backupLabel(meta.at), reason: meta.reason || '', slots: meta.slots || [] });
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function maybeDailyBackup() {
  const [last] = await listBackups();
  if (last && Date.now() - last.at < DAY_MS) return null;
  return makeBackup('при запуске');
}

export async function readBackupSlot(backupId, slotId) {
  if (!ID_RE.test(String(backupId)) || !/^[\w-]+$/.test(String(slotId))) throw new Error('Копия не найдена.');
  const raw = await readJson(join(BACKUP_DIR, backupId, 'slots', `${slotId}.json`), null);
  if (!raw) throw new Error('Копия не найдена.');
  return raw;
}
