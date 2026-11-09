// Общение с OpenRouter: запрос с цепочкой откатов, запись в диагностику,
// повтор запроса из диагностики и разбор служебной разметки, утёкшей в текст.

import { executeTool } from './tools.js';
import { recordRequest, explainError, getRequest } from './diag.js';

// Адрес можно переопределить (тесты подставляют свой сервер-заглушку).
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 120000;  // 2 минуты — с запасом на длинный ответ

// Модель учёта и служебных запросов: отдельная, если задана, иначе — модель рассказа.
export const toolModelOf = (state) => (state.toolModel && state.toolModel.trim() ? state.toolModel.trim() : state.model);

// Некоторые провайдеры/модели (особенно «думающие» варианты DeepSeek) не парсят
// вызовы инструментов в структурированный tool_calls, и разметка утекает в текст.
// Ниже — защита: очистка нарратива и аварийный разбор таких вызовов.

// Обрезает нарратив по первому маркеру утёкшей разметки инструментов.
export function stripToolMarkup(text) {
  if (!text) return text;
  const marker = text.search(/<[｜|]|｜DSML｜|<tool_calls|<tool_call|<function[_\s]|<invoke\b|\[tool_call/i);
  const cleaned = marker >= 0 ? text.slice(0, marker) : text;
  return cleaned.trim();
}

// Аварийный разбор утёкших вызовов инструментов из текста (best-effort).
// Извлекает значение из содержимого тега >VALUE<; пустые/неоднозначные параметры
// пропускает, чтобы не портить состояние.
export function parseLeakedToolCalls(raw) {
  if (!raw || !/invoke\s+name=/i.test(raw)) return [];
  const text = raw.replace(/｜/g, '|');
  const calls = [];
  const blocks = text.split(/<[^>]*?invoke\s+name=/i).slice(1);
  for (const blk of blocks) {
    const nameM = blk.match(/^\s*"?([a-z_]+)"?/i);
    if (!nameM) continue;
    const name = nameM[1];
    const args = {};
    const paramRe = /parameter\s+name="([a-z_]+)"[^>]*?>([^<]*)</gi;
    let pm;
    while ((pm = paramRe.exec(blk))) {
      const val = pm[2].trim();
      if (val) args[pm[1]] = val;
    }
    if (name && Object.keys(args).length) calls.push({ name, args });
  }
  return calls;
}

export function applyLeakedCalls(content, state) {
  const leaked = parseLeakedToolCalls(content);
  for (const c of leaked) executeTool(c.name, c.args, state);
  return leaked.length;
}

// Модели, которые отказались работать без reasoning, — чтобы не дёргать их дважды каждый ход.
const REASONING_MANDATORY = new Set();
const RELAXED = new Set(); // модели, которым параметры шлём по минимуму

// Модели, которые не принимают tool_choice: "required" — им шлём auto.
const AUTO_CHOICE = new Set();

// Запрос с цепочкой откатов: каждая несовместимость модели/провайдера с нашими
// параметрами чинится одним повтором и запоминается, чтобы не платить дважды.
// opts.timer — необязательный массив: сюда ложится время ответа модели (вместе
// с повторами при откатах — это и есть реальное ожидание) и расход токенов.
export async function callOpenRouter(opts) {
  const t0 = Date.now();
  const attempts = []; // откаты: какая ошибка и чем починили
  const capture = {};  // тело последнего запроса и сырая ошибка — для диагностики
  const note = (data, error) => {
    recordRequest({
      purpose: opts.purpose, model: o.model, ms: Date.now() - t0, attempts,
      body: capture.body, data, error, httpStatus: capture.status, rawError: capture.rawText,
    });
    if (!Array.isArray(opts.timer)) return;
    const u = data && data.usage;
    opts.timer.push({
      ms: Date.now() - t0,
      model: o.model,
      in: u && Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : undefined,
      out: u && Number.isFinite(u.completion_tokens) ? u.completion_tokens : undefined,
      cost: u && Number.isFinite(u.cost) ? u.cost : undefined,
      error: error ? true : undefined,
    });
  };
  let o = { ...opts, capture };
  const retry = (msg, fix, patch) => { attempts.push({ error: msg.slice(0, 300), fix }); o = { ...o, ...patch }; };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await postOpenRouter(o);
      note(data);
      return data;
    } catch (err) {
      const msg = String(err.message);
      // «Думающая» модель не даёт отключить reasoning.
      if ((o.tools || o.noReasoning) && !o._noReasoningFlag && /reasoning.*(mandatory|cannot be disabled)/i.test(msg)) {
        REASONING_MANDATORY.add(o.model); retry(msg, 'reasoning оставлен включённым', { _noReasoningFlag: true }); continue;
      }
      // Провайдер не умеет обязательный вызов инструментов.
      if (o.toolChoice === 'required' && /tool_choice|required/i.test(msg) && !/No endpoints found/i.test(msg)) {
        AUTO_CHOICE.add(o.model); retry(msg, 'tool_choice: required → auto', { toolChoice: 'auto' }); continue;
      }
      // Ни один провайдер не держит весь набор параметров — «мягкий» режим.
      if (!o._relaxed && /No endpoints found/i.test(msg)) {
        RELAXED.add(o.model); retry(msg, 'мягкий режим (без лишних параметров)', { _relaxed: true }); continue;
      }
      // В мягком режиме всё ещё нет провайдера — значит, мешает обязательный вызов.
      if (o._relaxed && o.toolChoice === 'required' && /No endpoints found/i.test(msg)) {
        AUTO_CHOICE.add(o.model); retry(msg, 'мягкий режим + tool_choice auto', { toolChoice: 'auto' }); continue;
      }
      note(null, msg);
      // Игроку — сначала понятное объяснение, потом сырой текст.
      const hint = explainError(msg);
      if (hint && !msg.startsWith(hint)) err.message = `${hint} (${msg.slice(0, 300)})`;
      throw err;
    }
  }
  const data = await postOpenRouter(o);
  note(data);
  return data;
}

export const DEFAULT_MAX_TOKENS = 16000;
async function postOpenRouter({ model, messages, apiKey, tools, temperature, frequencyPenalty, presencePenalty, maxTokens, toolChoice = 'auto', noReasoning = false, _noReasoningFlag = false, _relaxed = false, capture = {} }) {
  const relaxed = _relaxed || RELAXED.has(model);
  // usage.include — OpenRouter вернёт стоимость запроса.
  const body = { model, messages, usage: { include: true } };
  if (temperature !== undefined) body.temperature = temperature;
  // Потолок ответа. Без него зациклившаяся модель пишет до предела провайдера (131 тыс. токенов,
  // ~$0.9 и 10 минут за запрос — так было с тегами портрета). Свой потолок — у коротких служебных запросов.
  body.max_tokens = maxTokens || DEFAULT_MAX_TOKENS;
  if (!relaxed && frequencyPenalty) body.frequency_penalty = frequencyPenalty;
  if (!relaxed && presencePenalty) body.presence_penalty = presencePenalty;
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice === 'required' && !AUTO_CHOICE.has(model) ? 'required' : 'auto';
    // Маршрутизировать только на провайдеров, реально поддерживающих tools,
    // и отключить reasoning — «думающие» варианты чаще ломают вызовы.
    if (!relaxed) body.provider = { require_parameters: true };
    if (!relaxed && !_noReasoningFlag && !REASONING_MANDATORY.has(model)) body.reasoning = { enabled: false };
  } else if (noReasoning && !relaxed && !_noReasoningFlag && !REASONING_MANDATORY.has(model)) {
    // Служебные запросы без инструментов (сжатие, теги, заполнение полей) — тоже без «размышлений».
    body.reasoning = { enabled: false };
  }
  // Без таймаута зависший провайдер вешает весь ход: игрок не видит ни ответа,
  // ни ошибки, и не может ничего отправить заново.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  capture.body = body; capture.status = undefined; capture.rawText = undefined;
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'AI Storyteller',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Модель не ответила за ${Math.round(REQUEST_TIMEOUT_MS / 1000)} с. Попробуй отправить снова.`);
    }
    throw new Error(`Не удалось связаться с OpenRouter: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    capture.status = res.status; capture.rawText = text.slice(0, 4000);
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// Повтор запроса из диагностики: то же тело (можно с другой моделью), без откатов —
// чтобы увидеть, как модель отвечает именно на это. Состояние игры не меняется.
export async function replayRequest({ id, model, apiKey }) {
  const rec = await getRequest(id);
  if (!rec) throw new Error('Запись не найдена.');
  if (!rec.full || !rec.full.request) throw new Error('Полное тело этого запроса уже не хранится — повторить нельзя.');
  const body = { ...rec.full.request, usage: { include: true } };
  if (model && model.trim()) body.model = model.trim();
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  const base = { purpose: 'повтор: ' + rec.summary.purpose, model: body.model, body, replayOf: id, attempts: [] };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost', 'X-Title': 'AI Storyteller' },
      body: JSON.stringify(body), signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return recordRequest({ ...base, ms: Date.now() - t0, error: `OpenRouter ${res.status}: ${text.slice(0, 500)}`, httpStatus: res.status, rawError: text.slice(0, 4000) });
    }
    return recordRequest({ ...base, ms: Date.now() - t0, data: await res.json() });
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Модель не ответила за ${Math.round(REQUEST_TIMEOUT_MS / 1000)} с.` : `Не удалось связаться с OpenRouter: ${err.message}`;
    return recordRequest({ ...base, ms: Date.now() - t0, error: msg });
  } finally {
    clearTimeout(timer);
  }
}
