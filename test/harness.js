// Стенд для сквозных проверок: настоящий server.js в отдельном процессе,
// вместо OpenRouter и Automatic1111 — поддельный сервер в этом процессе.
// Используется в test/api.test.js и scripts/ui-smoke.mjs.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reply, call } from './fake-llm.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Какой это запрос — по началу системного промта.
export function kindOf(body) {
  const sys = String(body.messages?.[0]?.content || '');
  if (sys.startsWith('Задание: сыграть одного персонажа')) return 'voice';
  if (sys.startsWith('РОЛЬ: учётчик') || sys.startsWith('Ты — учётчик состояния')) return 'sync';
  if (sys.includes('архивариус')) return 'summary';
  if (sys.includes('=== КАК ВЕСТИ ЭТОТ ХОД')) return 'narrator';
  return 'other';
}

export function defaultHandlers() {
  return {
    narrator: () => reply('Ты стоишь у ворот. Стражник Ольт смотрит на тебя: «Чего надо?»'),
    sync: () => reply('', [call('nothing', {})]),
    summary: () => reply('Ян пришёл к воротам.'),
    voice: () => reply('РЕШЕНИЕ: не пускать без бумаг\nРЕПЛИКА: Бумаги покажи.\nВЫДАЁТ: косится на караульную'),
    other: () => reply('1boy, mature male, adult'),
  };
}

export async function startStack({ handlers = defaultHandlers(), env = {} } = {}) {
  const seen = [];
  const fake = createServer(async (req, res) => {
    let raw = ''; for await (const ch of req) raw += ch;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/sdapi/v1/')) {
      if (req.url.endsWith('/options')) return send(200, { sd_model_checkpoint: 'pony' });
      if (req.url.endsWith('/scripts')) return send(200, { txt2img: [], img2img: [] });
      if (req.url.endsWith('/upscalers')) return send(200, [{ name: 'Latent' }]);
      if (req.url.endsWith('/txt2img')) return send(200, { images: [PNG.toString('base64')], info: JSON.stringify({ seed: 42 }) });
    }
    const body = JSON.parse(raw);
    const kind = kindOf(body);
    seen.push({ kind, body });
    const out = await handlers[kind](body);
    if (out && out.status) { res.writeHead(out.status); return res.end(out.text || ''); }
    send(200, out);
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

  const dataDir = mkdtempSync(join(tmpdir(), 'storyteller-stack-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const stack = { base, fakeUrl, seen, handlers, output: '' };
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), STORYTELLER_DATA_DIR: dataDir, OPENROUTER_URL: `${fakeUrl}/chat`, OPENROUTER_API_KEY: 'test', LAN_ACCESS: '', LAN_PASSWORD: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { stack.output += d; });
  server.stderr.on('data', (d) => { stack.output += d; });
  for (let i = 0; i < 100 && !stack.output.includes('запущен'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!stack.output.includes('запущен')) { server.kill(); fake.close(); throw new Error('Сервер не запустился:\n' + stack.output); }

  stack.api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  stack.stop = () => {
    server.kill();
    fake.close();
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* не страшно */ }
  };
  await stack.api('POST', '/api/settings', { sdUrl: fakeUrl });
  return stack;
}
