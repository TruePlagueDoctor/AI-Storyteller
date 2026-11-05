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
