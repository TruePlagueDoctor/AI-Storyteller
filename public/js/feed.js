// Лента: реплики, история как дерево, ход, регенерация и свайпы.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

// ---- Лента ----
function makeEntryEl(role, text, index, entry) {
  const div = document.createElement('div');
  div.className = `entry ${role}` + (entry && entry.failed ? ' failed' : '');
  if (index != null) div.dataset.index = index;
  const span = document.createElement('span');
  span.className = 'entry-text';
  renderRichText(span, text);
  div.appendChild(span);
  if (entry && role === 'narrator' && index != null && entry.images && entry.images.length) div.appendChild(sceneFigure(entry, index));
  if (entry && entry.rolls && entry.rolls.length) {
    for (const r of entry.rolls) {
      const chip = document.createElement('div');
      chip.className = 'roll' + (r.success ? ' ok' : ' bad');
      const label = document.createElement('span');
      label.className = 'roll-label';
      label.textContent = `${r.skill} · ${r.difficulty}`;
      if (r.asked) label.title = `Рассказчик назвал проверку «${r.asked}» — засчитано умение «${r.skill}»`;
      const val = document.createElement('span');
      val.className = 'roll-value';
      // Все слагаемые видны: раньше модификаторы от состояний и черт цели прятались («8 = 5»).
      const sgn = (n) => (n > 0 ? ` +${n}` : ` −${Math.abs(n)}`);
      val.textContent = `🎲 ${r.roll}${r.bonus ? sgn(r.bonus) : ''}${r.penalty ? sgn(-r.penalty) : ''}${r.traitMod ? sgn(r.traitMod) : ''}${r.edge ? sgn(r.edge) : ''} = ${r.total} против ${r.target}`;
      val.title = [`бросок d20: ${r.roll}`, r.bonus ? `умение (${r.level}): +${r.bonus}` : `умение: ${r.level}`,
        r.penalty ? `${r.penaltyReason}: −${r.penalty}` : '', ...(r.traitReasons || []),
        r.edge ? `обстоятельства: ${r.edge > 0 ? '+' : '−'}${Math.abs(r.edge)}${r.edgeReason ? ' — ' + r.edgeReason : ''}` : '',
        r.target_npc ? `против: ${r.target_npc}` : '', `нужно ${r.target} (${r.difficulty})`].filter(Boolean).join('\n');
      const out = document.createElement('span');
      out.className = 'roll-outcome';
      out.textContent = r.outcome;
      chip.append(label, val, out);
      // За что дано преимущество или помеха — видно сразу, не только во всплывающей подсказке.
      if (r.edge && r.edgeReason) { const why = document.createElement('span'); why.className = 'roll-edge'; why.textContent = `${r.edge > 0 ? 'преимущество' : 'помеха'}: ${r.edgeReason}`; chip.appendChild(why); }
      div.appendChild(chip);
    }
  }
  if (entry && entry.truncated) {
    const bar = document.createElement('div');
    bar.className = 'trunc-bar';
    const msg = document.createElement('span');
    msg.className = 'trunc-msg';
    msg.textContent = 'Ответ оборвался — модель упёрлась в лимит длины.';
    const btn = document.createElement('button');
    btn.className = 'btn primary continue-btn';
    btn.textContent = 'Договорить';
    bar.append(msg, btn);
    div.appendChild(bar);
  }
  if (entry && ((entry.ticks && entry.ticks.length) || (entry.growth && entry.growth.length) || (entry.lookups && entry.lookups.length) || (entry.voices && entry.voices.length) || entry.voiceNote)) {
    const fx = document.createElement('div');
    fx.className = 'turn-fx';
    if (entry.lookups && entry.lookups.length) {
      const l = document.createElement('div'); l.className = 'fx-tick';
      l.textContent = '📖 Рассказчик заглянул в кодекс: ' + entry.lookups.join(', ');
      fx.appendChild(l);
    }
    // Что персонаж решил сам — под спойлером: там его намерения.
    for (const v of entry.voices || []) {
      const d = document.createElement('details'); d.className = 'fx-voice';
      const sum = document.createElement('summary'); sum.textContent = `🎭 ${v.name} решил сам`;
      d.appendChild(sum);
      for (const [label, text] of [['Намерение', v.decision], ['Реплика', v.line ? `«${v.line}»` : ''], ['Заметно снаружи', v.tell]]) {
        if (!text) continue;
        const row = document.createElement('div'); row.className = 'fx-voice-row';
        const b = document.createElement('span'); b.className = 'fx-voice-label'; b.textContent = label;
        row.append(b, document.createTextNode(' ' + text));
        d.appendChild(row);
      }
      fx.appendChild(d);
    }
    if (entry.voiceNote) { const l = document.createElement('div'); l.className = 'fx-tick'; l.textContent = '🎭 ' + entry.voiceNote; fx.appendChild(l); }
    for (const t of entry.ticks || []) { const l = document.createElement('div'); l.className = 'fx-tick'; l.textContent = '⏳ ' + t; fx.appendChild(l); }
    for (const g of entry.growth || []) { const l = document.createElement('div'); l.className = 'fx-growth'; l.textContent = '✦ ' + g; fx.appendChild(l); }
    div.appendChild(fx);
  }
  if (entry && entry.issues && entry.issues.length) {
    const warn = document.createElement('div');
    warn.className = 'issue';
    warn.textContent = '⚠ ' + entry.issues.join(' ');
    warn.title = 'Расхождение с состоянием — рассказчику отправлено замечание';
    div.appendChild(warn);
  }
  // Время ответа — в строке журнала учёта, а не отдельной строкой: служебное не должно теснить текст.
  const timing = entry && role === 'narrator' && (entry.timing || (entry.sync && entry.sync.timing)) ? renderTiming(entry) : null;
  if (timing && !(entry.sync && entry.sync.status)) div.appendChild(timing);
  if (entry && entry.sync && entry.sync.status) {
    const isLast = index != null && index === app.log.length - 1;
    const box = renderSyncJournal(entry.sync);
    if (timing) {
      const t = document.createElement('span');
      t.className = 'sum-time';
      t.textContent = timing.textContent.replace(/ — .*/, '');
      t.title = timing.title;
      box.querySelector('summary').appendChild(t);
    }
    for (const prev of entry.syncHistory || []) {
      const old = renderSyncJournal(prev, 'прежний ');
      old.classList.add('prev');
      box.appendChild(old);
    }
    if (isLast && app.canResync && entry.sync.status !== 'inline') {
      const bar = document.createElement('div');
      bar.className = 'sync-acts';
      const btn = document.createElement('button');
      btn.className = 'link-btn';
      btn.textContent = '↻ переучесть ход';
      btn.title = 'Откатить записи этого хода и прогнать учёт заново — можно другой моделью. Прежний журнал останется для сравнения.';
      btn.addEventListener('click', (e) => { e.preventDefault(); resyncTurn(btn); });
      bar.appendChild(btn);
      box.appendChild(bar);
    }
    div.appendChild(box);
  }
  if (entry && entry.failed) {
    const bar = document.createElement('div');
    bar.className = 'fail-bar';
    const msg = document.createElement('span');
    msg.className = 'fail-msg';
    msg.textContent = entry.error || 'Рассказчик не ответил.';
    const retry = document.createElement('button');
    retry.className = 'btn primary retry-btn';
    retry.textContent = 'Отправить снова';
    bar.append(msg, retry);
    div.appendChild(bar);
    return div;
  }
  if (index != null) {
    const tools = document.createElement('span');
    tools.className = 'entry-tools';
    const mk = (cls, title, txt) => { const b = document.createElement('button'); b.className = cls; b.title = title; b.textContent = txt; return b; };
    tools.appendChild(mk('edit-btn', 'Редактировать', '✎'));
    if (role === 'narrator') tools.appendChild(mk('illus-btn', 'Иллюстрировать сцену', '🖼'));
    tools.appendChild(mk('branch-btn', 'Ветка отсюда: копия истории, обрезанная до этого места', '⑂'));
    tools.appendChild(mk('cut-btn', role === 'narrator'
      ? 'Обрезать после: всё, что ниже, исчезнет, мир вернётся к этому моменту'
      : 'Обрезать здесь: ответ и всё ниже исчезнут, реплику можно отправить заново', '✂'));
    div.appendChild(tools);
  }
  return div;
}

// ---- История как дерево ----
async function cutAt(index) {
  if (sending) return;
  const e = app.log[index];
  if (!e) return;
  const below = app.log.length - 1 - index;
  // Мир и время общие: обрезка убирает и ходы других героев, сыгранные позже, — в ленте этого героя их не видно.
  const foreign = app.log.slice(index + 1).filter((x) => !heroSees(x)).length;
  const note = foreign ? ` Из них ходов других героев: ${foreign} — они сыграны позже и тоже исчезнут.` : '';
  if (below > 0 && !confirm(`Обрезать историю? Исчезнет сообщений: ${below}.${note} Мир откатится к этому моменту.`)) return;
  try {
    const data = await api(`/api/log/${index}/truncate`, { method: 'POST' });
    applyFullState(data);
    if (data.restored === false) toast('Обрезано. Для этого хода нет снимка мира (он сделан до обновления) — листы и НПС не откатывались.');
  } catch (err) { toast(err.message); }
}
async function branchAt(index) {
  if (sending) return;
  try {
    const data = await api(`/api/log/${index}/branch`, { method: 'POST' });
    applyFullState(data);
    toast('Создана ветка — ты в ней. Исходная история осталась в списке историй.');
  } catch (err) { toast(err.message); }
}
async function swipe(index, dir) {
  if (sending) return;
  try {
    const data = await api(`/api/log/${index}/swipe`, { method: 'POST', body: JSON.stringify({ dir }) });
    applyFullState(data);
  } catch (err) { toast(err.message); }
}

// Пустая лента: партия не начата — или у этого героя ещё нет своих ходов.
function emptyLogHtml() {
  const fresh = !app.log.length;
  return '<div class="empty-log" id="emptyLog">'
    + `<p class="empty-title">${fresh ? 'Лист пуст, история ещё не начата.' : 'У этого героя история ещё не начата.'}</p>`
    + `<p class="empty-hint">${fresh ? 'Настрой мир, сценарий и героев — или просто нажми «Начать», и рассказчик задаст сцену сам.' : 'Напиши первый ход — или нажми «Начать», и рассказчик задаст сцену для него. Мир, время и персонажи общие с остальными героями.'}</p>`
    + '<button class="btn primary" id="startBtn">Начать</button></div>';
}
function renderScopeBtn() {
  const btn = $('scopeBtn');
  const hidden = app.log.some((e) => !heroSees(e));
  btn.hidden = !hidden && feedScope === 'hero';
  const me = (app.characters || []).find((c) => c.id === app.activeCharacterId);
  btn.textContent = feedScope === 'all' ? 'лента: все герои' : `лента: ${me ? me.name : 'герой'}`;
  btn.classList.toggle('lit', feedScope === 'all');
}
function toggleFeedScope() {
  feedScope = feedScope === 'all' ? 'hero' : 'all';
  renderLog(app.log);
  decorateLastNarrator();
}
function renderLog(log) {
  app.log = log || [];
  renderScopeBtn();
  const shown = app.log.map((entry, i) => [entry, i]).filter(([entry]) => entryVisible(entry));
  if (!shown.length) { logEl.innerHTML = emptyLogHtml(); return; }
  logEl.innerHTML = '';
  for (const [entry, i] of shown) {
    const el = makeEntryEl(entry.role, entry.text, i, entry);
    // В общей ленте подписываем чужие ходы именем героя.
    if (feedScope === 'all' && entry.hero && entry.hero !== app.activeCharacterId) {
      const who = (app.characters || []).find((c) => c.id === entry.hero);
      if (who) el.dataset.who = who.name;
    }
    logEl.appendChild(el);
  }
  scrollLog();
}

function addEntry(role, text) {
  const empty = $('emptyLog');
  if (empty) empty.remove();
  const div = makeEntryEl(role, text, null);
  logEl.appendChild(div);
  scrollLog();
  return div;
}

function startEdit(entryEl) {
  const index = Number(entryEl.dataset.index);
  if (Number.isNaN(index) || !app.log[index]) return;
  entryEl.classList.add('editing');
  entryEl.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'edit-area';
  ta.value = app.log[index].text;
  entryEl.appendChild(ta);
  const bar = document.createElement('div');
  bar.className = 'edit-bar';
  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Отмена';
  const save = document.createElement('button');
  save.className = 'btn primary';
  save.textContent = 'Сохранить';
  bar.append(cancel, save);
  entryEl.appendChild(bar);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  grow();
  ta.focus();
  ta.addEventListener('input', grow);
  cancel.onclick = () => { renderLog(app.log); decorateLastNarrator(); };
  save.onclick = async () => {
    save.disabled = true;
    try {
      const data = await api(`/api/log/${index}`, { method: 'PUT', body: JSON.stringify({ text: ta.value }) });
      renderLog(data.log);
      decorateLastNarrator();
    } catch (err) { toast(err.message); save.disabled = false; }
  };
}
let thinkingTimer = null;
function showThinking() {
  const div = document.createElement('div');
  div.className = 'entry narrator';
  div.id = 'thinkingEntry';
  div.innerHTML = '<span class="thinking"><span></span><span></span><span></span></span><span class="thinking-clock" id="thinkingClock"></span>';
  logEl.appendChild(div);
  scrollLog();
  const t0 = Date.now();
  clearInterval(thinkingTimer);
  // Секундомер ожидания: видно, что запрос жив и сколько уже идёт.
  let lastPoll = 0;
  thinkingTimer = setInterval(() => {
    const c = $('thinkingClock');
    if (!c) { clearInterval(thinkingTimer); return; }
    const s = Math.floor((Date.now() - t0) / 1000);
    c.textContent = s >= 1 ? `${s} с` : '';
    // Раз в 2 секунды спрашиваем сервер, какой запрос сейчас идёт: ход — это персонажи, рассказчик и учёт подряд.
    if (s >= 3 && Date.now() - lastPoll > 2000) { lastPoll = Date.now(); refreshThinkingStage(s); }
  }, 250);
}
// Что именно сейчас ждём и кнопка «прервать» (после 15 секунд ожидания).
let thinkingStopAfter = 15;
const STAGE_LABEL = [[/^персонаж: (.+)$/, (m) => `решает ${m[1]}`], [/^рассказчик: продолжение/, () => 'рассказчик дописывает'], [/^рассказчик/, () => 'пишет рассказчик'],
  [/уч[её]т/, () => 'идёт учёт'], [/сжатие/, () => 'сжимается история']];
function stageText(r) {
  for (const [re, fn] of STAGE_LABEL) { const m = String(r.purpose || '').match(re); if (m) return `${fn(m)} · ${r.sec} с`; }
  return `${r.purpose} · ${r.sec} с`;
}
async function refreshThinkingStage(total) {
  let st;
  try { st = await api('/api/turn/status'); } catch { return; }
  const box = $('thinkingEntry');
  if (!box || !st.running) return;
  let line = $('thinkingStage');
  if (!line) {
    line = document.createElement('div'); line.id = 'thinkingStage'; line.className = 'thinking-stage';
    const txt = document.createElement('span'); txt.id = 'thinkingStageText';
    const stop = document.createElement('button'); stop.type = 'button'; stop.id = 'thinkingStop'; stop.className = 'link-btn'; stop.textContent = 'прервать'; stop.hidden = true;
    stop.title = 'Оборвать запрос к модели. Твоя реплика останется, её можно будет отправить снова.';
    stop.addEventListener('click', async () => { stop.disabled = true; stop.textContent = 'прерываю…'; try { await api('/api/turn/abort', { method: 'POST' }); } catch { /* ход уже закончился */ } });
    line.append(txt, stop);
    box.appendChild(line);
  }
  $('thinkingStageText').textContent = (st.requests || []).map(stageText).join(' · ') || 'сервер обрабатывает ответ';
  $('thinkingStop').hidden = total < thinkingStopAfter;
}
function hideThinking() { clearInterval(thinkingTimer); const t = $('thinkingEntry'); if (t) t.remove(); }

// ---- Ход ----
async function performTurn(endpoint, body, optimistic) {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  if (optimistic && optimistic.text) addEntry(optimistic.role, optimistic.text);
  inputEl.value = '';
  clearDraft();
  autoGrow();
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());
  showThinking();

  const before = captureBefore();
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

// ---- Единый путь применения ответа на ход ----
// Ход, повтор, регенерация и «Договорить» раньше обновляли каждый свой набор
// данных — сцена, нити, полоса героя оставались старыми до перезагрузки.
function captureBefore() {
  return { sigs: { ...charSigs }, npc: npcsCollectionSig(), active: app.activeCharacterId };
}
function applyTurnResult(data, before) {
  hideThinking();
  if (data.activeCharacterId) app.activeCharacterId = data.activeCharacterId; // лента рисуется глазами активного героя
  renderLog(data.log);
  applyState(data, { animate: true });
  for (const c of app.characters) {
    const sig = charSig(c);
    if (before && before.sigs[c.id] !== undefined && before.sigs[c.id] !== sig && c.id !== before.active) changedChars.add(c.id);
  }
  snapshotCharSigs();
  renderTabs();
  if (before && activePanel !== 'npcs' && npcsCollectionSig() !== before.npc) $('tabNpcs').classList.add('changed');
  decorateLastNarrator();
}
// Сбой хода: сервер уже откатил мир — берём полное состояние, а не обрывок.
async function recoverAfterTurnError(err) {
  hideThinking();
  toast(err.message);
  try {
    applyFullState(await api('/api/state'));
  } catch {
    if (err.payload && err.payload.log) renderLog(err.payload.log);
    decorateLastNarrator();
  }
  ensureRetryAffordance();
}
// Перерисовать ленту (портреты у реплик), не сбрасывая прокрутку читателя.
function refreshLogKeepScroll() {
  if (!app.log || !app.log.length) return;
  const top = logEl.scrollTop;
  const atBottom = logEl.scrollHeight - logEl.clientHeight - top < 40;
  const prevBehavior = logEl.style.scrollBehavior;
  logEl.style.scrollBehavior = 'auto';
  renderLog(app.log);
  if (!atBottom) logEl.scrollTop = top;
  logEl.style.scrollBehavior = prevBehavior;
  decorateLastNarrator();
}

// Выход из «занят»: сначала снять флаг и разблокировать ввод, потом дорисовать
// кнопки последнего ответа (↻, свайпы, «Отправить снова»). Раньше кнопки
// рисовались, пока флаг ещё стоял, — и не появлялись до перезагрузки.
function endBusy({ focus = true } = {}) {
  refreshDiagBadge();
  const last = app.log[app.log.length - 1];
  notifyReady(Boolean(last && last.failed));
  sending = false;
  sendBtn.disabled = false;
  inputEl.disabled = false;
  decorateLastNarrator();
  if (focus) inputEl.focus();
}

// Гарантирует, что у зависшего хода есть кнопка повтора.
function ensureRetryAffordance() {
  const last = app.log[app.log.length - 1];
  if (!last || (last.role !== 'player' && last.role !== 'ooc')) return;
  if (!last.failed) {
    last.failed = true;
    last.error = last.error || 'Ответ не получен.';
    renderLog(app.log);
  }
}

async function continueTurn() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  document.querySelectorAll('.trunc-bar').forEach((b) => b.remove());
  showThinking();
  const before = captureBefore();
  try {
    const data = await api('/api/continue', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

async function retryTurn() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  document.querySelectorAll('.fail-bar').forEach((b) => b.remove());
  showThinking();
  const before = captureBefore();
  try {
    const data = await api('/api/retry', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}

function sendAction(text) { return performTurn('/api/action', { text }, { role: 'player', text }); }
function sendOoc(text) { return performTurn('/api/ooc', { text }, { role: 'ooc', text }); }
function submitInput(text) { return (oocMode ? sendOoc : sendAction)(text); }

// ---- Кнопка регенерации на последней реплике рассказчика ----
function decorateLastNarrator() {
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());
  if (sending) return;

  // Если последнее слово осталось за игроком — ответа не было.
  // Показываем кнопку повтора всегда, не полагаясь на пометку о сбое.
  const lastEntry = app.log[app.log.length - 1];
  // Последний ход в общей истории сделан другим героем — отсюда его не повторить и не переиграть.
  if (lastEntry && !heroSees(lastEntry)) return;
  if (lastEntry && (lastEntry.role === 'player' || lastEntry.role === 'ooc')) {
    const entries = logEl.querySelectorAll('.entry');
    const el = entries[entries.length - 1];
    if (el && !el.querySelector('.fail-bar') && !el.querySelector('.retry-inline')) {
      const bar = document.createElement('div');
      bar.className = 'fail-bar retry-inline';
      const msg = document.createElement('span');
      msg.className = 'fail-msg';
      msg.textContent = lastEntry.error || 'Рассказчик не ответил на это сообщение.';
      const btn = document.createElement('button');
      btn.className = 'btn primary retry-btn';
      btn.textContent = 'Отправить снова';
      bar.append(msg, btn);
      el.appendChild(bar);
    }
    return;
  }
  const narrators = [...logEl.querySelectorAll('.entry.narrator')].filter((e) => e.id !== 'thinkingEntry');
  const last = narrators[narrators.length - 1];
  if (!last) return;
  const bar = document.createElement('span');
  bar.className = 'regen-bar';
  const idx = Number(last.dataset.index);
  const entry = app.log[idx];
  if (entry && entry.variants > 1) {
    const prev = document.createElement('button');
    prev.className = 'regen-btn swipe'; prev.textContent = '‹'; prev.title = 'Предыдущий вариант';
    prev.disabled = entry.variant <= 0;
    prev.addEventListener('click', () => swipe(idx, -1));
    const cnt = document.createElement('span');
    cnt.className = 'swipe-count'; cnt.textContent = `${entry.variant + 1}/${entry.variants}`;
    const next = document.createElement('button');
    next.className = 'regen-btn swipe'; next.textContent = '›'; next.title = 'Следующий вариант';
    next.disabled = entry.variant >= entry.variants - 1;
    next.addEventListener('click', () => swipe(idx, 1));
    bar.append(prev, cnt, next);
  }
  const btn = document.createElement('button');
  btn.className = 'regen-btn';
  btn.title = entry && entry.variants > 1 ? 'Ещё вариант (прежние сохраняются)' : 'Перегенерировать ответ (прежний сохранится как вариант)';
  btn.textContent = '↻';
  btn.addEventListener('click', regenerate);
  bar.appendChild(btn);
  last.appendChild(bar);
}

async function regenerate() {
  if (sending) return;
  sending = true;
  sendBtn.disabled = true;
  inputEl.disabled = true;
  document.querySelectorAll('.regen-btn, .regen-bar').forEach((b) => b.remove());

  showThinking();

  const before = captureBefore();
  try {
    const data = await api('/api/regenerate', { method: 'POST' });
    applyTurnResult(data, before);
  } catch (err) {
    // Сервер уже убрал прежний ответ и откатил мир — на экране его быть не должно.
    await recoverAfterTurnError(err);
  } finally {
    endBusy();
  }
}
