// Кнопка ✨: заполнить одно поле карточки НПС или героя по материалам истории.

import { callOpenRouter, stripToolMarkup, toolModelOf } from './llm.js';
import { KIND_FIELDS, KIND_LABEL } from './codex.js';

// ---- Заполнить поле карточки по истории (кнопка ✨) ----
// Учётчик пишет только перемены последнего хода; эта функция собирает всё, что
// история знает о персонаже, и заполняет одно поле целиком. Результат не
// сохраняется — его показывают игроку для правки.
const FILL_RULES = {
  appearance: 'ВНЕШНОСТЬ: постоянные приметы — возраст на вид, рост и сложение, лицо, волосы, глаза, кожа, шрамы и особые приметы, обычная одежда и снаряжение. ' +
    'Не временное (грязь, мокрая одежда, румянец) и не эмоции. 2–5 предложений.',
  description: 'КТО ЭТО (постоянное): роль и занятие, происхождение, возраст, родня, положение. Без событий истории и без того, где он сейчас. 1–3 предложения.',
  personality: 'ХАРАКТЕР: нрав, ценности, привычки, как держится с людьми и с героем. Без внешности. 2–4 предложения.',
  status: 'СТАТУС: где персонаж сейчас и в каком он состоянии, по САМЫМ ПОСЛЕДНИМ событиям. До 12 слов.',
  history: 'ЧТО БЫЛО С ГЕРОЕМ: ключевые события между персонажем и героем по порядку, коротко, через «; ». Только значимое.',
  wants: 'ЧЕГО ХОЧЕТ: конкретная цель персонажа сейчас, одной фразой.',
  quirk: 'ИЗЮМИНКА: одна запоминающаяся странность, привычка или противоречие в персонаже, одной фразой.',
  secret: 'ЧТО СКРЫВАЕТ: тайна персонажа, о которой герой не знает или знает не всё, одной-двумя фразами.',
  links: 'СВЯЗИ: отношения с другими персонажами (не с героем), через «; » — «сестра Риты; должна Барону».',
  attitude: 'ОТНОШЕНИЕ К ГЕРОЮ: каким оно стало по последним событиям, 2–5 слов («настороженно-вежлив», «открыто враждебна»).',
  social: 'ПОЛОЖЕНИЕ героя в обществе: занятие, статус, кем его считают, одной фразой.',
  persona: 'ОПИСАНИЕ ГЕРОЯ: кто он, характер, предыстория, манеры — связным текстом, 3–8 предложений.',
  mood: 'НАСТРОЕНИЕ сейчас и его причина по последним событиям. Верни JSON {"mood": "2–4 слова", "reason": "почему, одной фразой"}.',
  voice: 'ГОЛОС: как персонаж говорит. Верни JSON {"style": "манера речи", "humor": "как шутит или что не шутит", "habits": "словечки, обращения, привычки речи", ' +
    '"samples": ["характерные реплики, по одной"], "masks": "как прячет чувства в речи", "taboos": "чего в его речи никогда не бывает"}. ' +
    'Пустые пункты — пустой строкой.',
};
const JSON_FIELDS = new Set(['voice', 'mood']);

const stem5 = (w) => w.toLowerCase().replace(/[^а-яёa-z0-9]/gi, '').slice(0, 5);
const COMMON = new Set(['девуш', 'парен', 'мужчи', 'женщи', 'стари', 'стару', 'челов', 'незна', 'кото', 'котор']);

// Где в ленте упоминается персонаж: первые появления (там обычно описывают) и последние.
function mentionsOf(state, names, budget) {
  const keys = [...new Set(names.flatMap((n) => String(n || '').split(/[\s,«»"()-]+/))
    .filter((w) => w.length >= 4).map(stem5).filter((k) => k.length >= 4 && !COMMON.has(k)))];
  if (!keys.length) return [];
  const hits = [];
  (state.log || []).forEach((e, i) => {
    if (!e || !e.text || (e.role !== 'narrator' && e.role !== 'player')) return;
    const low = e.text.toLowerCase();
    let pos = -1;
    for (const k of keys) { const p = low.indexOf(k); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
    if (pos >= 0) hits.push({ i, pos, e });
  });
  const pick = hits.length > 8 ? [...hits.slice(0, 4), ...hits.slice(-4)] : hits;
  const out = []; let used = 0;
  for (const h of pick) {
    const t = h.e.text;
    const from = Math.max(0, h.pos - 500);
    const piece = (from > 0 ? '…' : '') + t.slice(from, from + 1300) + (from + 1300 < t.length ? '…' : '');
    if (used + piece.length > budget) break;
    used += piece.length;
    out.push(`[реплика ${h.i + 1}${h.e.role === 'player' ? ', игрок' : ''}] ${piece}`);
  }
  return out;
}

function recentLog(state, n, budget) {
  const tail = (state.log || []).filter((e) => e && e.text && (e.role === 'narrator' || e.role === 'player')).slice(-n);
  let txt = tail.map((e) => (e.role === 'player' ? '> ' : '') + e.text).join('\n\n');
  if (txt.length > budget) txt = '…' + txt.slice(-budget);
  return txt;
}

export async function fillField({ state, apiKey, kind, field, mode, card }) {
  const rule = FILL_RULES[field];
  if (!rule) throw new Error('Это поле нельзя заполнить автоматически.');
  if (kind === 'hero' && !['appearance', 'social', 'persona'].includes(field)) throw new Error('Это поле героя нельзя заполнить автоматически.');
  const c = card || {};
  const name = String(c.name || '').trim() || (kind === 'hero' ? 'герой' : 'персонаж');
  const invent = mode === 'invent';
  const names = [name, ...(Array.isArray(c.aliases) ? c.aliases : [])];
  const mentions = kind === 'hero' ? [] : mentionsOf(state, names, 6000);
  const recent = recentLog(state, kind === 'hero' ? 10 : 4, kind === 'hero' ? 6000 : 2500);
  const events = (state.events || []).filter((e) => (e.participants || []).some((p) => stem5(p) === stem5(name))).slice(-10);
  const current = JSON_FIELDS.has(field) ? c[field] : String(c[field] || '').trim();
  const cardLines = Object.entries(c)
    .filter(([k, v]) => v && k !== field && !['id', 'aliases'].includes(k) && (typeof v === 'string' ? v.trim() : true))
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  const narration = state.narration === 'third' ? 'от третьего лица' : state.narration === 'second_vy' ? 'от второго лица («вы»)' : 'от второго лица («ты»)';

  const system =
    `Ты — учётчик текстовой RPG. Заполни ОДНО поле карточки ${kind === 'hero' ? 'героя игрока' : 'персонажа'} «${name}» по материалам истории.\n` +
    rule + '\n\n' +
    (invent
      ? 'РЕЖИМ «ПРИДУМАТЬ»: возьми всё, что известно из истории и карточки, а недостающее придумай — правдоподобно, в духе мира, роли и характера персонажа. ' +
        'Не противоречь тексту и карточке. Не делай персонажа ярче или необычнее, чем он выглядит в истории.\n'
      : 'РЕЖИМ «ИЗ ТЕКСТА»: только то, что прямо сказано в истории или однозначно из неё следует. Ничего не додумывай. ' +
        'Если в материалах об этом нет ничего — ответь ровно словом NONE.\n') +
    (current && (typeof current === 'string' ? current : Object.values(current).some((v) => v && String(v).trim()))
      ? 'В поле уже есть текст — СОХРАНИ всё, что в нём сказано, и дополни новым. Если история прямо противоречит записанному — побеждает более позднее.\n'
      : '') +
    (kind === 'hero' ? `Повествование ведётся ${narration}${state.narration === 'third' ? '' : `: обращение к игроку в тексте рассказчика — это и есть герой ${name}`}.\n` : '') +
    (field === 'voice' && !invent ? 'samples — только ДОСЛОВНЫЕ реплики персонажа из текста, без изменений.\n' : '') +
    'Пиши по-русски, в третьем лице, без вступлений и пояснений. ' +
    (JSON_FIELDS.has(field) ? 'Верни только JSON.' : 'Верни только текст поля.');

  const user =
    (state.worldPrompt ? `МИР (кратко): ${String(state.worldPrompt).slice(0, 600)}\n\n` : '') +
    (current ? `ТЕКУЩЕЕ ЗНАЧЕНИЕ ПОЛЯ:\n${typeof current === 'string' ? current : JSON.stringify(current, null, 1)}\n\n` : '') +
    (cardLines ? `ОСТАЛЬНАЯ КАРТОЧКА:\n${cardLines.slice(0, 2500)}\n\n` : '') +
    (state.summary && state.summary.trim() ? `ПРЕДЫСТОРИЯ (сжатая):\n${state.summary.trim().slice(0, 2000)}\n\n` : '') +
    (events.length ? `ХРОНИКА О НЁМ:\n${events.map((e) => '- ' + e.text).join('\n')}\n\n` : '') +
    (mentions.length ? `ГДЕ ОН ПОЯВЛЯЕТСЯ В ИСТОРИИ (по порядку):\n${mentions.join('\n\n')}\n\n` : '') +
    `ПОСЛЕДНИЕ СОБЫТИЯ:\n${recent || '(история ещё не началась)'}`;

  const data = await callOpenRouter({
    purpose: `заполнить поле: ${field}`, model: toolModelOf(state), apiKey, temperature: invent ? 0.7 : 0.2, noReasoning: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  let raw = stripToolMarkup(String(data?.choices?.[0]?.message?.content || '')).trim();
  raw = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (!raw || /^NONE\b/i.test(raw) || /^(в тексте|в истории) (об этом )?(ничего )?не (сказано|описан)/i.test(raw)) {
    return { none: true, mentions: mentions.length };
  }
  if (JSON_FIELDS.has(field)) {
    const m = raw.match(/\{[\s\S]*\}/);
    let obj = null;
    try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
    if (!obj) throw new Error('Модель вернула не то, что нужно, — попробуйте ещё раз.');
    if (field === 'voice') {
      const s = (v) => (Array.isArray(v) ? v.join('; ') : String(v || '')).trim();
      const samples = (Array.isArray(obj.samples) ? obj.samples : String(obj.samples || '').split(/\n+/))
        .map((x) => String(x).trim().replace(/^[-—•]\s*/, '')).filter(Boolean).slice(0, 8);
      return { values: { voiceStyle: s(obj.style), voiceHumor: s(obj.humor), voiceHabits: s(obj.habits), voiceSamples: samples, voiceMasks: s(obj.masks), voiceTaboos: s(obj.taboos) }, mentions: mentions.length };
    }
    return { values: { mood: String(obj.mood || '').trim(), moodReason: String(obj.reason || '').trim() }, mentions: mentions.length };
  }
  // Модель иногда начинает с подписи поля («Внешность: …») — убираем её.
  const label = FILL_RULES[field].split(/[\s:(]/)[0].toLowerCase();
  let value = raw.replace(/^[«"]|[»"]$/g, '').trim();
  const head = value.match(/^([^:\n]{2,40}):\s*/);
  if (head && head[1].toLowerCase().startsWith(label.slice(0, 5))) value = value.slice(head[0].length).trim();
  return { value, mentions: mentions.length };
}

// ---- ✨ Выжимка статьи кодекса ----
// Одна-две фразы, суть для рассказчика: она идёт в промт вместо полной статьи.

export async function writeBrief({ state, apiKey, entry }) {
  const e = entry || {};
  const kind = KIND_FIELDS[e.kind] ? e.kind : 'other';
  const fields = KIND_FIELDS[kind].map(([k, label]) => (e.fields && e.fields[k] ? `${label}: ${e.fields[k]}` : '')).filter(Boolean);
  const rel = (e.relations || []).map((r) => `${r.to}: ${r.text}`);
  const source = [fields.join('\n'), rel.length ? 'Отношения к другим народам:\n' + rel.join('\n') : '', String(e.content || '').trim()].filter(Boolean).join('\n\n');
  if (!source.trim()) throw new Error('В статье пока нечего сжимать — заполни описание или поля.');
  const system =
    `Ты сжимаешь статью кодекса мира ролевой игры (раздел: ${KIND_LABEL[kind]}) в ВЫЖИМКУ для рассказчика: ` +
    'одна-две фразы, до 200 знаков, по-русски. Только то, что важно для игры: кто или что это, главная отличительная черта, ' +
    (kind === 'creature' ? 'чем опасно и чего боится. ' : kind === 'people' ? 'нрав и с кем не ладят. ' : kind === 'faction' ? 'чего добиваются. ' : kind === 'place' ? 'чем примечательно и опасно. ' : kind === 'magic' ? 'что делает с тем, на кого действует, и как снимается. ' : 'суть. ') +
    'Ничего не выдумывай сверх статьи. Без вступлений, кавычек и названия статьи в начале — только текст выжимки.';
  const user = (state.worldPrompt ? `МИР (кратко): ${String(state.worldPrompt).slice(0, 400)}\n\n` : '') + `СТАТЬЯ «${e.title || ''}»:\n${source.slice(0, 4000)}`;
  const data = await callOpenRouter({
    purpose: 'выжимка кодекса', model: toolModelOf(state), apiKey, temperature: 0.2, noReasoning: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  let text = stripToolMarkup(String(data?.choices?.[0]?.message?.content || '')).trim().replace(/^[«"]|[»"]$/g, '').trim();
  text = text.replace(new RegExp(`^${String(e.title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—:-]\\s*`, 'i'), '');
  if (!text) throw new Error('Модель не вернула выжимку — попробуй ещё раз.');
  return text.length > 260 ? text.slice(0, 259).replace(/\s+\S*$/, '') + '…' : text;
}

// ---- ✂ Разобрать большую статью на отдельные ----
// Игрок держит «типы рун и их эффекты» одной статьёй; чтобы каждая руна стала своей статьёй (и состоянием),
// модель учёта раскладывает текст на записи. Ничего не сохраняет — это делает вызывающий.
export async function splitArticle({ state, apiKey, entry }) {
  const e = entry || {};
  const source = [String(e.brief || '').trim(), ...Object.values(e.fields || {}).map(String), String(e.content || '').trim()].filter(Boolean).join('\n\n');
  if (source.trim().length < 20) throw new Error('В статье нечего разбирать — сначала впиши в неё список разновидностей.');
  const system =
    'Ты разбираешь статью кодекса ролевой игры. Разбей статью на отдельные записи — по одной на каждую разновидность, перечисленную в ней ' +
    '(виды рун, заклинаний, болезней, зелий и т. п.). Бери только то, что написано в статье: ничего не придумывай и не дополняй.\n' +
    'Верни ТОЛЬКО JSON-массив, без пояснений. Каждая запись: {"title": "название как в статье", "brief": "суть одной фразой, до 160 знаков", ' +
    '"effect": "что делает с тем, на кого действует", "look": "как выглядит", "how": "как возникает и снимается"}. ' +
    'Чего в статье нет — оставь пустой строкой. Общие сведения о явлении в целом в записи не включай.';
  const data = await callOpenRouter({
    purpose: 'разбор статьи кодекса', model: toolModelOf(state), apiKey, temperature: 0.1, noReasoning: true, maxTokens: 12000,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `СТАТЬЯ «${e.title || ''}»:\n${source.slice(0, 24000)}` }],
  });
  const raw = stripToolMarkup(String(data?.choices?.[0]?.message?.content || ''));
  const a = raw.indexOf('['); const b = raw.lastIndexOf(']');
  let items = null;
  if (a !== -1 && b > a) { try { items = JSON.parse(raw.slice(a, b + 1)); } catch { items = null; } }
  if (!Array.isArray(items)) throw new Error('Модель не вернула список разновидностей — попробуй ещё раз или другой моделью учёта.');
  const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const seen = new Set();
  return items.filter((x) => x && typeof x === 'object').map((x) => ({
    title: clean(x.title, 80), brief: clean(x.brief, 260), effect: clean(x.effect, 600), look: clean(x.look, 400), how: clean(x.how, 400),
  })).filter((x) => x.title && !seen.has(x.title.toLowerCase()) && seen.add(x.title.toLowerCase())).slice(0, 80);
}
