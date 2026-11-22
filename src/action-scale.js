// Правила физических действий включаются отдельно для каждой партии.
export const SCALE = ['обычный', 'усиленный', 'исполинский', 'божественный'];
export const POWER_KINDS = ['сила', 'полёт', 'бестелесность', 'касание духов'];
const key = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
function tier(v) {
  if (!['string', 'number'].includes(typeof v) || !/^[0-3]$/.test(String(v))) throw new RangeError('Масштаб должен быть от 0 до 3.');
  return +v;
}

export function readPower(raw) {
  if (!raw) return null;
  if (!POWER_KINDS.includes(raw.kind)) throw new RangeError('Неизвестная возможность.');
  const power = { kind: raw.kind };
  if (raw.kind === 'сила') power.tier = tier(raw.tier);
  if (raw.when) power.when = String(raw.when).trim().slice(0, 100);
  if (raw.charges != null && raw.charges !== '') {
    const n = Number(raw.charges);
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Остаток зарядов должен быть целым неотрицательным числом.');
    power.charges = n;
  }
  return power;
}

export function readBody(raw) {
  if (!raw) return null;
  const strength = tier(raw.strength);
  return strength || raw.intangible === true ? { strength, intangible: raw.intangible === true } : null;
}

export function parseBarriers(text) {
  const out = [];
  for (const line of String(text).split('\n').filter((s) => s.trim())) {
    const match = /^(.{1,100}?)\s*\|\s*([0-3])\s*$/u.exec(line.trim());
    if (!match || !match[1].trim() || match[1].includes('|')) throw new RangeError('Преграда записывается строкой «Название | 0–3».');
    if (out.some((x) => key(x.name) === key(match[1]))) throw new RangeError('Название преграды повторяется.');
    out.push({ name: match[1].trim(), tier: +match[2] });
  }
  return out;
}

function available(hero, b) {
  return !b.power.when || hero.blocks.some((s) => s.type === 'status' && key(s.name) === key(b.power.when));
}

export function scaleSchema(state, heroes) {
  const sources = heroes.flatMap((h) => (h.blocks || []).filter((b) => b.power && available(h, b)).map((b) =>
    `${h.name}: ${b.name} (${b.power.kind}${b.power.kind === 'сила' ? ' ' + b.power.tier : ''}${b.power.charges != null ? ', заряды ' + b.power.charges : ''})`));
  const near = new Set((state.scene?.present || []).map(key));
  const npcs = (state.npcs || []).filter((n) => !n.archived && n.bodyScale && (near.has(key(n.name)) || n.bound)).map((n) => `${n.name}: сила ${n.bodyScale.strength}${n.bodyScale.intangible ? ', бестелесен' : ''}`);
  return {
    approach: { type: 'string', enum: ['обычное', 'сила', 'полёт', 'бестелесность', 'касание'],
      description: 'Для обычной проверки — обычное. Для прямого силового воздействия, полёта, прохода сквозь материю или физического касания/удара вызови инструмент даже при очевидном исходе. НПС: ' + (npcs.join('; ') || 'обычные') },
    source: { type: 'string', description: 'Точное название применяемого источника с листа. Постоянная активная возможность подставится сама. Для расхода заряда обязательно назови источник. ' + sources.join('; ') },
    stake: { type: 'string', description: 'Только если остаётся риск: что конкретно решит бросок (например, успеет ли пройти спутник). Без риска опусти.' },
    obstacle_tier: { type: 'integer', minimum: 0, maximum: 3, description: 'Только для новой неодушевлённой силовой преграды. target — уникальное название с местом. 0 человек, 1 усиленный, 2 исполин, 3 божественный. Известные: ' + (state.scaleBarriers || []).slice(-8).map((b) => b.name + '=' + b.tier).join('; ') },
  };
}

// Повтор одного применения за ход возвращает тот же результат, включая первоначальный бросок.
export function resolveScaled(state, hero, args, used, roll) {
  const mode = args.approach;
  if (!['сила', 'полёт', 'бестелесность', 'касание'].includes(mode)) throw new RangeError('Укажи подход к действию.');
  const name = String(args.target || '').trim();
  if (!name || name.length > 100 || /[|\r\n]/.test(name)) throw new RangeError('Укажи точное название цели (до 100 символов).');
  const npc = (state.npcs || []).find((n) => !n.archived && [n.name, ...(n.aliases || [])].some((s) => key(s) === key(name)));
  const kind = mode === 'касание' ? 'касание духов' : mode;
  const source = String(args.source || '').trim();
  const powers = (hero.blocks || []).filter((b) => b.power);
  const sources = powers.filter((b) => key(b.name) === key(source));
  if (source && sources.length !== 1) throw new RangeError('Нужен один однозначно названный источник с листа героя.');
  // Постоянная или активная форма применяется сама. Расходный предмет выбирают явно.
  const free = powers.filter((x) => x.power.kind === kind && x.power.charges == null && available(hero, x));
  const b = source ? sources[0] : free.sort((a, b) => (b.power.tier || 0) - (a.power.tier || 0))[0];
  const p = b?.power;
  const id = JSON.stringify([hero.id, mode, npc?.id || key(name), b?.id]);
  if (used.has(id)) return used.get(id);
  const stake = String(args.stake || '').trim().slice(0, 220);
  let reason, blocked = false, barrier;
  if (p && p.kind !== kind && !(mode === 'сила' && npc?.bodyScale?.intangible && p.kind === 'касание духов')) throw new RangeError('Возможность источника не соответствует подходу.');
  if (b && !available(hero, b)) { blocked = true; reason = 'Нужно состояние «' + p.when + '».'; }
  else if (p?.charges === 0) { blocked = true; reason = 'Заряды исчерпаны.'; }
  else if (['сила', 'касание'].includes(mode) && npc?.bodyScale?.intangible && p?.kind !== 'касание духов') {
    blocked = true; reason = 'Цель бестелесна.';
  } else if (mode === 'сила') {
    const known = (state.scaleBarriers || []).find((x) => key(x.name) === key(name));
    const required = npc ? (npc.bodyScale?.strength || 0) : known?.tier ?? tier(args.obstacle_tier);
    if (!npc && !known) barrier = { name, tier: required };
    const strength = p?.tier || 0;
    blocked = strength < required;
    reason = `Сила: ${SCALE[strength]}. Сопротивление: ${SCALE[required]}.`;
    if (npc && strength === required && !stake) throw new RangeError('Силы сопоставимы. Укажи, что решит бросок.');
  } else if (mode !== 'касание' && !p) {
    blocked = true; reason = 'На листе нет применённой возможности «' + mode + '».';
  } else reason = 'Действие доступно.';

  const action = { mode, target: name, source: b?.name, stake: stake || undefined, reason };
  const result = !blocked && stake ? roll() : { success: !blocked, outcome: blocked ? 'невозможно этим способом' : 'автоматический успех' };
  if (!blocked && p?.charges != null) { p.charges -= 1; action.remaining = p.charges; }
  if (barrier) (state.scaleBarriers ||= []).push(barrier);
  result.action = action;
  used.set(id, result);
  return result;
}

export function actionText(r) {
  const a = r.action;
  return [a.target, a.source, a.reason, a.stake && 'Ставка: ' + a.stake, r.outcome, a.remaining != null && 'Зарядов осталось: ' + a.remaining].filter(Boolean).join(' · ');
}
