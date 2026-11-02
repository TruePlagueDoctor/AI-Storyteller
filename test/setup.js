// Подключается перед каждым файлом тестов (npm test): данные — во временную папку,
// чтобы тесты не трогали настоящие партии, настройки и диагностику.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.STORYTELLER_DATA_DIR) {
  process.env.STORYTELLER_DATA_DIR = mkdtempSync(join(tmpdir(), 'storyteller-test-'));
}
process.env.OPENROUTER_API_KEY ||= 'test-key';
