// Резервные копии партий: раз в сутки при запуске и по кнопке; восстановление — новой историей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../src/paths.js';
import * as S from '../src/state.js';
import { makeBackup, listBackups, maybeDailyBackup, readBackupSlot, BACKUP_KEEP } from '../src/backup.js';

const narr = async (text) => {
  const st = S.getState();
  st.messages.push({ role: 'user', content: 'ход' }, { role: 'assistant', content: text });
  st.log.push({ role: 'player', text: 'ход' }, { role: 'narrator', text });
  await S.saveState();
};

test('копия содержит все партии и настройки', async () => {
  await S.loadState();
  await narr('Первая история, первый ход.');
  await S.renameSlot(S.listSlots().activeSlotId, 'Север');
  await S.createSlot('Юг');
  await narr('Вторая история.');
  const b = await makeBackup('вручную');
  const list = await listBackups();
  assert.equal(list[0].id, b.id);
  assert.deepEqual(list[0].slots.map((x) => x.name).sort(), ['Север', 'Юг']);
  assert.equal(list[0].reason, 'вручную');
  const sever = list[0].slots.find((x) => x.name === 'Север');
  assert.equal(sever.turns, 1);
});

test('восстановление — новой историей, оригинал не трогается', async () => {
  const [b] = await listBackups();
  const sever = b.slots.find((x) => x.name === 'Север');
  // Портим оригинал после копии.
  await S.switchSlot(sever.id);
  await narr('Испорченный ход.');
  const raw = await readBackupSlot(b.id, sever.id);
  await S.importSlot(raw, `Север (копия от ${b.label})`);
  const st = S.getState();
  assert.equal(st.log.length, 2, 'в восстановленной — состояние на момент копии');
  const names = S.listSlots().slots.map((x) => x.name);
  assert.ok(names.includes('Север'));
  assert.ok(names.some((n) => n.startsWith('Север (копия от')));
  await S.switchSlot(sever.id);
  assert.equal(S.getState().log.length, 4, 'оригинал остался как был');
  await assert.rejects(readBackupSlot(b.id, 'нет-такой'), /не найдена/);
  await assert.rejects(readBackupSlot('../../etc', sever.id), /не найдена/);
});

test('ежедневная копия — не чаще раза в сутки, старые удаляются', async () => {
  assert.equal(await maybeDailyBackup(), null, 'копия уже есть — повторно не делаем');
  // Набираем копий сверх лимита — старые уходят.
  const dir = join(DATA_DIR, 'backups');
  for (let i = 0; i < BACKUP_KEEP + 3; i++) {
    const id = `2020-01-${String(i + 1).padStart(2, '0')}_00-00-00`;
    await mkdir(join(dir, id), { recursive: true });
    await writeFile(join(dir, id, 'meta.json'), JSON.stringify({ at: Date.parse(`2020-01-${String(i + 1).padStart(2, '0')}`), reason: 'тест', slots: [] }));
  }
  await makeBackup('вручную');
  const names = (await readdir(dir)).filter((n) => !n.startsWith('.'));
  assert.equal(names.length, BACKUP_KEEP);
  assert.ok(!names.includes('2020-01-01_00-00-00'));
});
