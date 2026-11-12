// Диагностика запросов к модели: что ушло, что вернулось, сколько стоило,
// какие откаты сработали и почему упало. Хранится в data/diag:
//   requests.json — последние MAX_RECORDS кратких записей (без тел);
//   full/<id>.json — полные тела запроса и ответа для последних MAX_FULL.
// Пишется в фоне: диагностика никогда не должна ронять ход.

import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DIAG_DIR } from './paths.js';

const LIST_PATH = join(DIAG_DIR, 'requests.json');
const FULL_DIR = join(DIAG_DIR, 'full');
const MAX_RECORDS = 100;
const MAX_FULL = 20;

let records = null; // новые — в конце
let writing = Promise.resolve();

async function load() {
  if (records) return records;
  try { records = JSON.parse(await readFile(LIST_PATH, 'utf8')); if (!Array.isArray(records)) records = []; }
  catch { records = []; }
  return records;
}

// Человеческое объяснение ошибки OpenRouter/сети и что с ней делать.
export function explainError(raw) {
  const m = String(raw || '');
  const status = Number((m.match(/OpenRouter (\d{3})/) || [])[1]) || 0;
  if (/не ответила за|AbortError|timeout/i.test(m)) return 'Модель не уложилась в отведённое время. Провайдер перегружен или модель долго «думает» — повторите или выберите модель побыстрее.';
  if (/Не удалось связаться|fetch failed|ENOTFOUND|ECONNRE|EAI_AGAIN/i.test(m)) return 'Нет связи с OpenRouter: проверьте интернет, VPN или прокси.';
  if (/No endpoints found/i.test(m)) return 'Ни один провайдер этой модели не принимает такой запрос (инструменты, параметры) или модель снята. Выберите другую модель.';
  if (/reasoning.*(mandatory|cannot be disabled)/i.test(m)) return 'Модель работает только с включённым рассуждением — это обходится автоматически; если ошибка осталась, смените модель.';
  if (/context length|maximum context|too many tokens|context_length/i.test(m)) return 'Запрос не влезает в контекст модели: сократите историю (сжатие), лор или выберите модель с большим контекстом.';
  if (/is not a valid model|model.*not found|invalid model/i.test(m)) return 'Такой модели нет: проверьте её идентификатор в настройках (например, «deepseek/deepseek-chat»).';
  if (/PROHIBITED_CONTENT|blockReason|content_filter|из-за содержания|moderation|flagged|content policy|safety/i.test(m)) return 'Модель отказалась из-за содержания: сработал фильтр провайдера (из игры он не отключается, и проверяет он весь запрос — историю и кодекс тоже). Перегенерируй ход другой моделью или укажи запасную модель в настройках — она подхватит такие ходы сама.';
  switch (status) {
    case 400: return 'Модель не приняла запрос (неподдерживаемый параметр или формат). Подробности — в сыром тексте ошибки ниже.';
    case 401: return 'Ключ OpenRouter не подходит: проверьте OPENROUTER_API_KEY в .env и перезапустите сервер.';
    case 402: return 'На счёте OpenRouter закончились деньги или исчерпан лимит ключа. Пополните баланс или поднимите лимит.';
    case 403: return 'Доступ запрещён: модель недоступна для вашего ключа или региона, либо сработала модерация.';
    case 404: return 'Модель или провайдер не найдены. Проверьте идентификатор модели.';
    case 408: return 'Провайдер не дождался запроса — повторите.';
    case 413: return 'Запрос слишком большой для модели — сократите историю или лор.';
    case 429: return 'Слишком много запросов: у бесплатных моделей жёсткий лимит, у платных — временная перегрузка. Подождите минуту или смените модель.';
    case 500: case 502: case 503: case 504: case 520: case 524: case 529:
      return 'Сбой на стороне провайдера модели. Обычно проходит само — повторите через минуту или выберите другую модель.';
    default: return '';
  }
}

// Краткая оценка ответа: что в нём подозрительного, даже если HTTP 200.
function inspectResponse(data, purpose) {
  const warn = [];
  const ch = data?.choices?.[0];
  const msg = ch?.message || {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  if (!ch) warn.push('в ответе нет choices');
  if (data?.error) warn.push('ошибка внутри ответа: ' + String(data.error.message || JSON.stringify(data.error)).slice(0, 200));
  if (ch && !content.trim() && !calls.length) warn.push('пустой ответ');
  if (ch?.finish_reason === 'length') warn.push('ответ оборван по длине');
  for (const c of calls) {
    try { JSON.parse(c.function?.arguments || '{}'); } catch { warn.push(`битые аргументы у ${c.function?.name || 'вызова'}`); }
  }
  if (/учётчик/.test(purpose) && ch && !calls.length && content.trim()) warn.push('учётчик ответил текстом вместо вызовов');
  return { warn, contentLength: content.length, toolCalls: calls.map((c) => c.function?.name).filter(Boolean) };
}

// rec: { purpose, model, ms, attempts:[{error, fix}], body, data?, error?, status? }
export function recordRequest(rec) {
  const id = randomUUID();
  const ok = !rec.error;
  const info = ok ? inspectResponse(rec.data, rec.purpose || '') : { warn: [], contentLength: 0, toolCalls: [] };
  const u = rec.data?.usage || {};
  const ch = rec.data?.choices?.[0];
  const summary = {
    id,
    at: new Date().toISOString(),
    slot: rec.slot || undefined,
    purpose: rec.purpose || 'запрос',
    model: rec.model,
    provider: rec.data?.provider || undefined,
    ms: rec.ms,
    status: ok ? (info.warn.length ? 'warn' : 'ok') : 'error',
    httpStatus: rec.httpStatus || undefined,
    finish: ch ? (ch.finish_reason || ch.native_finish_reason || '') : undefined,
    in: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : undefined,
    cached: Number.isFinite(u.prompt_tokens_details?.cached_tokens) ? u.prompt_tokens_details.cached_tokens : undefined, // сколько входа взято из кэша провайдера
    out: Number.isFinite(u.completion_tokens) ? u.completion_tokens : undefined,
    reasoning: Number.isFinite(u.completion_tokens_details?.reasoning_tokens) ? u.completion_tokens_details.reasoning_tokens : undefined,
    cost: Number.isFinite(u.cost) ? u.cost : undefined,
    fallbacks: (rec.attempts || []).map((a) => a.fix),
    attemptErrors: (rec.attempts || []).map((a) => String(a.error).slice(0, 300)),
    error: rec.error ? String(rec.error).slice(0, 1500) : undefined,
    hint: rec.error ? explainError(rec.error) || undefined : undefined,
    warn: info.warn.length ? info.warn : undefined,
    contentLength: info.contentLength,
    toolCalls: info.toolCalls.length ? info.toolCalls : undefined,
    messages: Array.isArray(rec.body?.messages) ? rec.body.messages.length : undefined,
    replayOf: rec.replayOf || undefined,
  };
  const full = { id, request: rec.body || null, response: rec.data ?? null, rawError: rec.rawError || rec.error || null };
  writing = writing.then(() => persist(summary, full)).catch((e) => console.warn('[diag]', e.message));
  return summary;
}

async function persist(summary, full) {
  await load();
  records.push(summary);
  const dropped = records.length > MAX_RECORDS ? records.splice(0, records.length - MAX_RECORDS) : [];
  await mkdir(FULL_DIR, { recursive: true });
  // Ключ в теле не хранится (он в заголовке), но на всякий случай — без него.
  await writeFile(join(FULL_DIR, summary.id + '.json'), JSON.stringify(full));
  await writeFile(LIST_PATH, JSON.stringify(records));
  // Полные тела — только у последних MAX_FULL.
  const keep = new Set(records.slice(-MAX_FULL).map((r) => r.id));
  for (const r of records) r.hasFull = keep.has(r.id);
  const files = await readdir(FULL_DIR).catch(() => []);
  for (const f of files) if (!keep.has(f.replace(/\.json$/, ''))) await unlink(join(FULL_DIR, f)).catch(() => {});
  void dropped;
}

export async function listRequests() {
  await writing;
  await load();
  const keep = new Set(records.slice(-MAX_FULL).map((r) => r.id));
  return records.map((r) => ({ ...r, hasFull: keep.has(r.id) })).reverse();
}

export async function getRequest(id) {
  await writing;
  await load();
  const summary = records.find((r) => r.id === id);
  if (!summary) return null;
  let full = null;
  try { full = JSON.parse(await readFile(join(FULL_DIR, id + '.json'), 'utf8')); } catch { /* тело уже вытеснено */ }
  return { summary, full };
}

export async function clearRequests() {
  await writing;
  records = [];
  await mkdir(FULL_DIR, { recursive: true });
  for (const f of await readdir(FULL_DIR).catch(() => [])) await unlink(join(FULL_DIR, f)).catch(() => {});
  await writeFile(LIST_PATH, '[]');
}

// Сводка для плашки: сколько ошибок/предупреждений после метки времени.
export async function diagCounts(since) {
  await writing;
  await load();
  const t = since ? Date.parse(since) : 0;
  const recent = records.filter((r) => Date.parse(r.at) > t);
  return { errors: recent.filter((r) => r.status === 'error').length, warns: recent.filter((r) => r.status === 'warn').length, last: records.at(-1)?.at || null };
}
