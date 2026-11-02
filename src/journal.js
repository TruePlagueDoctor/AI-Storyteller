// Журнал учёта: каждый вызов инструмента (и в рассказе, и в учёте) ложится в журнал хода —
// игрок видит, что модель записала и что ответили инструменты.

// Ответ инструмента, после которого учётчику нужен второй раунд — исправить.
export const FIX_SIGNAL = /^Ошибка|ВНИМАНИЕ|не найден|закрывать нечего|Похожей записи нет/i;

function compactArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) out[k] = v.map(String).join(', ').slice(0, 200); continue; }
    if (typeof v === 'object') { out[k] = JSON.stringify(v).slice(0, 200); continue; }
    const str = String(v);
    out[k] = str.length > 200 ? str.slice(0, 199) + '…' : str;
  }
  return out;
}
export function journalEntry(name, args, result, round, extra = {}) {
  const res = String(result ?? '');
  return { name, args: compactArgs(args), result: res.length > 300 ? res.slice(0, 299) + '…' : res, round, warn: FIX_SIGNAL.test(res), ...extra };
}
