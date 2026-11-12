// Отказ модели из-за содержания (фильтр провайдера, например PROHIBITED_CONTENT у Gemini):
// понятное объяснение и запасная модель рассказчика, которая подхватывает ход.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, reply, call } from './fake-llm.js';
import { callOpenRouter, isContentRefusal } from '../src/llm.js';
import { explainError } from '../src/diag.js';
import { runTurn } from '../src/turn.js';
import { makeState } from './helpers.js';

let fake;
afterEach(() => fake && fake.restore());
const blocked200 = () => ({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'PROHIBITED_CONTENT', message: { role: 'assistant', content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 0 } });
const base = { purpose: 'рассказчик', model: 'google/gemini', apiKey: 'k', messages: [{ role: 'user', content: 'x' }] };

test('отказ по содержанию распознаётся: и как ошибка, и как пустой ответ с причиной', () => {
  assert.equal(isContentRefusal('OpenRouter 400: {"error":{"message":"Provider returned error","metadata":{"raw":"blockReason: PROHIBITED_CONTENT"}}}'), true);
  assert.equal(isContentRefusal('OpenRouter 403: flagged by moderation'), true);
  assert.equal(isContentRefusal('OpenRouter 429: rate limit'), false);
  assert.equal(isContentRefusal('Модель не ответила за 240 с.'), false);
  assert.match(explainError('OpenRouter 400: PROHIBITED_CONTENT'), /отказал[аи]?с?ь? из-за содержания|фильтр/i);
});

test('без запасной модели — понятная ошибка, а не «пустой ответ»', async () => {
  fake = installFakeFetch([blocked200()]);
  await assert.rejects(callOpenRouter(base), /из-за содержания[\s\S]*PROHIBITED_CONTENT/);
  fake.restore();
  fake = installFakeFetch([{ status: 400, text: '{"error":{"message":"PROHIBITED_CONTENT"}}' }]);
  await assert.rejects(callOpenRouter(base), /из-за содержания/);
});

test('запасная модель подхватывает запрос: и после ошибки, и после пустого ответа с причиной', async () => {
  for (const first of [blocked200(), { status: 400, text: '{"error":{"message":"blockReason: PROHIBITED_CONTENT"}}' }]) {
    fake = installFakeFetch([first, (body) => { assert.equal(body.model, 'deepseek/flash'); return reply('Сцена продолжается.'); }]);
    const timer = [];
    const data = await callOpenRouter({ ...base, fallbackModel: 'deepseek/flash', timer });
    assert.equal(data.choices[0].message.content, 'Сцена продолжается.');
    assert.equal(timer.at(-1).model, 'deepseek/flash');
    assert.equal(timer.at(-1).fallback, true);
    fake.restore();
  }
  // Обычный сбой запасную модель не включает.
  fake = installFakeFetch([{ status: 500, text: 'boom' }]);
  await assert.rejects(callOpenRouter({ ...base, fallbackModel: 'deepseek/flash' }), /500/);
  assert.equal(fake.requests.length, 1);
});

test('ход: основная модель отказала — ответ пишет запасная, под ответом об этом сказано', async () => {
  const st = makeState({ model: 'google/gemini', fallbackModel: 'deepseek/flash', diceEnabled: false, messages: [{ role: 'user', content: 'Иду дальше' }] });
  fake = installFakeFetch([blocked200(), reply('Ты идёшь дальше. Коридор пуст.'), reply('', [call('nothing', {})])]);
  const out = await runTurn({ state: st, apiKey: 'k' });
  assert.equal(out.narration, 'Ты идёшь дальше. Коридор пуст.');
  assert.match(out.fallbackNote, /google\/gemini[\s\S]*deepseek\/flash/);
  assert.equal(fake.requests[1].model, 'deepseek/flash');
});

test('запасная совпадает с основной или не задана — повтора нет', async () => {
  fake = installFakeFetch([blocked200()]);
  await assert.rejects(callOpenRouter({ ...base, fallbackModel: 'google/gemini' }), /из-за содержания/);
  assert.equal(fake.requests.length, 1);
});
