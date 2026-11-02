// Прогон тестовых сцен учётчика на настоящей модели OpenRouter.
//
//   npm run eval:sync                                    модель учёта из настроек игры
//   npm run eval:sync -- --model deepseek/deepseek-chat  конкретная модель
//   npm run eval:sync -- --model a/x,b/y --runs 3        сравнить модели, по 3 прогона
//   npm run eval:sync -- --only debt-paid,wounded        только эти сцены
//   npm run eval:sync -- --style legacy                  прежняя инструкция учётчика
//
// Партии не трогаются. Отчёт — в data/evals/ (.md и .json), запросы — в «Диагностике» не попадают,
// их полные тела лежат в data/evals/diag.
import 'dotenv/config';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.STORYTELLER_DATA_DIR || join(ROOT, 'data');
const OUT = join(DATA, 'evals');
process.env.DIAG_DIR = join(OUT, 'diag');
const { runScene, SCENES } = await import('../evals/run.js');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i + 1]; };
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('Нет OPENROUTER_API_KEY: впиши ключ в .env (как для игры).'); process.exit(1); }
let settings = {};
try { settings = JSON.parse(readFileSync(join(DATA, 'settings.json'), 'utf8')); } catch { /* настроек ещё нет */ }
const models = String(arg('model', settings.toolModel || settings.model || '')).split(',').map((m) => m.trim()).filter(Boolean);
if (!models.length) { console.error('Укажи модель: --model автор/модель'); process.exit(1); }
const runs = Math.max(1, Number(arg('runs', 1)) || 1);
const only = arg('only', '') ? arg('only').split(',') : null;
const style = arg('style', settings.syncPromptStyle || 'technical');
const parallel = Math.max(1, Number(arg('parallel', 4)) || 4);
const scenes = SCENES.filter((s) => !only || only.includes(s.id));

const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
const money = (c) => (c ? '$' + c.toFixed(4) : '—');

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const report = { at: new Date().toISOString(), style, runs, models: [] };
for (const model of models) {
  console.log(`\n=== ${model} (инструкция: ${style}, прогонов: ${runs}) ===`);
  const jobs = scenes.flatMap((sc) => Array.from({ length: runs }, (_, r) => ({ sc, r })));
  const results = await pool(jobs, parallel, async ({ sc }) => {
    const res = await runScene(sc, { apiKey, model, style });
    const mark = res.status === 'failed' ? 'СБОЙ' : res.ok ? ' ok ' : 'ПЛОХО';
    const why = [...res.failed.map((x) => '✗ ' + x), ...res.violated.map((x) => '⚠ ' + x), res.error ? '! ' + res.error : ''].filter(Boolean).join('; ');
    console.log(`[${mark}] ${sc.title.padEnd(36)} ${(res.ms / 1000).toFixed(1).padStart(5)} с  ${res.rounds} р.  ${res.calls.length} выз.${why ? '  ' + why : ''}`);
    return res;
  });
  const must = scenes.reduce((a, s) => a + s.must.length, 0) * runs;
  const mustOk = results.reduce((a, r) => a + (SCENES.find((s) => s.id === r.id).must.length - r.failed.length), 0);
  const forbid = scenes.reduce((a, s) => a + s.forbid.length, 0) * runs;
  const forbidBad = results.reduce((a, r) => a + r.violated.length, 0);
  const sum = {
    model,
    scenesOk: results.filter((r) => r.ok).length, scenesTotal: results.length,
    completeness: pct(mustOk, must), cleanliness: pct(forbid - forbidBad, forbid),
    failures: results.filter((r) => r.status === 'failed').length,
    secondRounds: results.filter((r) => r.rounds > 1).length,
    avgSec: +(results.reduce((a, r) => a + r.ms, 0) / results.length / 1000).toFixed(1),
    tokensIn: results.reduce((a, r) => a + r.tokensIn, 0), tokensOut: results.reduce((a, r) => a + r.tokensOut, 0),
    cost: results.reduce((a, r) => a + r.cost, 0),
  };
  console.log(`\nСцен без замечаний: ${sum.scenesOk}/${sum.scenesTotal} · полнота ${sum.completeness} · без лишнего ${sum.cleanliness} · ` +
    `сбоев ${sum.failures} · второй раунд в ${sum.secondRounds} · в среднем ${sum.avgSec} с · ${money(sum.cost)}`);
  report.models.push({ summary: sum, results });
}

mkdirSync(OUT, { recursive: true });
const stamp = report.at.replace(/[:.]/g, '-').slice(0, 19);
const base = join(OUT, `sync-${stamp}`);
writeFileSync(base + '.json', JSON.stringify(report, null, 1));
const md = [`# Учётчик: тестовые сцены — ${report.at.slice(0, 16).replace('T', ' ')}`, '', `Инструкция: ${style}; прогонов на сцену: ${runs}.`, '',
  '| Модель | Сцен без замечаний | Полнота | Без лишнего | Сбои | 2-й раунд | Ср. время | Стоимость |', '|---|---|---|---|---|---|---|---|',
  ...report.models.map(({ summary: s }) => `| ${s.model} | ${s.scenesOk}/${s.scenesTotal} | ${s.completeness} | ${s.cleanliness} | ${s.failures} | ${s.secondRounds} | ${s.avgSec} с | ${money(s.cost)} |`),
  ...report.models.flatMap(({ summary, results }) => ['', `## ${summary.model}`, '', ...results.map((r) => [
    `### ${r.ok ? '✓' : '✗'} ${r.title}`,
    ...r.failed.map((x) => `- не сделано: ${x}`), ...r.violated.map((x) => `- лишнее: ${x}`), r.error ? `- сбой: ${r.error}` : '',
    ...r.checks.map((x) => `- проверка полноты: ${x}`),
    ...r.calls.map((c) => `- \`${c.name} ${JSON.stringify(c.args)}\` → ${c.result}`),
  ].filter(Boolean).join('\n'))]),
].join('\n');
writeFileSync(base + '.md', md + '\n');
console.log(`\nОтчёт: ${base}.md`);
