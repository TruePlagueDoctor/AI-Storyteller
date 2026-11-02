// Прогон одной сцены через настоящий учётчик (syncNarration).
import { makeState } from '../test/helpers.js';
import { syncNarration } from '../src/sync.js';
import { SCENES, judge, snapshotBefore } from './sync-scenes.js';

export function buildState(sc, { style } = {}) {
  const st = makeState({ syncPromptStyle: style || 'technical' });
  sc.setup(st);
  st.messages = [{ role: 'user', content: sc.action }];
  return st;
}

export async function runScene(sc, { apiKey, model, style } = {}) {
  const st = buildState(sc, { style });
  if (model) st.model = model;
  const before = snapshotBefore(st);
  const t0 = Date.now();
  const res = await syncNarration({ state: st, apiKey, narration: sc.narration, force: true });
  const calls = (res.calls || []).filter((c) => !c.check).map((c) => ({ name: c.name, args: c.args, result: c.result, warn: c.warn, round: c.round }));
  const verdict = judge(sc, st, calls, before);
  const timing = res.timing || [];
  return {
    id: sc.id, title: sc.title, ...verdict,
    status: res.status, error: res.error,
    calls, checks: (res.calls || []).filter((c) => c.check).map((c) => c.result),
    rounds: timing.length,
    ms: Date.now() - t0,
    tokensIn: timing.reduce((a, t) => a + (t.in || 0), 0),
    tokensOut: timing.reduce((a, t) => a + (t.out || 0), 0),
    cost: timing.reduce((a, t) => a + (t.cost || 0), 0),
  };
}

export { SCENES };
