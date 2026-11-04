// Диагностика запросов к модели.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

// ---- Диагностика запросов ----
const DIAG_SEEN_KEY = 'diagSeenAt';
let diagItems = [];
let diagSelected = null;
const diagSeen = () => { try { return localStorage.getItem(DIAG_SEEN_KEY) || ''; } catch { return ''; } };
async function refreshDiagBadge() {
  try {
    const c = await api('/api/diag/counts?since=' + encodeURIComponent(diagSeen()));
    const dot = $('diagDot');
    dot.hidden = !(c.errors || c.warns);
    dot.classList.toggle('warn', !c.errors && c.warns > 0);
    $('diagBtn').title = c.errors || c.warns
      ? `Диагностика: новых ошибок ${c.errors}, предупреждений ${c.warns}`
      : 'Диагностика: запросы к модели и ошибки';
  } catch { /* не критично */ }
}
const DIAG_ICON = { ok: '✓', warn: '⚠', error: '✗' };
const fmtMs = (ms) => (ms >= 10000 ? Math.round(ms / 1000) + ' с' : (ms / 1000).toFixed(1) + ' с');
const fmtCost = (c) => (c === undefined ? '' : c < 0.01 ? '$' + c.toFixed(5) : '$' + c.toFixed(3));
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (d.toDateString() === new Date().toDateString() ? '' : ' ' + d.toLocaleDateString('ru-RU')); };
function diagMatches(r, f) {
  if (!f) return true;
  if (f === 'problem') return r.status !== 'ok';
  if (f === 'other') return !/рассказчик|учётчик/.test(r.purpose);
  return r.purpose.includes(f);
}
function renderDiagList() {
  const list = $('diagList'); list.innerHTML = '';
  const f = $('diagFilter').value;
  const shown = diagItems.filter((r) => diagMatches(r, f));
  if (!shown.length) {
    const p = document.createElement('p'); p.className = 'sheet-empty';
    p.textContent = diagItems.length ? 'Под фильтр ничего не попало.' : 'Запросов пока не было. Сделайте ход — здесь появится каждое обращение к модели.';
    list.appendChild(p); return;
  }
  for (const r of shown) {
    const el = document.createElement('div');
    el.className = 'diag-item ' + r.status + (r.id === diagSelected ? ' active' : '');
    el.dataset.id = r.id;
    const tokens = r.in !== undefined ? `${r.in}→${r.out ?? '?'} ток` : '';
    el.innerHTML = `<div class="diag-item-top"><span class="diag-purpose"><span class="diag-ico">${DIAG_ICON[r.status]}</span> ${esc(r.purpose)}</span><span class="diag-mini">${fmtTime(r.at)}</span></div>` +
      `<div class="diag-mini">${esc(r.model || '')} · ${fmtMs(r.ms || 0)}${tokens ? ' · ' + tokens : ''}${r.cost !== undefined ? ' · ' + fmtCost(r.cost) : ''}</div>` +
      (r.status !== 'ok' ? `<div class="diag-mini" style="color:var(--${r.status === 'error' ? 'danger' : 'brass'})">${esc(r.hint || (r.warn || []).join('; ') || r.error || '')}</div>` : '');
    list.appendChild(el);
  }
}
function msgText(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((x) => x.text || JSON.stringify(x)).join('\n');
  return m.content == null ? '' : JSON.stringify(m.content, null, 2);
}
function prettyArgs(a) { try { return JSON.stringify(JSON.parse(a || '{}'), null, 2); } catch { return String(a || ''); } }
const ROLE_RU = { system: 'системный промт', user: 'пользователь', assistant: 'модель', tool: 'результат инструмента' };
function diagMsgBlock(m, i) {
  const d = document.createElement('details'); d.className = 'diag-msg';
  let text = msgText(m);
  if (m.tool_calls && m.tool_calls.length) text += (text ? '\n\n' : '') + m.tool_calls.map((c) => `→ ${c.function?.name}(${prettyArgs(c.function?.arguments)})`).join('\n');
  d.innerHTML = `<summary><span><b>${i + 1}. ${ROLE_RU[m.role] || m.role}</b>${m.name ? ' · ' + esc(m.name) : ''}</span><span class="diag-mini">${text.length} симв.</span></summary>`;
  const pre = document.createElement('pre'); pre.className = 'diag-pre'; pre.textContent = text || '(пусто)';
  d.appendChild(pre);
  return d;
}
async function showDiag(id) {
  diagSelected = id; renderDiagList();
  const box = $('diagDetail');
  box.innerHTML = '<p class="sheet-empty">Загрузка…</p>';
  let rec;
  try { rec = await api('/api/diag/' + id); } catch (err) { box.innerHTML = ''; toast(err.message); return; }
  const { summary: r, full } = rec;
  box.innerHTML = '';
  const add = (html) => { const w = document.createElement('div'); w.innerHTML = html; while (w.firstChild) box.appendChild(w.firstChild); };
  add(`<h3>${DIAG_ICON[r.status]} ${esc(r.purpose)}</h3>`);
  const chips = [
    `<span class="diag-chip ${r.status}">${r.status === 'ok' ? 'успешно' : r.status === 'warn' ? 'с предупреждением' : 'ошибка' + (r.httpStatus ? ' ' + r.httpStatus : '')}</span>`,
    `<span class="diag-chip">${esc(r.model || '?')}${r.provider ? ' · ' + esc(r.provider) : ''}</span>`,
    `<span class="diag-chip">${fmtMs(r.ms || 0)}</span>`,
    r.in !== undefined ? `<span class="diag-chip">вход ${r.in} · выход ${r.out ?? '?'}${r.reasoning ? ` (из них размышления ${r.reasoning})` : ''}</span>` : '',
    r.cost !== undefined ? `<span class="diag-chip">${fmtCost(r.cost)}</span>` : '',
    r.finish ? `<span class="diag-chip">finish: ${esc(r.finish)}</span>` : '',
    `<span class="diag-chip">${fmtTime(r.at)}</span>`,
  ];
  add(`<div class="diag-chips">${chips.join('')}</div>`);
  if (r.status === 'error') add(`<div class="diag-alert"><strong>${esc(r.hint || 'Запрос не прошёл')}</strong><pre class="diag-pre">${esc((full && full.rawError) || r.error || '')}</pre></div>`);
  if (r.warn && r.warn.length) add(`<div class="diag-alert warn"><strong>Что настораживает</strong><ul>${r.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  if (r.fallbacks && r.fallbacks.length) {
    add(`<div class="diag-alert warn"><strong>Сработали откаты (запрос повторён с другими параметрами)</strong><ul>${r.fallbacks.map((f, i) => `<li>${esc(f)}<div class="diag-mini" style="white-space:normal">${esc((r.attemptErrors || [])[i] || '')}</div></li>`).join('')}</ul></div>`);
  }
  // Действия
  const act = document.createElement('div'); act.className = 'diag-actions';
  const copy = document.createElement('button'); copy.className = 'btn ghost'; copy.textContent = 'Скопировать JSON';
  copy.onclick = async () => {
    const txt = JSON.stringify({ summary: r, ...(full || {}) }, null, 2);
    try { await navigator.clipboard.writeText(txt); toast('Скопировано в буфер.'); }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Скопировано в буфер.'); }
  };
  act.appendChild(copy);
  if (full && full.request) {
    const inp = document.createElement('input'); inp.value = r.model || ''; inp.placeholder = 'модель для повтора'; inp.title = 'Тот же запрос можно отправить другой модели. На игру повтор не влияет.';
    const rep = document.createElement('button'); rep.className = 'btn'; rep.textContent = 'Повторить запрос';
    rep.onclick = async () => {
      rep.disabled = true; rep.textContent = 'Отправляю…';
      try {
        const { summary } = await api(`/api/diag/${r.id}/replay`, { method: 'POST', body: JSON.stringify({ model: inp.value }) });
        await loadDiag(); showDiag(summary.id);
      } catch (err) { toast(err.message); rep.disabled = false; rep.textContent = 'Повторить запрос'; }
    };
    act.append(inp, rep);
  }
  box.appendChild(act);
  if (r.replayOf) add(`<p class="diag-mini" style="white-space:normal">Повтор запроса — на игру не повлиял.</p>`);
  if (!full) { add('<p class="sheet-empty">Полное тело запроса уже вытеснено — хранятся только 20 последних.</p>'); return; }
  const req = full.request || {};
  add('<h3>Запрос</h3>');
  const params = [
    ['модель', req.model], ['temperature', req.temperature], ['presence / frequency', [req.presence_penalty, req.frequency_penalty].filter((x) => x !== undefined).join(' / ')],
    ['tool_choice', req.tool_choice], ['reasoning', req.reasoning ? JSON.stringify(req.reasoning) : ''], ['provider', req.provider ? JSON.stringify(req.provider) : ''],
    ['инструменты', (req.tools || []).map((t) => t.function?.name).join(', ')],
    ['всего символов', (req.messages || []).reduce((n, m) => n + msgText(m).length, 0)],
  ].filter(([, v]) => v !== undefined && v !== '');
  add(`<div class="diag-kv">${params.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div>`);
  (req.messages || []).forEach((m, i) => box.appendChild(diagMsgBlock(m, i)));
  add('<h3>Ответ</h3>');
  const resp = full.response;
  if (!resp) add('<p class="sheet-empty">Ответа нет — запрос завершился ошибкой.</p>');
  else {
    const msg = resp.choices?.[0]?.message || {};
    const text = msgText(msg);
    const pre = document.createElement('pre'); pre.className = 'diag-pre'; pre.textContent = text || '(текста нет)'; box.appendChild(pre);
    if (msg.reasoning) { const d = document.createElement('details'); d.className = 'diag-msg'; d.innerHTML = `<summary><span><b>Размышления модели</b></span><span class="diag-mini">${msg.reasoning.length} симв.</span></summary>`; const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = msg.reasoning; d.appendChild(p); box.appendChild(d); }
    for (const c of msg.tool_calls || []) {
      const d = document.createElement('details'); d.className = 'diag-msg'; d.open = true;
      d.innerHTML = `<summary><span><b>→ ${esc(c.function?.name || '?')}</b></span></summary>`;
      const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = prettyArgs(c.function?.arguments); d.appendChild(p); box.appendChild(d);
    }
    const raw = document.createElement('details'); raw.className = 'diag-msg';
    raw.innerHTML = '<summary><span><b>Сырой JSON ответа</b></span></summary>';
    const p = document.createElement('pre'); p.className = 'diag-pre'; p.textContent = JSON.stringify(resp, null, 2); raw.appendChild(p); box.appendChild(raw);
  }
}
async function loadDiag() {
  try { diagItems = (await api('/api/diag')).items || []; } catch (err) { toast(err.message); diagItems = []; }
  renderDiagList();
}
async function openDiag() {
  $('diagModal').hidden = false;
  await loadDiag();
  try { localStorage.setItem(DIAG_SEEN_KEY, new Date().toISOString()); } catch { /* приватный режим */ }
  $('diagDot').hidden = true;
  const first = diagItems.find((r) => r.status !== 'ok') || diagItems[0];
  if (first && !diagSelected) showDiag(first.id);
  else if (diagSelected && diagItems.some((r) => r.id === diagSelected)) showDiag(diagSelected);
  else $('diagDetail').innerHTML = '<p class="sheet-empty">Выберите запрос слева.</p>';
}
function closeDiag() {
  $('diagModal').hidden = true;
  try { localStorage.setItem(DIAG_SEEN_KEY, new Date().toISOString()); } catch { /* приватный режим */ }
}

// Состав промта рассказчика: что сколько весит. На долгой игре видно, что разрослось.
async function showPromptBreakdown() {
  const box = $('diagDetail');
  box.innerHTML = '<p class="sheet-empty">Считаю…</p>';
  document.querySelectorAll('.diag-item.active').forEach((x) => x.classList.remove('active'));
  diagSelected = null;
  let d;
  try { d = await api('/api/prompt/breakdown'); } catch (err) { box.innerHTML = ''; toast(err.message); return; }
  box.innerHTML = '';
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  box.appendChild(el('h3', 'diag-h', 'Состав промта рассказчика'));
  box.appendChild(el('p', 'diag-sub', `≈ ${d.total.toLocaleString('ru-RU')} токенов на следующем ходу (оценка). Ход ${d.counts.turn}.`));
  const max = Math.max(...d.sections.map((s) => s.tokens), 1);
  const table = el('div', 'pb-table');
  for (const s of [...d.sections].sort((a, b) => b.tokens - a.tokens)) {
    const row = el('div', 'pb-row' + (s.history ? ' history' : ''));
    row.appendChild(el('span', 'pb-label', s.label));
    const bar = el('span', 'pb-bar'); const fill = el('i'); fill.style.width = (s.tokens / max * 100) + '%'; bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'pb-num', `${s.tokens.toLocaleString('ru-RU')} · ${Math.round(s.tokens / d.total * 100)}%`));
    table.appendChild(row);
  }
  box.appendChild(table);
  const c = d.counts;
  box.appendChild(el('p', 'diag-sub', `НПС: ${c.npcs} (в архиве ${c.archived}) · записей хроники: ${c.events} · справочник мира: ${c.lore} · предыстория: ${c.summaryWords} слов · дословно держится ${c.historyKeep} сообщ.`));
  // Подсказки — только когда есть явный перекос.
  const share = (label) => (d.sections.find((s) => s.label.startsWith(label))?.tokens || 0) / d.total;
  const tips = [];
  if (d.total > 24000) tips.push('Промт очень большой — на таком объёме модели начинают путаться и терять детали. Ниже — что сократить в первую очередь.');
  if (share('История дословно') > 0.45) tips.push('Больше всего места — дословная история. Уменьши «Сырых ходов в памяти» в настройках (раздел «Память»): старые ходы уйдут в предысторию.');
  if (share('НПС') > 0.25 || c.npcs > 15) tips.push(`Много места у НПС (${c.npcs} активных). Тех, кто ушёл из истории, отправь в архив — их карточки перестанут ехать в каждый запрос.`);
  if (share('Предыстория') > 0.15) tips.push('Предыстория разрослась — её можно сократить вручную в настройках (раздел «Память»).');
  if (share('Справочник мира') > 0.2) tips.push('Справочник мира занимает много: проверь записи «всегда в контексте» и слишком общие ключевые слова.');
  for (const t of tips) box.appendChild(el('p', 'pb-tip', t));
}
