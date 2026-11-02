// Разметка текста, журнал и сводка учёта, время ответа моделей.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

// ---- Журнал учёта: что модель записала за ход ----
const TOOL_LABEL = {
  block: 'лист', create_block: 'лист', update_block: 'лист', remove_block: 'лист',
  npc: 'НПС', create_npc: 'НПС', update_npc: 'НПС', remove_npc: 'НПС',
  scene: 'сцена', event: 'факт', thread: 'нить', update_hero: 'герой', record_lore: 'мир', nothing: '—',
};
// Короткая строка «что сделано» из аргументов вызова.
function describeCall(c) {
  const a = c.args || {};
  switch (c.name) {
    case 'block': case 'create_block': case 'update_block': case 'remove_block': {
      const rm = a.action === 'remove' || c.name === 'remove_block';
      return `${rm ? '− ' : ''}${a.name || '?'}${!rm && a.value ? ': ' + a.value + (a.max ? ' / ' + a.max : '') : ''}${a.character ? ' (' + a.character + ')' : ''}`;
    }
    case 'npc': case 'create_npc': case 'update_npc': case 'remove_npc': {
      if (a.action === 'archive' || c.name === 'remove_npc') return `${a.name} → в архив`;
      const fields = Object.keys(a).filter((k) => !['name', 'action'].includes(k));
      return `${a.name}${a.new_name ? ' → ' + a.new_name : ''}${fields.length ? ': ' + fields.map((k) => k === 'attitude' ? 'отношение «' + a[k] + '»' : k === 'status' ? 'статус «' + a[k] + '»' : k === 'voice_sample' ? 'реплика' : k).join(', ') : ''}`;
    }
    case 'scene': return [a.location, a.elapsed_minutes ? '+' + a.elapsed_minutes + ' мин' : '', a.time, a.present ? 'рядом: ' + (a.present || 'никого') : '', a.note].filter(Boolean).join(' · ');
    case 'event': return a.action === 'close' ? `закрыто ${a.id || ''}${a.outcome ? ` (${OUTCOME_LABEL[a.outcome] || a.outcome})` : ''}${a.text ? ': ' + a.text : ''}`
      : a.action === 'update' ? `поправлено ${a.id || ''}: ${a.text || a.when || ''}` : `${a.text || ''}${a.when ? ` ⏱ ${a.when}` : ''}`;
    case 'thread': return `${a.title || ''}${a.action && a.action !== 'update' ? ' — ' + a.action : ''}${a.progress ? ': ' + a.progress : ''}`;
    case 'nothing': return 'без изменений';
    default: return Object.values(a).join(' · ');
  }
}
// ---- Сводка учёта: по журналам всех ходов, отдельно по каждой модели ----
const STAT_TOOLS = [['block', 'лист'], ['npc', 'НПС'], ['scene', 'сцена'], ['event', 'факты'], ['thread', 'нити']];
const TOOL_GROUP = { create_block: 'block', update_block: 'block', remove_block: 'block', create_npc: 'npc', update_npc: 'npc', remove_npc: 'npc' };
function syncStats(log) {
  const by = new Map();
  const add = (s) => {
    if (!s || !s.status || s.status === 'inline') return;
    const key = s.model ? shortModel(s.model) : 'модель не записана';
    if (!by.has(key)) by.set(key, { turns: 0, calls: 0, warn: 0, fix: 0, nothing: 0, skipped: 0, failed: 0, tools: {}, ms: 0, timed: 0 });
    const m = by.get(key);
    m.turns++;
    if (s.timing && s.timing.length) { m.ms += sumMs(s.timing); m.timed++; }
    if (s.status === 'skipped') { m.skipped++; return; }
    if (s.status === 'failed') m.failed++;
    const calls = s.calls || [];
    const real = calls.filter((c) => c.name !== 'nothing' && !c.check);
    if (!real.length && s.status !== 'failed') m.nothing++;
    if (calls.some((c) => c.round > 1)) m.fix++;
    for (const c of real) {
      m.calls++;
      if (c.warn) m.warn++;
      const g = TOOL_GROUP[c.name] || c.name;
      m.tools[g] = (m.tools[g] || 0) + 1;
    }
  };
  for (const e of log || []) {
    if (e.role !== 'narrator') continue;
    add(e.sync);
    for (const p of e.syncHistory || []) add(p);
  }
  return by;
}
function renderSyncStats() {
  const body = $('syncStatsBody');
  const by = syncStats(app.log);
  body.innerHTML = '';
  if (!by.size) { body.textContent = 'Пока нет ходов с журналом учёта.'; return; }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const table = document.createElement('table');
  table.className = 'stats-table';
  const head = ['модель', 'ходов', 'записей / ход', 'время / ход', ...STAT_TOOLS.map(([, l]) => l), 'предупр.', '2-й раунд', 'без изм.', 'пропуск', 'сбой'];
  table.innerHTML = '<thead><tr>' + head.map((h) => `<th>${h}</th>`).join('') + '</tr></thead>';
  const tb = document.createElement('tbody');
  for (const [model, m] of by) {
    const active = m.turns - m.skipped;
    const cells = [
      model, m.turns, active ? (m.calls / active).toFixed(1) : '—', m.timed ? fmtSec(m.ms / m.timed) : '—',
      ...STAT_TOOLS.map(([k]) => m.tools[k] || 0),
      pct(m.warn, m.calls), pct(m.fix, active), pct(m.nothing, active), pct(m.skipped, m.turns), m.failed,
    ];
    const tr = document.createElement('tr');
    for (const c of cells) { const td = document.createElement('td'); td.textContent = String(c); tr.appendChild(td); }
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  // Рассказчик — отдельной строкой: его модель от модели учёта не зависит.
  const narr = new Map();
  for (const e of app.log || []) {
    const list = e.role === 'narrator' && e.timing && e.timing.narrate;
    if (!list || !list.length) continue;
    const k = shortModel(list[0].model) || '?';
    if (!narr.has(k)) narr.set(k, { ms: 0, n: 0 });
    const r = narr.get(k); r.ms += sumMs(list.filter((t) => !t.cont)); r.n++;
  }
  if (narr.size) {
    const p = document.createElement('p');
    p.className = 'stats-narr';
    p.textContent = 'Рассказчик, среднее время ответа: ' + [...narr].map(([k, r]) => `${k} — ${fmtSec(r.ms / r.n)} (${r.n} ${plural(r.n, 'ход', 'хода', 'ходов')})`).join('; ');
    body.appendChild(p);
  }
  body.appendChild(table);
}

// ---- Время ответа моделей ----
const sumMs = (list) => (list || []).reduce((a, t) => a + (Number(t.ms) || 0), 0);
const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' с';
const fmtTok = (n) => (n == null ? '?' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(n));
function renderTiming(entry) {
  const tm = entry.timing || {};
  const parts = [
    ['рассказ', tm.narrate || []],
    ['учёт', (entry.sync && entry.sync.timing) || []],
    ['сжатие', tm.summary || []],
  ].filter(([, list]) => list.length);
  if (!parts.length) return null;
  const total = parts.reduce((a, [, l]) => a + sumMs(l), 0);
  const el = document.createElement('div');
  el.className = 'turn-timing';
  el.textContent = '⏱ ' + fmtSec(total) + ' — ' + parts.map(([k, l]) => `${k} ${fmtSec(sumMs(l))}`).join(' · ');
  // Подробности — по каждому запросу: время, токены на вход → выход, модель.
  const lines = [];
  for (const [k, list] of parts) {
    list.forEach((t, i) => {
      lines.push(`${k}${list.length > 1 ? ' #' + (i + 1) : ''}${t.cont ? ' (договорить)' : ''}: ${fmtSec(t.ms)}` +
        `, токены ${fmtTok(t.in)} → ${fmtTok(t.out)}` + (t.model ? `, ${shortModel(t.model)}` : '') + (t.error ? ' — ошибка' : ''));
    });
  }
  const tokIn = parts.reduce((a, [, l]) => a + l.reduce((b, t) => b + (t.in || 0), 0), 0);
  const tokOut = parts.reduce((a, [, l]) => a + l.reduce((b, t) => b + (t.out || 0), 0), 0);
  if (tokIn || tokOut) lines.push(`всего токенов: ${fmtTok(tokIn)} → ${fmtTok(tokOut)}`);
  el.title = lines.join('\n');
  return el;
}

const shortModel = (m) => String(m || '').replace(/^.*\//, '').replace(/:.*$/, '');
async function resyncTurn(btn) {
  if (sending) return;
  const current = app.toolModel || app.model || '';
  const model = prompt('Переучесть ход. Модель учёта (слаг OpenRouter) — оставь как есть или впиши другую для сравнения:', current);
  if (model === null) return;
  sending = true;
  btn.disabled = true;
  btn.textContent = '↻ переучитываю…';
  try {
    const data = await api('/api/resync', { method: 'POST', body: JSON.stringify({ model: model.trim() }) });
    applyFullState(data);
    toast('Ход переучтён. Прежний журнал — внутри, под новым.');
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = '↻ переучесть ход';
  } finally { endBusy({ focus: false }); }
}

function renderSyncJournal(sync, prefix = '') {
  const calls = sync.calls || [];
  const real = calls.filter((c) => c.name !== 'nothing' && !c.check);
  const warns = calls.filter((c) => c.warn && !c.check).length;
  const checked = calls.some((c) => c.check);
  const box = document.createElement('details');
  box.className = 'sync-log' + (sync.status === 'failed' ? ' failed' : '') + (warns ? ' has-warn' : '');
  const sum = document.createElement('summary');
  let label;
  if (sync.status === 'skipped') label = 'учёт пропущен — короткий ход без признаков перемен';
  else if (sync.status === 'failed' && !calls.length) label = 'учёт не сработал';
  else if (!real.length) label = 'учёт: без изменений';
  else label = `учёт: ${real.length} ${plural(real.length, 'запись', 'записи', 'записей')}`;
  if (sync.status === 'inline') label = label.replace('учёт', 'рассказчик');
  if (sync.status === 'failed' && calls.length) label += ' · сбой';
  if (warns) label += ` · ⚠ ${warns}`;
  if (checked) label += ' · дозапрос по полноте';
  else if (calls.some((c) => c.round > 1)) label += ' · с исправлением';
  if (sync.model) label = label.replace(/^(учёт|рассказчик)/, `$1 · ${shortModel(sync.model)}`);
  if (sync.resynced) label += ' · переучтено';
  sum.textContent = (prefix ? '' : '📋 ') + prefix + label;
  box.appendChild(sum);
  if (sync.error) {
    const e = document.createElement('div');
    e.className = 'sync-error';
    e.textContent = sync.error;
    box.appendChild(e);
  }
  for (const c of calls) {
    const row = document.createElement('div');
    row.className = 'sync-row' + (c.warn ? ' warn' : '') + (c.round > 1 ? ' fix' : '');
    const tag = document.createElement('span');
    tag.className = 'sync-tag';
    tag.textContent = c.check ? 'полнота' : (TOOL_LABEL[c.name] || c.name) + (c.round > 1 ? ' ↺' : '') + (c.cont ? ' +' : '') + (c.leaked ? ' ⚑' : '');
    const what = document.createElement('span');
    what.className = 'sync-what';
    what.textContent = c.check ? 'код заметил возможный пропуск и попросил дописать:' : describeCall(c);
    const res = document.createElement('div');
    res.className = 'sync-res';
    res.textContent = c.result;
    row.append(tag, what, res);
    row.title = JSON.stringify(c.args, null, 1);
    box.appendChild(row);
  }
  return box;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function renderRichText(container, text) {
  // Пустая строка — граница абзаца: абзацы рисуем блоками с отступом, а не
  // двумя переводами строки — так текст плотнее и ровнее.
  // Внутри абзаца разбираем построчно: реплика через тире опознаётся только в
  // начале строки, иначе пунктуационное тире («коридор — узкий») попало бы под подсветку.
  const paras = String(text).replace(/\r/g, '').split(/\n[ \t]*\n+/);
  for (const para of paras) {
    if (!para.trim()) continue;
    const p = document.createElement('div');
    p.className = 'tx-p';
    para.split('\n').forEach((line, li) => {
      if (li > 0) p.appendChild(document.createElement('br'));
      renderLine(p, line);
    });
    container.appendChild(p);
  }
}

// ---- Разметка текста ----
// Речь в кавычках («…», "…") и действия/мысли в *…* подсвечиваются,
// чтобы полотно прозы читалось глазами, а не сплошняком.
// Речь в кавычках и действия в *…*.
const INLINE_RE = /(«[^»]*»|"[^"]*"|\*[^*\n]+\*)/g;
// Тире, начинающее реплику.
const DASH_START = /^(\s*)([—–])(\s)/;
// Слова автора внутри реплики: « — сказал он» или « — Она щурится.»
const AUTHOR_BREAK = /\s[—–]\s/;

function renderLine(container, line) {
  const dash = line.match(DASH_START);
  if (!dash) { renderInline(container, line); return; }

  const who = speakerFace(line);
  if (who) {
    // Реплика с портретом: лицо слева, текст обтекает — как в визуальной новелле.
    const row = document.createElement('span');
    row.className = 'tx-dialogue';
    const face = document.createElement('span');
    face.className = 'tx-face';
    face.title = who.name;
    face.style.backgroundImage = `url('/avatars/${who.avatar}')`;
    face.addEventListener('click', () => showImage(who.avatar, who.name));
    row.appendChild(face);
    const body = document.createElement('span');
    body.className = 'tx-dialogue-body';
    row.appendChild(body);
    container.appendChild(row);
    container = body;
  }
  container.appendChild(document.createTextNode(dash[1]));
  let rest = line.slice(dash[1].length);
  let isSpeech = true;

  // Реплика и слова автора чередуются, разделённые « — ».
  while (rest.length) {
    const brk = rest.search(AUTHOR_BREAK);
    if (brk === -1) {
      if (isSpeech) appendSpeech(container, rest); else renderInline(container, rest);
      break;
    }
    const chunk = rest.slice(0, brk);
    if (isSpeech) appendSpeech(container, chunk); else renderInline(container, chunk);
    // Разделитель « — » всегда обычным текстом.
    container.appendChild(document.createTextNode(rest.slice(brk, brk + 3)));
    rest = rest.slice(brk + 3);
    isSpeech = !isSpeech;
  }
}

function appendSpeech(container, str) {
  if (!str) return;
  const span = document.createElement('span');
  span.className = 'tx-speech';
  span.textContent = str;
  container.appendChild(span);
}

// Подсветка кавычек и звёздочек внутри произвольного куска.
function renderInline(container, text) {
  let last = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
    const token = m[0];
    const span = document.createElement('span');
    if (token.startsWith('*')) {
      span.className = 'tx-action';
      span.textContent = token.slice(1, -1);
    } else {
      span.className = 'tx-speech';
      span.textContent = token;
    }
    container.appendChild(span);
    last = m.index + token.length;
  }
  if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
}
