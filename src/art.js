// Картинки: теги портрета и раскадровка сцены для Automatic1111 (запросы к модели учёта).

import { clockLabel, dayPart } from './scene.js';
import { callOpenRouter, stripToolMarkup, toolModelOf } from './llm.js';


// Перевести описание внешности в теги для SD (booru-стиль). Один дешёвый запрос.
export async function portraitTags({ state, apiKey, subject }) {
  const { name, appearance, description, race, social, kind } = subject;
  const facts = [
    race ? `раса: ${race}` : '',
    appearance ? `внешность: ${appearance}` : '',
    !appearance && description ? `описание: ${description}` : '',
    social ? `положение: ${social}` : '',
    state.worldPrompt ? `сеттинг (кратко): ${String(state.worldPrompt).slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content:
      'Ты переводишь описание персонажа в теги для генерации портрета (Stable Diffusion, booru-теги на английском). ' +
      'Верни ТОЛЬКО строку тегов через запятую, 15–30 тегов, без пояснений.\n' +
      'ОБЯЗАТЕЛЬНО первыми: 1girl / 1boy / 1other, затем ЯВНЫЙ возраст — модель по умолчанию рисует подростков, поэтому для взрослых пиши ' +
      '"mature male" или "mature female", "adult", "<N> years old" (если возраст известен), для стариков "old man"/"old woman", "wrinkles". ' +
      'Затем телосложение (muscular, stocky, slender, tall), рост если он большой (tall), волосы (цвет, длина, причёска), глаза, ' +
      'растительность на лице (stubble, beard, clean-shaven — для мужчин укажи всегда), шрамы и особые приметы, одежда и снаряжение, ' +
      'предметы на поясе или в руках (sword at hip, potion vials), выражение лица, эпоха/сеттинг (medieval, noir, cyberpunk…).\n' +
      'Переводи КАЖДУЮ названную деталь в тег, ничего не опускай. Не добавляй теги качества и стиля — они подставятся отдельно. ' +
      'Не выдумывай того, чего нет в описании.' },
    { role: 'user', content: `${kind === 'hero' ? 'Герой' : 'Персонаж'}: ${name}\n${facts || '(описания нет — только имя)'}` },
  ];
  const data = await callOpenRouter({ purpose: 'теги портрета', model: toolModelOf(state), messages, apiKey, temperature: 0.3, noReasoning: true });
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  return stripToolMarkup(text).replace(/^[^:]*теги[^:]*:\s*/i, '').replace(/\n+/g, ', ').replace(/[.\s]+$/, '');
}

// ---- Иллюстрация сцены ----
// Модель учёта работает раскадровщиком: выбирает ОДИН момент фрагмента и
// переводит его в booru-теги. Приметы персонажей берёт из их портретных тегов,
// чтобы на картинках сцены они были похожи на свои портреты.
const PORTRAIT_ONLY = /^(portrait|upper body|looking at viewer|close-up portrait|headshot|simple background|dark moody background|detailed face)$/i;
const nameStem = (n) => String(n || '').toLowerCase().split(/\s+/)[0].slice(0, 5);

function sceneCandidates(ctx) {
  const text = String(ctx.text || '').toLowerCase();
  const mentioned = (name) => { const st = nameStem(name); return st.length >= 3 && text.includes(st); };
  const present = new Set(((ctx.scene && ctx.scene.present) || []).map(nameStem));
  const out = [];
  for (const c of ctx.characters || []) {
    if (!(c.active || (c.present && mentioned(c.name)))) continue;
    out.push({ name: c.name, role: c.active ? 'герой (от его лица рассказ)' : 'герой', race: c.race, appearance: c.appearance, social: c.social, tags: c.portraitTags });
  }
  for (const n of ctx.npcs || []) {
    if (n.archived) continue;
    if (!(present.has(nameStem(n.name)) || mentioned(n.name))) continue;
    out.push({ name: n.name, role: 'НПС', race: n.race, appearance: n.appearance || n.description, social: n.social, tags: n.portraitTags });
  }
  return out.slice(0, 8).map((c) => ({
    ...c,
    tags: c.tags ? c.tags.split(',').map((t) => t.trim()).filter((t) => t && !PORTRAIT_ONLY.test(t)).join(', ') : '',
  }));
}

export async function sceneTags({ state, apiKey, ctx }) {
  const sc = ctx.scene || {};
  const cands = sceneCandidates(ctx);
  const who = cands.length
    ? cands.map((c) => `- ${c.name} (${c.role})${c.race ? ', раса: ' + c.race : ''}` +
        (c.tags ? `\n  ТЕГИ ПРИМЕТ (бери дословно): ${c.tags}` : c.appearance ? `\n  внешность: ${String(c.appearance).slice(0, 400)}` : '\n  внешность не описана') +
        (c.social ? `\n  положение: ${String(c.social).slice(0, 120)}` : '')).join('\n')
    : '(никого известного — кадр на месте и атмосфере)';
  const text = String(ctx.text || '');
  const system =
    'Ты — художник-раскадровщик. По фрагменту ролевой истории выбери ОДИН кадр — самый выразительный момент фрагмента — ' +
    'и опиши его booru-тегами на английском для Stable Diffusion (Pony). Не пересказывай весь фрагмент: один момент, одна композиция.\n' +
    'Верни СТРОГО JSON без пояснений: {"moment": "что на кадре, одной фразой по-русски", "characters": ["имена тех, кто в кадре"], "tags": "теги через запятую"}\n\n' +
    'ТЕГИ (25–45), по порядку:\n' +
    '1. Кто в кадре: "no humans" — если кадр на месте; иначе 1girl / 1boy / 1girl, 1boy / 2boys / 2girls. НЕ БОЛЬШЕ ДВУХ персонажей с приметами — ' +
    'больше модель путает. Толпа и массовка — "crowd, silhouettes, faceless" без примет.\n' +
    '2. План. Лица на картинке должны быть КРУПНЫМИ — мелкие лица модель рисует уродливо. ' +
    'Есть персонаж — cowboy shot или upper body (разговор, эмоция), close-up (действие, руки, взгляд); двое — cowboy shot, лицом друг к другу или к зрителю. ' +
    'wide shot / full body / establishing shot — ТОЛЬКО для кадра без людей (no humans) или с героем со спины (from behind, лица не видно). ' +
    'Напряжение, бой — dutch angle.\n' +
    '3. Приметы каждого, кто в кадре: если даны ТЕГИ ПРИМЕТ — дословно, иначе переведи внешность. Приметы двоих не перемешивай: сначала все первого, потом все второго.\n' +
    '4. Действие и поза, взаимодействие, выражение лица — по тексту.\n' +
    '5. Место: интерьер/экстерьер, ключевые предметы, архитектура, погода.\n' +
    '6. Свет по времени суток и источникам (candlelight, torchlight, moonlight, sunset, overcast, fireplace glow) и настроение.\n' +
    '7. Сеттинг и эпоха (medieval fantasy, dark fantasy, victorian, cyberpunk…) — из описания мира.\n' +
    'Не добавляй теги качества, стиля и рейтинга — они подставятся сами. Ничего не выдумывай сверх текста, кроме уместных деталей окружения. ' +
    'Кровь, раны, насилие — смягчай: напряжение, оружие, позы, но не увечья.';
  const user =
    (state.worldPrompt ? `МИР (кратко): ${String(state.worldPrompt).slice(0, 400)}\n\n` : '') +
    `МЕСТО: ${sc.location || 'не указано'}` +
    (Number.isFinite(sc.day) ? `\nВРЕМЯ: ${clockLabel(sc)}` : '') +
    (sc.note ? `\nОБСТАНОВКА: ${sc.note}` : '') +
    `\n\nКТО МОЖЕТ БЫТЬ В КАДРЕ:\n${who}\n\n` +
    (ctx.action ? `ДЕЙСТВИЕ ИГРОКА: ${String(ctx.action).slice(0, 400)}\n\n` : '') +
    `ФРАГМЕНТ:\n${text.length > 3000 ? text.slice(0, 3000) + '…' : text}`;
  const data = await callOpenRouter({
    purpose: 'теги сцены', model: toolModelOf(state), apiKey, temperature: 0.4, noReasoning: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  const raw = String(data?.choices?.[0]?.message?.content || '').trim();
  let parsed = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { parsed = JSON.parse(m[0]); } catch { /* не JSON */ } }
  let tags = parsed && typeof parsed.tags === 'string' ? parsed.tags : stripToolMarkup(raw).replace(/^[^:]*теги[^:]*:\s*/i, '');
  tags = tags.replace(/\n+/g, ', ').replace(/\s*,\s*/g, ', ').replace(/(, )+/g, ', ').replace(/^[,\s]+|[.,\s]+$/g, '');
  if (!tags) throw new Error('Модель не вернула описание кадра — попробуйте ещё раз или другую модель учёта.');
  return {
    tags,
    moment: parsed && typeof parsed.moment === 'string' ? parsed.moment.trim() : '',
    characters: parsed && Array.isArray(parsed.characters) ? parsed.characters.map(String).slice(0, 4) : [],
    candidates: cands.map((c) => ({ name: c.name, hasPortraitTags: Boolean(c.tags) })),
    light: Number.isFinite(sc.minute) ? dayPart(sc.minute) : '',
  };
}
