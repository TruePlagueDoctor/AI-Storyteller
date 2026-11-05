// Ручные правки игрока переживают откат хода (перегенерацию, свайп, обрезку, сбой хода),
// а то, что записали рассказчик и учётчик за отменённый ход, — откатывается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/state.js';

const st = () => S.getState();
const hero = () => st().characters[0];
// Ход: снимок до хода → изменения «модели» → реплика рассказчика и снимок после.
async function turn(narration, modelChanges = () => {}) {
  st().messages.push({ role: 'user', content: 'ход' });
  st().log.push({ role: 'player', text: 'ход' });
  S.captureTurnSnapshot();
  st().turn += 1;
  modelChanges(st());
  st().messages.push({ role: 'assistant', content: narration });
  st().log.push({ role: 'narrator', text: narration });
  await S.recordTurnOutcome();
  await S.saveState();
}

test('перегенерация не трогает ручные правки кодекса, НПС, листа, нитей и хроники', async () => {
  await S.loadState();
  await S.resetGame();
  const gnomes = await S.addLoreEntry({ title: 'Гномы', kind: 'people', content: 'старое' });
  await turn('Первый ход.', (s) => { s.npcs.push({ id: 'olt', name: 'Ольт', attitude: 'насторожен', locked: [] }); });
  await turn('Второй ход.', (s) => {
    s.npcs[0].attitude = 'враждебен'; // учётчик за этот ход
    s.lorebook.push({ id: 'auto', title: 'Кобольды', kind: 'creature', author: 'narrator', keys: [], content: 'x' });
  });
  // Игрок правит всё подряд после хода.
  await S.updateLoreEntry(gnomes.id, { brief: 'Подгорный народ.', content: 'новое' });
  const elves = await S.addLoreEntry({ title: 'Эльфы', kind: 'people' });
  await S.updateNpcManual('olt', { description: 'Стражник у ворот', race: 'гном' });
  const b = await S.upsertBlock(hero().id, { type: 'item', name: 'Фляга' });
  await S.updateCharacter(hero().id, { appearance: 'седой, шрам' });
  const t = await S.upsertThread({ title: 'Найти брата' });
  const ev = await S.upsertEvent({ text: 'Ян должен Ольту', type: 'debt' });

  S.rewindLastTurn(); // перегенерация второго хода
  const g = st().lorebook.find((e) => e.id === gnomes.id);
  assert.equal(g.brief, 'Подгорный народ.');
  assert.equal(g.content, 'новое');
  assert.ok(st().lorebook.some((e) => e.id === elves.id), 'новая статья осталась');
  assert.ok(!st().lorebook.some((e) => e.id === 'auto'), 'статья, которую завёл рассказчик за отменённый ход, ушла');
  const olt = st().npcs.find((n) => n.id === 'olt');
  assert.equal(olt.description, 'Стражник у ворот');
  assert.equal(olt.race, 'гном');
  assert.equal(olt.attitude, 'насторожен', 'а запись учётчика за отменённый ход — откатилась');
  assert.ok(hero().blocks.some((x) => x.id === b.id));
  assert.equal(hero().appearance, 'седой, шрам');
  assert.ok(st().threads.some((x) => x.id === t.id));
  assert.ok(st().events.some((x) => x.id === ev.id));
});

test('удалённое руками не воскресает после отката, обрезка к давнему ходу тоже сохраняет правки', async () => {
  await S.resetGame();
  await turn('Раз.', (s) => { s.npcs.push({ id: 'a', name: 'Анна', locked: [] }, { id: 'b', name: 'Борис', locked: [] }); });
  await turn('Два.');
  await turn('Три.');
  await S.deleteNpc('b');
  await S.updateNpcManual('a', { secret: 'шпионка' });
  await S.truncateLog(1); // к первому ответу
  assert.deepEqual(st().npcs.map((n) => n.name), ['Анна']);
  assert.equal(st().npcs[0].secret, 'шпионка');
});

test('правка, сделанная до хода, не перебивает то, что учётчик записал позже', async () => {
  await S.resetGame();
  await turn('Раз.', (s) => { s.npcs.push({ id: 'o', name: 'Ольт', attitude: 'нейтрален', locked: [] }); });
  await S.updateNpcManual('o', { attitude: 'дружелюбен' }); // игрок
  await turn('Два.', (s) => { s.npcs[0].attitude = 'благодарен'; }); // учётчик позже
  await turn('Три.');
  S.rewindLastTurn(); // откат третьего хода — снимок уже после правки
  assert.equal(st().npcs[0].attitude, 'благодарен');
});
