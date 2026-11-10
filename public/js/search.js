// Поиск по истории: все слова запроса в одной реплике, регистр и «ё» не важны.
// Щелчок по результату — прокрутить ленту к реплике и подсветить её.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

const normSearch = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е');
// Слово запроса ищем по основе: «кольцо» найдёт и «кольца», «кольцом».
const searchStem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w);
let searchTimer = null;

function openSearch() {
  $('searchModal').hidden = false;
  $('searchInput').focus();
  $('searchInput').select();
  runSearch();
}
function closeSearch() { $('searchModal').hidden = true; }

function findInLog(query) {
  const words = normSearch(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).map(searchStem);
  if (!words.length) return { words, hits: [] };
  const hits = [];
  app.log.forEach((e, index) => {
    if (!e || !e.text || !['narrator', 'player', 'ooc'].includes(e.role)) return;
    const low = normSearch(e.text);
    if (words.every((w) => low.includes(w))) hits.push({ index, e, at: low.indexOf(words[0]) });
  });
  return { words, hits };
}

function searchSnippet(e, at, words) {
  const from = Math.max(0, at - 70);
  const raw = (from > 0 ? '…' : '') + e.text.slice(from, from + 220).replace(/\s+/g, ' ') + (from + 220 < e.text.length ? '…' : '');
  // Подсветка совпадений: по нормализованной копии находим места в исходном тексте.
  const low = normSearch(raw);
  const marks = [];
  for (const w of words) { let i = -1; while ((i = low.indexOf(w, i + 1)) !== -1) marks.push([i, i + w.length]); }
  marks.sort((a, b) => a[0] - b[0]);
  let out = ''; let pos = 0;
  for (const [a, b] of marks) { if (a < pos) continue; out += esc(raw.slice(pos, a)) + '<mark>' + esc(raw.slice(a, b)) + '</mark>'; pos = b; }
  return out + esc(raw.slice(pos));
}

function runSearch() {
  const q = $('searchInput').value.trim();
  const box = $('searchResults');
  box.innerHTML = '';
  if (!q) { $('searchCount').textContent = `Реплик в истории: ${app.log.length}. Ищутся все слова запроса в одной реплике.`; return; }
  const { words, hits } = findInLog(q);
  $('searchCount').textContent = hits.length ? `Найдено: ${hits.length}${hits.length > 60 ? ' (показаны первые 60)' : ''}` : 'Ничего не найдено.';
  let turn = 0;
  const turnOf = new Map();
  app.log.forEach((e, i) => { if (e.role === 'player') turn++; turnOf.set(i, turn); });
  for (const h of hits.slice(0, 60)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-hit';
    const who = h.e.role === 'narrator' ? 'рассказчик' : h.e.role === 'ooc' ? 'вне истории' : 'ты';
    row.innerHTML = `<span class="search-meta">ход ${turnOf.get(h.index)} · ${who}</span><span class="search-text">${searchSnippet(h.e, h.at, words)}</span>`;
    row.addEventListener('click', () => jumpToEntry(h.index));
    box.appendChild(row);
  }
}

function jumpToEntry(index) {
  closeSearch();
  let el = logEl.querySelector(`.entry[data-index="${index}"]`);
  // Реплика из линии другого героя — показываем общую ленту.
  if (!el && feedScope === 'hero') { toggleFeedScope(); el = logEl.querySelector(`.entry[data-index="${index}"]`); }
  if (!el) { toast('Эта реплика не показана в ленте.'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('found');
  void el.offsetWidth; // перезапуск подсветки
  el.classList.add('found');
}

function installSearch() {
  $('searchBtn').addEventListener('click', openSearch);
  $('searchClose').addEventListener('click', closeSearch);
  $('searchModal').addEventListener('click', (e) => { if (e.target.id === 'searchModal') closeSearch(); });
  $('searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('searchResults').querySelector('.search-hit'); if (first) first.click(); }
  });
}
