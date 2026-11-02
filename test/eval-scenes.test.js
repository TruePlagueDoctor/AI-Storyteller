// Сами тестовые сцены учётчика должны быть верными: идеальные вызовы проходят
// все проверки, а ответ «ничего не менять» проваливает сцены, где менять надо.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { runScene, SCENES } from '../evals/run.js';

let fake;
afterEach(() => fake && fake.restore());

for (const sc of SCENES) {
  test(`сцена «${sc.title}»: идеальный учётчик проходит`, async () => {
    fake = installFakeFetch([reply('', sc.ideal.map(([n, a]) => call(n, a))), reply('', [call('nothing', {})])]);
    const r = await runScene(sc, { apiKey: 'k' });
    assert.equal(r.status, 'done', r.error);
    assert.deepEqual({ failed: r.failed, violated: r.violated }, { failed: [], violated: [] }, JSON.stringify(r.calls, null, 1));
  });
  if (sc.must.length) {
    test(`сцена «${sc.title}»: бездействие ловится`, async () => {
      fake = installFakeFetch([reply('', [call('nothing', {})]), reply('', [call('nothing', {})])]);
      const r = await runScene(sc, { apiKey: 'k' });
      assert.ok(r.failed.length > 0);
    });
  }
}
