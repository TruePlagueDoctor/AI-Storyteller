// Где лежат данные. По умолчанию — папка data/ рядом с проектом;
// STORYTELLER_DATA_DIR переносит их (так тесты не трогают настоящие партии).
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.STORYTELLER_DATA_DIR ? resolve(process.env.STORYTELLER_DATA_DIR) : join(ROOT, 'data');
export const PUBLIC_DIR = join(ROOT, 'public');
export const AVATAR_DIR = join(DATA_DIR, 'avatars');
export const SCENE_DIR = join(DATA_DIR, 'scenes');
export const DIAG_DIR = process.env.DIAG_DIR || join(DATA_DIR, 'diag');
