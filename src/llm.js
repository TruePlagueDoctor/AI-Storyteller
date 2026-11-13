// Общение с OpenRouter: запрос с цепочкой откатов, запись в диагностику,
// повтор запроса из диагностики и разбор служебной разметки, утёкшей в текст.

import { executeTool } from './tools.js';
import { recordRequest, explainError, getRequest } from './diag.js';

// Адрес можно переопределить (тесты подставляют свой сервер-заглушку).
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
// Предел ожидания одного запроса — на ВЕСЬ ответ. Раньше таймер снимался, как только приходили заголовки,
// а OpenRouter присылает их сразу и держит соединение, пока модель пишет: зависший ответ не обрывался вовсе.
// Теперь предел настоящий, поэтому он больше прежних 2 минут — длинный ответ «думающей» модели успеет.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 240000;

// Что сейчас запрошено у модели — чтобы игрок видел, чего ждёт ход, и мог его прервать.
// Ход — это несколько запросов подряд (персонажи, рассказчик, учёт); молчаливые «161 с» ничего не объясняли.
const inFlight = new Map(); // номер → { purpose, model, startedAt, ac }
let flightSeq = 0;
let turnCancelled = false;
export function requestsInFlight() {
  const now = Date.now();
  return [...inFlight.values()].map((r) => ({ purpose: r.purpose, model: r.model, sec: Math.round((now - r.startedAt) / 1000) }));
}
// Прервать ход: обрываются идущие запросы, а следующие запросы этого хода не начинаются.
export function cancelTurnRequests() {
  turnCancelled = true;
  for (const r of inFlight.values()) { r.cancelled = true; r.ac.abort(); }
}
export function resetTurnCancel() { turnCancelled = false; }
const CANCELLED = 'Ход прерван.';

// Отказ из-за содержания: фильтр провайдера (PROHIBITED_CONTENT у Gemini, модерация у других).
// Приходит либо ошибкой, либо ответом 200 без текста с причиной остановки. Это не сбой связи: повтор той же
// моделью бесполезен, зато запрос может взять запасная модель.
const REFUSAL_RE = /PROHIBITED_CONTENT|blockReason|content_filter|content[ _]policy|moderation|flagged|RECITATION|(^|\W)SAFETY(\W|$)/i;
export function isContentRefusal(x) {
  if (typeof x === 'string') return REFUSAL_RE.test(x);
  const ch = x && x.choices && x.choices[0];
  if (!ch) return false;
  const text = ch.message && typeof ch.message.content === 'string' ? ch.message.content.trim() : '';
  const calls = (ch.message && ch.message.tool_calls) || [];
  return !text && !calls.length && REFUSAL_RE.test(`${ch.finish_reason || ''} ${ch.native_finish_reason || ''}`);
}
const refusalError = (data) => {
  const ch = data.choices[0];
  return new Error(`Модель отказалась из-за содержания (${ch.native_finish_reason || ch.finish_reason}).`);
};

// Модель учёта и служебных запросов: отдельная, если задана, иначе — модель рассказа.
export const toolModelOf = (state) => (state.toolModel && state.toolModel.trim() ? state.toolModel.trim() : state.model);
// Модель, которая составляет описание картинки (теги для портрета, сцены, статьи кодекса): своя, если задана, иначе модель учёта.
// Отдельная нужна, когда модель учёта плохо знает теги или отказывается описывать откровенные сцены.
export const artModelOf = (state) => (state.artModel && state.artModel.trim() ? state.artModel.trim() : toolModelOf(state));

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
      fallback: o._fellBack ? true : undefined,
      in: u && Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : undefined,
      cached: u && Number.isFinite(u.prompt_tokens_details?.cached_tokens) ? u.prompt_tokens_details.cached_tokens : undefined,
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
      if (isContentRefusal(data)) throw refusalError(data);
      note(data);
      return data;
    } catch (err) {
      const msg = String(err.message);
      // Отказ по содержанию: один раз пробуем запасную модель, если она задана и это другая модель.
      const backup = String(o.fallbackModel || '').trim();
      if (isContentRefusal(msg) && backup && backup !== o.model && !o._fellBack) {
        retry(msg, `запасная модель ${backup}: основная отказала из-за содержания`, { model: backup, _fellBack: true });
        continue;
      }
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
  if (isContentRefusal(data)) { const e = refusalError(data); note(null, e.message); throw e; }
  note(data);
  return data;
}

export const DEFAULT_MAX_TOKENS = 16000;
async function postOpenRouter({ model, messages, apiKey, tools, temperature, frequencyPenalty, presencePenalty, maxTokens, toolChoice = 'auto', noReasoning = false, _noReasoningFlag = false, _relaxed = false, capture = {}, purpose = 'запрос', timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (turnCancelled) throw new Error(CANCELLED);
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
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const flight = { purpose, model, startedAt: Date.now(), ac };
  const flightId = ++flightSeq;
  inFlight.set(flightId, flight);
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
    if (flight.cancelled) throw new Error(CANCELLED);
    if (err.name === 'AbortError') {
      throw new Error(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с. Попробуй отправить снова.`);
    }
    throw new Error(`Не удалось связаться с OpenRouter: ${err.message}`);
  } finally {
    // Ответ ещё читается ниже (тело может идти долго) — запрос считается идущим до конца чтения.
    if (!res || !res.ok) { clearTimeout(timer); inFlight.delete(flightId); }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    capture.status = res.status; capture.rawText = text.slice(0, 4000);
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 500)}`);
  }
  try {
    return await res.json();
  } catch (err) {
    if (flight.cancelled) throw new Error(CANCELLED);
    if (err.name === 'AbortError') throw new Error(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с. Попробуй отправить снова.`);
    throw new Error(`Ответ модели оборвался: ${err.message}`);
  } finally {
    clearTimeout(timer); inFlight.delete(flightId);
  }
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
