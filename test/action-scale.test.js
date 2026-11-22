import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPower, resolveScaled, parseBarriers } from '../src/action-scale.js';
import { startStack } from './harness.js';
import { reply, call } from './fake-llm.js';

test('масштаб зависит от формы и способа действия, социальные черты сюда не входят', () => {
  const hero = { id: 'ren', blocks: [{ id: 'r', name: 'Сила демона', power: readPower({ kind: 'сила', tier: 2, when: 'Облик суккуба' }) }] };
  const state = { npcs: [{ id: 'g', name: 'Великан', bodyScale: { strength: 2 } }, { id: 'p', name: 'Призрак', bodyScale: { intangible: true } }] };
  const resolve = (approach, target, args = {}) => resolveScaled(state, hero, { approach, target, ...args }, new Map(), () => ({ roll: 10, success: true, outcome: 'успех' }));
  assert.equal(resolve('сила', 'Великан').success, false);
  hero.blocks.push({ type: 'status', name: 'Облик суккуба' });
  assert.equal(resolve('сила', 'Великан', { stake: 'кто удержит ворота' }).roll, 10);
  assert.equal(resolve('сила', 'Балка', { obstacle_tier: 1 }).roll, undefined);
  assert.equal(resolve('сила', 'Балка', { obstacle_tier: 3 }).success, true);
  assert.equal(resolve('касание', 'Призрак').success, false);
  for (const [mode, kind] of [['полёт', 'полёт'], ['бестелесность', 'бестелесность'], ['касание', 'касание духов']]) {
    const power = { id: kind, name: 'Дар', power: readPower({ kind, charges: 1 }) };
    hero.blocks.push(power);
    const used = new Map();
    const act = () => resolveScaled(state, hero, { approach: mode, source: 'Дар', target: 'Призрак' }, used, assert.fail);
    assert.equal(act().success, true);
    assert.equal(act().success, true);
    assert.equal(power.power.charges, 0);
    assert.equal(resolve(mode, 'Призрак', { source: 'Дар' }).success, false);
    hero.blocks.pop();
  }
  assert.throws(() => parseBarriers('Дверь | 2\nдверь | 1'), /повторяется/);
  assert.throws(() => readPower({ kind: 'сила', tier: 5 }), /Масштаб/);
});

test('реальный сервер: включение по истории, отказ модели, повтор, переучёт, регенерация и копия', async () => {
  const s = await startStack();
  try {
    const request = async (method, path, body) => {
      const r = await s.api(method, path, body);
      assert.equal(r.status, 200, JSON.stringify(r.data.error));
      return r.data;
    };
    const get = () => request('GET', '/api/state');
    let data = await get();
    const hid = data.activeCharacterId;
    const charges = (d) => d.characters.find((c) => c.id === hid).blocks.find((b) => b.name === 'Домкрат').power.charges;
    const initial = (await request('GET', '/api/slots')).activeSlotId;
    assert.equal(data.scaleEnabled, false);
    await request('POST', '/api/settings', { scaleEnabled: true });
    await request('POST', `/api/characters/${hid}/blocks`, { type: 'item', name: 'Домкрат', power: { kind: 'сила', tier: 1, charges: 1 } });
    const args = { approach: 'сила', source: 'Домкрат', target: 'Машина у склада', obstacle_tier: 1, skill: 'Ремесло', difficulty: 'обычно' };
    let fail = true;
    s.handlers.narrator = (body) => {
      if (!body.messages.some((m) => m.role === 'tool')) {
        assert.ok(body.tools.find((t) => t.function.name === 'roll_check').function.parameters.properties.approach);
        return reply('', [call('roll_check', args), call('roll_check', args)]);
      }
      return fail ? { status: 400, text: 'interrupted' } : reply('Ты поднимаешь машину домкратом. Твой спутник вытаскивает раненого, и вы отходите от склада вместе.');
    };
    assert.equal((await s.api('POST', '/api/action', { text: 'Поднимаю машину домкратом.' })).status, 502);
    assert.equal(charges(await get()), 1);
    assert.deepEqual((await get()).scaleBarriers, []);
    fail = false;
    data = await request('POST', '/api/retry');
    let r = data.log.at(-1).rolls;
    assert.equal(r.length, 1);
    assert.equal(r[0].outcome, 'автоматический успех');
    assert.equal(r[0].action.remaining, 0);
    assert.equal(charges(data), 0);
    assert.deepEqual(data.scaleBarriers, [{ name: args.target, tier: 1 }]);
    assert.equal(charges(await request('POST', '/api/resync')), 0);
    const backup = (await request('POST', '/api/backups')).backup;
    s.handlers.narrator = () => reply('Ты отступаешь за ворота склада и оставляешь машину в покое.');
    assert.equal(charges(await request('POST', '/api/regenerate')), 1);
    const restored = await request('POST', `/api/backups/${backup.id}/restore`, { slotId: initial });
    assert.equal(charges(restored), 0);
    assert.equal(restored.scaleEnabled, true);
    assert.deepEqual(restored.scaleBarriers, data.scaleBarriers);
    const other = await request('POST', '/api/slots', { name: 'Обычная партия' });
    assert.equal(other.scaleEnabled, false);
    assert.deepEqual(other.scaleBarriers, []);
  } finally { s.stop(); }
});

test('учётчик создаёт источник и НПС, повторная запись не пополняет заряды', async () => {
  const { executeTool, toolsFor } = await import('../src/tools.js');
  const { makeState } = await import('./helpers.js');
  const state = makeState();
  const schema = () => toolsFor(state).find((t) => t.function.name === 'block').function.parameters.properties;
  assert.equal(schema().power, undefined);
  state.scaleEnabled = true;
  assert.ok(schema().power);
  const args = { type: 'item', name: 'Крылья', power: { kind: 'полёт', charges: 2 } };
  executeTool('block', args, state);
  const item = state.characters[0].blocks[0];
  item.power.charges = 0;
  executeTool('block', args, state);
  assert.equal(item.power.charges, 0);
  executeTool('npc', { name: 'Астар', bodyScale: { strength: 3, intangible: true } }, state);
  assert.deepEqual(state.npcs[0].bodyScale, { strength: 3, intangible: true });
});
