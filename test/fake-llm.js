// Подмена fetch для запросов к модели: каждый ответ берётся из очереди сценария.
// Элемент очереди — функция (body) => ответ | { status, text } | Error, или готовый ответ.
export function reply(content, toolCalls = [], finish = 'stop') {
  return {
    choices: [{ finish_reason: finish, message: { role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}
let seq = 0;
export const call = (name, args) => ({ id: `c${++seq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

export function installFakeFetch(queue) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    let next = queue.shift();
    if (next === undefined) throw new Error('fake-llm: очередь ответов пуста');
    if (typeof next === 'function') next = await next(body);
    if (next instanceof Error) throw next;
    if (next && next.status) {
      return { ok: false, status: next.status, text: async () => next.text || '', json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => next, text: async () => JSON.stringify(next) };
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}
