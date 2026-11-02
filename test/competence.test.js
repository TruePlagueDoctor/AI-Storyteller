// Компетентность НПС: умелость и ключевые умения делают проверки против него труднее.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { competenceMod, COMPETENCE } from '../src/skills.js';
import { executeTool } from '../src/tools.js';
import { composeStorySystem } from '../src/narrator.js';
import { runTurn } from '../src/turn.js';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());

const sleuth = { name: 'Инспектор Варг', competence: 'мастер', skills: ['следствие', 'допрос'] };
const guard = { name: 'Ольт', competence: 'профессионал', skills: ['стража'] };
const duelist = { name: 'Корвин', competence: 'профессионал', skills: ['фехтование'] };

test('штраф: против умений НПС — по его умелости, мимо — ничего', () => {
  assert.deepEqual(COMPETENCE, ['обычный', 'профессионал', 'мастер']);
  assert.equal(competenceMod(sleuth, 'Обман').mod, -4);
  assert.match(competenceMod(sleuth, 'Убедить инспектора').reason, /Инспектор Варг — мастер \(следствие, допрос\)/);
  assert.equal(competenceMod(sleuth, 'Скрытность').mod, 0);
  assert.equal(competenceMod(guard, 'Скрытность').mod, -2, 'стража замечает крадущегося');
  assert.equal(competenceMod(duelist, 'Владение мечом').mod, -2, 'то же умение — тоже противостояние');
  assert.equal(competenceMod({ ...duelist, competence: 'обычный' }, 'Фехтование').mod, 0);
  assert.equal(competenceMod({ name: 'X', competence: 'мастер', skills: [] }, 'Обман').mod, 0, 'без умений не угадываем');
  assert.equal(competenceMod(null, 'Обман').mod, 0);
});

test('учётчик записывает умелость и умения, мусор отбрасывается', () => {
  const st = makeState();
  executeTool('npc', { name: 'Варг', competence: 'Мастер', skills: ['следствие', ' допрос ', '', 'стрельба', 'яды'] }, st);
  assert.equal(st.npcs[0].competence, 'мастер');
  assert.deepEqual(st.npcs[0].skills, ['следствие', 'допрос', 'стрельба'], 'не больше трёх');
  executeTool('npc', { name: 'Варг', competence: 'гений' }, st);
  assert.equal(st.npcs[0].competence, 'мастер', 'неизвестный уровень не записывается');
  st.npcs[0].locked = ['competence'];
  assert.match(executeTool('npc', { name: 'Варг', competence: 'обычный' }, st), /закреплены.*competence/);
});

test('рассказчик видит умелость в карточке', () => {
  const st = makeState({ npcs: [{ ...sleuth, locked: [] }] });
  assert.match(composeStorySystem(st), /Умелость: мастер — следствие, допрос/);
});

test('бросок против мастера учитывает его умения', async () => {
  const st = makeState({ messages: [{ role: 'user', content: 'Вру инспектору' }], stateSync: false, npcs: [{ ...sleuth, traits: [], locked: [] }] });
  fake = installFakeFetch([
    reply('', [call('roll_check', { skill: 'Обман', difficulty: 'обычно', target: 'Инспектор Варг' })]),
    (body) => { assert.match(body.messages.at(-1).content, /− 4 \(Инспектор Варг — мастер/); return reply('Варг прищуривается.'); },
  ]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.rolls[0].traitMod, -4);
  assert.equal(out.rolls[0].target_npc, 'Инспектор Варг');
});
