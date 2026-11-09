// Что уходит в Automatic1111: второй проход, дорисовка лиц и рук, планировщик, негатив анатомии.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { txt2img, DEFAULT_IMAGE_SETTINGS } from '../src/images.js';
import { PNG } from './harness.js';

let restore;
afterEach(() => restore && restore());
let n = 0;
function fakeSd({ adetailer = true } = {}) {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.endsWith('/scripts')) return json({ txt2img: adetailer ? ['adetailer'] : [], img2img: [] });
    if (u.endsWith('/upscalers')) return json([{ name: 'R-ESRGAN 4x+' }, { name: 'Latent' }]);
    if (u.endsWith('/txt2img')) { sent.push(JSON.parse(init.body)); return json({ images: [PNG.toString('base64')], info: '{"seed":7}' }); }
    throw new Error('неожиданный адрес ' + u);
  };
  restore = () => { globalThis.fetch = orig; };
  return { sent, url: `http://sd-${++n}.test` };
}
const settings = (over = {}) => ({ ...DEFAULT_IMAGE_SETTINGS, ...over });

test('портрет: второй проход, лицо и руки ADetailer, планировщик Karras', async () => {
  const sd = fakeSd();
  await txt2img(settings({ sdUrl: sd.url }), '1girl, adult');
  const b = sd.sent[0];
  assert.equal(b.enable_hr, true, 'второй проход и для портретов');
  assert.equal(b.scheduler, 'Karras');
  const models = b.alwayson_scripts.ADetailer.args.slice(2).map((a) => a.ad_model);
  assert.deepEqual(models, ['face_yolov8n.pt', 'hand_yolov8n.pt']);
});

test('негатив анатомии добавляется к своему, без повторов', async () => {
  const sd = fakeSd();
  await txt2img(settings({ sdUrl: sd.url, imageNegative: 'my neg, bad hands' }), 'x');
  const neg = sd.sent[0].negative_prompt;
  assert.ok(neg.startsWith('my neg, bad hands'));
  assert.match(neg, /extra digits/);
  assert.equal(neg.split(', ').filter((t) => t === 'bad hands').length, 1);
});

test('настройки выключают второй проход и руки; без ADetailer — предупреждение', async () => {
  let sd = fakeSd();
  await txt2img(settings({ sdUrl: sd.url, portraitHires: false, handFix: false }), 'x');
  assert.equal(sd.sent[0].enable_hr, undefined);
  assert.deepEqual(sd.sent[0].alwayson_scripts.ADetailer.args.slice(2).map((a) => a.ad_model), ['face_yolov8n.pt']);
  restore();
  sd = fakeSd({ adetailer: false });
  const r = await txt2img(settings({ sdUrl: sd.url }), 'x');
  assert.ok(r.warnings.some((w) => /ADetailer не установлен/.test(w)));
});

test('теги: зациклившийся ответ модели обрезается до осмысленного начала', async () => {
  const { cleanTags } = await import('../src/art.js');
  const loop = '1girl, adult, dark hair, Dark Hair, glowing eyes, ' + Array(500).fill('glaring').join(', ');
  assert.equal(cleanTags(loop), '1girl, adult, dark hair, glowing eyes, glaring');
  const many = Array.from({ length: 100 }, (_, i) => `tag${i}`).join(', ');
  assert.equal(cleanTags(many, 40).split(', ').length, 40);
  assert.equal(cleanTags('- 1boy\n- beard\nсовсем длинная строка пояснений которую модель зачем-то дописала после тегов и которая не тег'), '1boy, beard');
  assert.equal(cleanTags(''), '');
});

test('теги портрета: потолок длины ответа и штраф за повторы в запросе', async () => {
  const { installFakeFetch, reply } = await import('./fake-llm.js');
  const { portraitTags } = await import('../src/art.js');
  const fake = installFakeFetch([reply('1girl, adult, ' + Array(300).fill('dark').join(', '), [], 'length')]);
  restore = fake.restore;
  const tags = await portraitTags({ state: { model: 'm' }, apiKey: 'k', subject: { name: 'Ада', appearance: 'тёмные волосы' } });
  assert.equal(tags, '1girl, adult, dark');
  assert.ok(fake.requests[0].max_tokens > 0 && fake.requests[0].max_tokens <= 500);
  assert.ok(fake.requests[0].frequency_penalty > 0);
});

test('любой запрос к модели — с потолком длины ответа', async () => {
  const { installFakeFetch, reply } = await import('./fake-llm.js');
  const { callOpenRouter, DEFAULT_MAX_TOKENS } = await import('../src/llm.js');
  const fake = installFakeFetch([reply('ок')]);
  restore = fake.restore;
  await callOpenRouter({ purpose: 'тест', model: 'm', apiKey: 'k', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(fake.requests[0].max_tokens, DEFAULT_MAX_TOKENS);
  assert.ok(DEFAULT_MAX_TOKENS <= 20000);
});
