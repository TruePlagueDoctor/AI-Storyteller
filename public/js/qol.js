// Удобства: горячие клавиши, черновик хода, сигнал «ответ готов».
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

const lsGet = (k, d = '') => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { if (v === '' || v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* приватный режим */ } };

// ---- Черновик хода: набранное не теряется при обновлении страницы ----
// У каждой истории свой черновик.
const draftKey = () => `draft:${app.activeSlotId || 'main'}`;
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => lsSet(draftKey(), inputEl.value), 300);
}
function restoreDraft() {
  const d = lsGet(draftKey());
  if (d && !inputEl.value) { inputEl.value = d; autoGrow(); }
}
function clearDraft() { clearTimeout(draftTimer); lsSet(draftKey(), ''); }

// ---- Сигнал «ответ готов», если вкладка в фоне ----
const BASE_TITLE = document.title;
const soundOn = () => lsGet('notifySound') === '1';
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    for (const [f, t] of [[660, 0], [880, 0.12]]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.12, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(now + t); o.stop(now + t + 0.4);
    }
    setTimeout(() => ctx.close(), 800);
  } catch { /* без звука */ }
}
function notifyReady(failed = false) {
  if (!document.hidden) return;
  document.title = (failed ? '⚠ Ход не удался — ' : '✦ Ответ готов — ') + BASE_TITLE;
  if (soundOn()) chime();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = BASE_TITLE; });

// ---- Горячие клавиши ----
const typing = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);
function openOverlays() { return [...document.querySelectorAll('.modal-overlay')].filter((m) => !m.hidden); }
function lastNarratorIndex() {
  const i = app.log.length - 1;
  return i >= 0 && app.log[i].role === 'narrator' ? i : -1;
}

function installQol() {
  restoreDraft();
  inputEl.addEventListener('input', saveDraft);
  $('notifySoundInput').checked = soundOn();
  $('notifySoundInput').addEventListener('change', (e) => { lsSet('notifySound', e.target.checked ? '1' : ''); if (e.target.checked) chime(); });

  // Esc закрывает верхнее окно. Ловим раньше остальных обработчиков, чтобы одно нажатие
  // не закрыло сразу два окна.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = openOverlays().pop();
    if (!top) return;
    const close = top.querySelector('.modal-head .close');
    if (!close) return;
    e.preventDefault(); e.stopImmediatePropagation();
    close.click();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (openOverlays().length || e.isComposing) return;
    // ↑ в пустом поле — править свою последнюю реплику.
    if (e.key === 'ArrowUp' && e.target === inputEl && !inputEl.value && !sending && !e.altKey && !e.ctrlKey) {
      const mine = [...logEl.querySelectorAll('.entry.player, .entry.ooc')].pop();
      if (mine) { e.preventDefault(); startEdit(mine); }
      return;
    }
    // Alt+R — перегенерировать последний ответ.
    if (e.altKey && !e.ctrlKey && (e.code === 'KeyR')) {
      if (lastNarratorIndex() >= 0 && !sending) { e.preventDefault(); regenerate(); }
      return;
    }
    // Alt+← / Alt+→ — варианты последнего ответа (и ← / →, когда не набираешь текст).
    const arrow = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (arrow && (e.altKey || !typing(e.target)) && !e.ctrlKey && !e.metaKey) {
      const i = lastNarratorIndex();
      if (i >= 0 && (app.log[i].variants || 1) > 1 && !sending) { e.preventDefault(); swipe(i, arrow); }
      return;
    }
    // Ctrl+K — поиск по истории.
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); openSearch(); return; }
    // «/» вне поля ввода — к полю ввода.
    if (e.key === '/' && !typing(e.target)) { e.preventDefault(); inputEl.focus(); }
  });
}
