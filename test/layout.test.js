// Раскладка запроса рассказчику: постоянная часть в начале, состояние мира — в конце (кэш провайдера).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { runTurn } from '../src/turn.js';
import { composeStorySystem, storyRequestParts, storyMessages } from '../src/narrator.js';
import { makeState, hero } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const rich = (over = {}) => {
  const st = makeState({ worldPrompt: 'Мир туманов.', scenarioPrompt: 'Тон: мрачный', summary: 'Ян пришёл в город.', directorNote: 'к морю', diceEnabled: false, ...over });
  st.npcs = [{ name: 'Ольт', description: 'Стражник у ворот', locked: [] }];
  st.scene.location = 'Городские ворота'; st.scene.present = ['Ольт'];
  hero(st).blocks = [{ id: 'b1', type: 'stat', name: 'Здоровье', value: '5', max: 10 }];
  return st;
};

test('прежняя раскладка — один системный блок, как раньше', () => {
  const st = rich({ promptLayout: 'classic', messages: [{ role: 'user', content: 'Иду' }] });
  const { system, late } = storyRequestParts(st);
  assert.equal(system, composeStorySystem(st));
  assert.equal(late, '');
  const msgs = storyMessages(st, {}, ['[заметка]']);
  assert.equal(msgs[0].content, composeStorySystem(st));
  assert.equal(msgs.at(-1).content, 'Иду\n\n[заметка]');
});

test('экономная раскладка: ничего не потеряно, изменчивое — в конце', () => {
  const st = rich({ messages: [{ role: 'user', content: 'Иду' }] });
  const { system, late } = storyRequestParts(st);
  for (const must of ['Мир туманов.', 'КАК ВЕСТИ ЭТОТ ХОД', 'ЛЮДИ ЭТОГО МИРА', 'Ян пришёл в город.']) assert.ok(system.includes(must), must);
  for (const must of ['Городские ворота', 'Стражник у ворот', 'Здоровье 5/10', 'к морю']) {
    assert.ok(late.includes(must), must);
    assert.ok(!system.includes(must), `«${must}» не должно быть в постоянной части`);
  }
  // Каждый раздел прежнего промта есть либо в начале, либо в конце.
  const sections = composeStorySystem({ ...st, directorNote: '' }).split('\n\n=== ').map((x) => x.split('\n')[0]);
  for (const head of sections.slice(1)) assert.ok((system + late).includes(head), head);
  const msgs = storyMessages(st, {}, ['[заметка]']);
  assert.match(msgs.at(-1).content, /^\[СОСТОЯНИЕ МИРА[\s\S]*\[КОНЕЦ СЛУЖЕБНЫХ ДАННЫХ\]\n\nХОД ИГРОКА:\nИду\n\n\[заметка\]$/);
});

test('от хода к ходу начало запроса и история совпадают, в сохранённую историю состояние не попадает', async () => {
  const st = rich({ messages: [{ role: 'user', content: 'Иду к воротам' }] });
  fake = installFakeFetch([
    reply('Ольт преграждает путь. Он хмурится и ждёт.'),
    reply('', [call('scene', { location: 'Караульная', present: ['Ольт'], minutes: 30 }), call('block', { type: 'stat', name: 'Здоровье', value: '3' })]),
    reply('Ольт кивает. Дверь открыта.'),
    reply('', [call('nothing', {})]),
  ]);
  await runTurn({ state: st, apiKey: 'k' });
  st.messages.push({ role: 'user', content: 'Показываю бумаги' });
  st.turn++;
  await runTurn({ state: st, apiKey: 'k' });
  const [first, , second] = fake.requests;
  assert.equal(second.messages[0].content, first.messages[0].content, 'постоянная часть не изменилась, хотя сцена и лист другие');
  assert.deepEqual(second.messages[1], { role: 'user', content: 'Иду к воротам' });
  assert.match(second.messages.at(-1).content, /Караульная[\s\S]*Здоровье 3\/10[\s\S]*ХОД ИГРОКА:\nПоказываю бумаги/);
  assert.ok(st.messages.every((m) => !/СОСТОЯНИЕ МИРА/.test(m.content)));
});
