// Генерация картинок через локальный Automatic1111 (/sdapi/v1/txt2img).
// Никаких внешних сервисов: адрес берётся из настроек, обычно 127.0.0.1:7860.

export const DEFAULT_IMAGE_SETTINGS = {
  sdUrl: 'http://127.0.0.1:7860',
  // Pony, аниме-пресет: теги качества обязательны; source_anime + anime coloring уводят от «полуреализма»,
  // а source_pony/3d/realistic в негативе — от его типичных сбоев. Возраст держат негативы child/teen/loli.
  imageStyle: 'score_9, score_8_up, score_7_up, source_anime, anime screencap, anime coloring, cel shading, clean lineart, portrait, upper body, looking at viewer, detailed face, detailed eyes, dramatic lighting, dark moody background',
  imageNegative: 'score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, text, watermark, signature, multiple views, child, teen, young, chibi, loli, shota',
  imageSize: '832x1216',
  imageSteps: 25,
  imageCfg: 6,
  imageSampler: 'DPM++ 2M',
  // Иллюстрации сцен: широкий кадр, упор на окружение и свет, по умолчанию без откровенного.
  sceneStyle: 'score_9, score_8_up, score_7_up, source_anime, rating_safe, anime screencap, anime coloring, cel shading, detailed background, scenery, cinematic composition, dramatic lighting, atmospheric',
  sceneNegative: 'score_6, score_5, score_4, source_pony, source_furry, source_cartoon, 3d, realistic, photorealistic, worst quality, low quality, blurry, deformed, extra fingers, extra limbs, bad anatomy, bad eyes, deformed eyes, extra mouth, distorted face, text, watermark, signature, multiple views, comic, panels, nsfw, nude, explicit, gore, child, teen, chibi, loli, shota',
  sceneSize: '1216x832',
  // Лица: на широком кадре лицо — 60–80 px, SDXL рвёт глаза и рот. Лечится дорисовкой лица
  // (ADetailer), вторым проходом в большем разрешении (Hires fix) и clip skip 2 — Pony на нём обучен.
  imageClipSkip: 2,
  faceFix: true,
  sceneHires: true,
  hiresScale: 1.5,
  hiresDenoise: 0.4,
  hiresUpscaler: 'R-ESRGAN 4x+',
};

// Что умеет конкретный A1111: есть ли ADetailer, какие апскейлеры. Узнаём один раз на адрес.
const caps = new Map();
async function getJson(url, ms = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
export async function sdCaps(sdUrl, fresh = false) {
  const base = String(sdUrl || DEFAULT_IMAGE_SETTINGS.sdUrl).replace(/\/$/, '');
  if (!fresh && caps.has(base)) return caps.get(base);
  const out = { adetailer: false, upscalers: [] };
  try {
    const sc = await getJson(`${base}/sdapi/v1/scripts`);
    out.adetailer = [...(sc.txt2img || []), ...(sc.img2img || [])].some((n) => /adetailer/i.test(n));
  } catch { /* старый A1111 — считаем, что нет */ }
  try { out.upscalers = (await getJson(`${base}/sdapi/v1/upscalers`)).map((u) => u.name).filter(Boolean); } catch { /* пусто */ }
  caps.set(base, out);
  return out;
}

const GEN_TIMEOUT_MS = 300000; // второй проход и дорисовка лиц на 12 ГБ — до пары минут

function parseSize(s) {
  const m = String(s || '').match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 832, height: 1216 };
}

export async function pingSd(sdUrl) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`${sdUrl.replace(/\/$/, '')}/sdapi/v1/options`, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const opt = await res.json();
    const c = await sdCaps(sdUrl, true);
    return { ok: true, model: opt.sd_model_checkpoint || '?', adetailer: c.adetailer, upscalers: c.upscalers };
  } catch (e) {
    throw new Error(`A1111 не отвечает по адресу ${sdUrl}: ${e.name === 'AbortError' ? 'таймаут' : e.message}. Запущен ли webui с флагом --api?`);
  } finally { clearTimeout(t); }
}

// Возвращает PNG как Buffer, итоговый промт и сид.
// opts.kind === 'scene' — стиль, негатив и размер для иллюстраций сцен; opts.seed — повтор кадра.
export async function txt2img(settings, tags, opts = {}) {
  const base = String(settings.sdUrl || DEFAULT_IMAGE_SETTINGS.sdUrl).replace(/\/$/, '');
  const scene = opts.kind === 'scene';
  const { width, height } = parseSize(scene ? (settings.sceneSize || DEFAULT_IMAGE_SETTINGS.sceneSize) : settings.imageSize);
  const style = scene ? (settings.sceneStyle ?? DEFAULT_IMAGE_SETTINGS.sceneStyle) : (settings.imageStyle || DEFAULT_IMAGE_SETTINGS.imageStyle);
  const prompt = [style, tags].filter(Boolean).join(', ');
  const seed = Number.isInteger(Number(opts.seed)) && String(opts.seed).trim() !== '' && Number(opts.seed) >= 0 ? Number(opts.seed) : -1;
  const body = {
    prompt,
    negative_prompt: scene ? (settings.sceneNegative ?? DEFAULT_IMAGE_SETTINGS.sceneNegative) : (settings.imageNegative ?? DEFAULT_IMAGE_SETTINGS.imageNegative),
    width, height,
    steps: Number(settings.imageSteps) || DEFAULT_IMAGE_SETTINGS.imageSteps,
    cfg_scale: Number(settings.imageCfg) || DEFAULT_IMAGE_SETTINGS.imageCfg,
    sampler_name: settings.imageSampler || DEFAULT_IMAGE_SETTINGS.imageSampler,
    seed,
    batch_size: 1,
  };
  const warnings = [];
  const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
  const clipSkip = num(settings.imageClipSkip, DEFAULT_IMAGE_SETTINGS.imageClipSkip);
  if (clipSkip >= 1) {
    body.override_settings = { CLIP_stop_at_last_layers: clipSkip };
    body.override_settings_restore_afterwards = true;
  }
  const c = await sdCaps(base);
  // Второй проход в большем разрешении — только для сцен: там лица мелкие.
  if (scene && (settings.sceneHires ?? DEFAULT_IMAGE_SETTINGS.sceneHires)) {
    let up = String(settings.hiresUpscaler || DEFAULT_IMAGE_SETTINGS.hiresUpscaler);
    if (c.upscalers.length && !c.upscalers.includes(up)) {
      const alt = c.upscalers.find((u) => /R-ESRGAN 4x\+$|ESRGAN_4x|4x/i.test(u)) || 'Latent';
      warnings.push(`апскейлера «${up}» нет, взят «${alt}»`);
      up = alt;
    }
    Object.assign(body, {
      enable_hr: true,
      hr_scale: Math.min(2, Math.max(1.1, num(settings.hiresScale, DEFAULT_IMAGE_SETTINGS.hiresScale))),
      hr_upscaler: up,
      denoising_strength: Math.min(0.8, Math.max(0.1, num(settings.hiresDenoise, DEFAULT_IMAGE_SETTINGS.hiresDenoise))),
      hr_second_pass_steps: Math.max(10, Math.round(body.steps * 0.6)),
    });
  }
  // Дорисовка лиц ADetailer'ом — если расширение установлено.
  if (settings.faceFix ?? DEFAULT_IMAGE_SETTINGS.faceFix) {
    if (c.adetailer) {
      body.alwayson_scripts = { ADetailer: { args: [true, false, {
        ad_model: 'face_yolov8n.pt', ad_confidence: 0.3, ad_denoising_strength: 0.4,
        ad_inpaint_only_masked: true, ad_inpaint_only_masked_padding: 32,
        ad_negative_prompt: 'bad eyes, deformed eyes, asymmetrical eyes, cross-eyed, extra mouth, deformed mouth, distorted face',
      }] } };
    } else warnings.push('ADetailer не установлен — лица не дорисовывались');
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), GEN_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${base}/sdapi/v1/txt2img`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Генерация не уложилась в 5 минут.' : `Не удалось связаться с A1111 (${base}): ${e.message}`);
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error(`A1111 ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json();
  const b64 = data?.images?.[0];
  if (!b64) throw new Error('A1111 вернул пустой ответ.');
  let usedSeed = seed;
  try { const info = typeof data.info === 'string' ? JSON.parse(data.info) : data.info; if (Number.isFinite(info?.seed)) usedSeed = info.seed; } catch { /* без сида */ }
  return { png: Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64'), prompt, seed: usedSeed, width, height, warnings, hires: Boolean(body.enable_hr), faceFix: Boolean(body.alwayson_scripts) };
}
