// Иллюстрации сцен, пресеты стиля картинок, просмотр картинки.
// Обычный (не модульный) скрипт: общие const/let и функции видны всем файлам из public/js.

// ---- Иллюстрации сцен ----
const scenePos = new Map(); // индекс реплики → какая из её картинок показана
function sceneFigure(entry, index) {
  const imgs = entry.images;
  let pos = scenePos.has(index) ? scenePos.get(index) : imgs.length - 1;
  pos = Math.max(0, Math.min(imgs.length - 1, pos));
  const im = imgs[pos];
  const fig = document.createElement('figure');
  fig.className = 'scene-figure';
  const img = document.createElement('img');
  img.src = `/scenes/${im.file}`; img.alt = im.moment || 'Иллюстрация сцены'; img.loading = 'lazy';
  if (im.width && im.height) img.style.aspectRatio = `${im.width} / ${im.height}`;
  img.addEventListener('click', () => showImage(im.file, im.moment || '', 'scenes'));
  fig.appendChild(img);
  const cap = document.createElement('figcaption');
  const mkb = (txt, title, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'scene-fig-btn ' + cls; b.textContent = txt; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
  if (imgs.length > 1) {
    const nav = document.createElement('span'); nav.className = 'scene-fig-nav';
    const go = (d) => { scenePos.set(index, (pos + d + imgs.length) % imgs.length); fig.replaceWith(sceneFigure(entry, index)); };
    const cnt = document.createElement('span'); cnt.className = 'scene-fig-count'; cnt.textContent = `${pos + 1}/${imgs.length}`;
    nav.append(mkb('‹', 'Предыдущая', () => go(-1)), cnt, mkb('›', 'Следующая', () => go(1)));
    cap.appendChild(nav);
  }
  const m = document.createElement('span'); m.className = 'scene-fig-moment'; m.textContent = im.moment || '';
  cap.appendChild(m);
  cap.append(
    mkb('✎', 'Открыть кадр: поправить теги, перерисовать с этим или другим зерном', () => openIllusModal(index, im)),
    mkb('✕', 'Убрать картинку из ленты', () => removeSceneImage(index, pos), 'danger'),
  );
  fig.appendChild(cap);
  return fig;
}
async function removeSceneImage(index, n) {
  if (!confirm('Убрать эту картинку из ленты?')) return;
  try {
    const data = await api(`/api/log/${index}/images/${n}`, { method: 'DELETE' });
    scenePos.delete(index);
    app.log = data.log; if (!sending) refreshLogKeepScroll();
  } catch (err) { toast(err.message); }
}

const illusJob = { index: null, busy: false, timer: null };
function illusSetBusy(busy, label) {
  illusJob.busy = busy;
  for (const id of ['illusDraw', 'illusReseed', 'illusReframe']) $(id).disabled = busy;
  const st = $('illusStatus');
  clearInterval(illusJob.timer);
  if (!busy) { st.textContent = label || ''; return; }
  const t0 = Date.now();
  const tick = () => { st.textContent = `${label} ${Math.floor((Date.now() - t0) / 1000)} с`; };
  tick(); illusJob.timer = setInterval(tick, 500);
}
function illusPreview(im) {
  const box = $('illusPreview');
  box.innerHTML = '';
  if (!im) { box.hidden = true; return; }
  box.hidden = false;
  const img = document.createElement('img'); img.src = `/scenes/${im.file}`; img.alt = '';
  img.addEventListener('click', () => showImage(im.file, im.moment || '', 'scenes'));
  box.appendChild(img);
}
async function openIllusModal(index, image = null) {
  const entry = app.log[index];
  if (!entry || entry.role !== 'narrator') return;
  if (illusJob.busy && illusJob.index !== index) { toast('Уже рисуется другая картинка — дождитесь её.'); return; }
  $('illusModal').hidden = false;
  if (illusJob.busy) return; // вернулись к окну, пока рисуется
  illusJob.index = index;
  $('illusFragment').textContent = entry.text.length > 260 ? entry.text.slice(0, 260) + '…' : entry.text;
  $('illusCands').textContent = '';
  illusPreview(null);
  if (image) {
    $('illusTags').value = image.tags || '';
    $('illusSeed').value = image.seed >= 0 ? image.seed : '';
    $('illusMoment').textContent = image.moment || '';
    illusPreview(image);
    illusSetBusy(false, 'Можно поправить теги и перерисовать — с тем же зерном выйдет тот же кадр с изменениями.');
    return;
  }
  $('illusTags').value = '';
  $('illusSeed').value = '';
  $('illusMoment').textContent = '';
  await illusReframe();
}
async function illusReframe() {
  const index = illusJob.index;
  illusSetBusy(true, 'Модель выбирает кадр…');
  try {
    const r = await api(`/api/log/${index}/scene-prompt`, { method: 'POST' });
    if (illusJob.index !== index) return;
    $('illusTags').value = r.tags;
    $('illusMoment').textContent = r.moment || '';
    const inFrame = (r.characters || []).map((x) => x.toLowerCase());
    const noTags = (r.candidates || []).filter((c) => !c.hasPortraitTags && (!inFrame.length || inFrame.includes(c.name.toLowerCase()))).map((c) => c.name);
    $('illusCands').textContent = (r.characters && r.characters.length ? 'В кадре: ' + r.characters.join(', ') + '. ' : 'Кадр без персонажей. ') +
      (noTags.length ? `Без портрета: ${noTags.join(', ')} — приметы взяты из описания; с портретом персонаж узнаваемее.` : '');
    illusSetBusy(false, 'Проверьте теги и нажмите «Нарисовать».');
  } catch (err) { illusSetBusy(false, ''); toast(err.message); }
}
async function illusDraw(seed) {
  const index = illusJob.index;
  const tags = $('illusTags').value.trim();
  if (!tags) { toast('Сначала нужно описание кадра.'); return; }
  illusSetBusy(true, 'Рисую…');
  try {
    const data = await api(`/api/log/${index}/illustrate`, { method: 'POST', body: JSON.stringify({ tags, seed, moment: $('illusMoment').textContent }) });
    $('illusSeed').value = data.image.seed >= 0 ? data.image.seed : '';
    illusPreview(data.image);
    illusSetBusy(false, `Готово, зерно ${data.image.seed}. Картинка добавлена в ленту.` + (data.warnings && data.warnings.length ? ' ⚠ ' + data.warnings.join('; ') + '.' : ''));
    app.log = data.log;
    scenePos.delete(index);
    if (!sending) refreshLogKeepScroll();
    if ($('illusModal').hidden) toast('Иллюстрация готова.');
  } catch (err) { illusSetBusy(false, ''); toast(err.message); }
}

// ---- Пресеты стиля картинок ----
const IMAGE_PRESETS = {
  "anime": {
    "imageStyle": "score_9, score_8_up, score_7_up, source_anime, anime screencap, anime coloring, cel shading, clean lineart, portrait, upper body, looking at viewer, detailed face, detailed eyes, dramatic lighting, dark moody background",
    "imageNegative": "score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, text, watermark, signature, multiple views, child, teen, young, chibi, loli, shota",
    "sceneStyle": "score_9, score_8_up, score_7_up, source_anime, rating_safe, anime screencap, anime coloring, cel shading, detailed background, scenery, cinematic composition, dramatic lighting, atmospheric",
    "sceneNegative": "score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, extra limbs, bad anatomy, bad eyes, deformed eyes, extra mouth, distorted face, text, watermark, signature, multiple views, comic, panels, nsfw, nude, explicit, gore, child, teen, chibi, loli, shota"
  },
  "real": {
    "imageStyle": "score_9, score_8_up, score_7_up, portrait, upper body, looking at viewer, detailed face, realistic proportions, dramatic lighting, dark moody background, illustration",
    "imageNegative": "score_6, score_5, score_4, worst quality, low quality, blurry, deformed, extra fingers, text, watermark, signature, multiple views, child, teen, young, chibi, loli, shota, cute, big eyes",
    "sceneStyle": "score_9, score_8_up, score_7_up, rating_safe, scenery, detailed background, cinematic composition, dramatic lighting, atmospheric, illustration",
    "sceneNegative": "score_6, score_5, score_4, worst quality, low quality, blurry, deformed, extra fingers, extra limbs, bad anatomy, bad eyes, deformed eyes, extra mouth, distorted face, text, watermark, signature, multiple views, comic, panels, nsfw, nude, explicit, gore, child, teen, chibi, loli, shota"
  }
};
function applyImagePreset(name) {
  const p = IMAGE_PRESETS[name]; if (!p) return;
  for (const [k, id] of [['imageStyle', 'imageStyleInput'], ['imageNegative', 'imageNegativeInput'], ['sceneStyle', 'sceneStyleInput'], ['sceneNegative', 'sceneNegativeInput']]) {
    $(id).value = p[k]; $(id).classList.add('ai-filled');
  }
  toast(name === 'anime' ? 'Подставлен аниме-стиль для портретов и сцен — нажмите «Сохранить».' : 'Подставлен прежний, полуреалистичный стиль — нажмите «Сохранить».');
}

// ---- Просмотр картинки ----
function showImage(filename, caption, dir = 'avatars') {
  if (!filename) return;
  $('lightboxImg').src = `/${dir}/${filename}`;
  $('lightboxCaption').textContent = caption || '';
  $('lightbox').hidden = false;
}
function renderHeroStrip() {
  const c = activeChar();
  const strip = $('heroStrip');
  if (!c) { strip.hidden = true; return; }
  strip.hidden = false;
  const p = $('heroPortrait');
  p.style.backgroundImage = c.avatar ? `url('/avatars/${c.avatar}')` : '';
  p.textContent = c.avatar ? '' : '✦';
  p.style.display = 'flex'; p.style.alignItems = 'center'; p.style.justifyContent = 'center'; p.style.color = 'var(--text-faint)';
  $('heroStripName').textContent = c.name;
  $('heroStripSub').textContent = [c.race, c.social].filter(Boolean).join(' · ') || (c.description || '').slice(0, 120);
}
