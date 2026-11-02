// Тестовые сцены для учётчика: типовые ходы и что после них должно быть в мире.
// Проверяется не дословный набор вызовов, а результат: модель вправе назвать
// предмет чуть иначе или сделать лишний безвредный вызов.
//
// Сцена: setup(state) — мир до хода; narration — фрагмент; must — что обязано
// получиться; forbid — чего быть не должно (лишние записи, порча данных);
// ideal — вызовы, которые сделал бы идеальный учётчик (по ним сцены проверяются
// в npm test без модели).
import { normalizeEvents } from '../src/chronicle.js';

// ---- Помощники для проверок ----
const H = (st) => st.characters.find((c) => c.id === st.activeCharacterId);
const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const like = (name, ...stems) => stems.some((x) => low(name).includes(low(x)));
export const find = (st, type, ...stems) => (H(st).blocks || []).find((b) => b.type === type && like(b.name, ...stems));
const num = (b) => (b ? Number(String(b.value).replace(',', '.').replace(/[^\d.-]/g, '')) : NaN);
const npc = (st, ...stems) => (st.npcs || []).find((n) => like(n.name, ...stems));
const used = (calls, name) => calls.some((c) => c.name === name);
const eventsAdded = (st, before) => (st.events || []).length - before;
const blocksOf = (st) => (H(st).blocks || []).map((b) => `${b.type}:${b.name}=${b.value ?? ''}`).sort().join('|');

const hero = (blocks = []) => (st) => { H(st).blocks = blocks.map((b, i) => ({ id: `b${i}`, ...b })); };
const and = (...fns) => (st) => fns.forEach((f) => f(st));
const npcs = (...list) => (st) => { st.npcs = list.map((n, i) => ({ id: `n${i}`, locked: [], traits: [], ...n })); };
const scene = (s) => (st) => { Object.assign(st.scene, s); };
const events = (...list) => (st) => { st.events = normalizeEvents(list); };

const STD = [
  { type: 'stat', name: 'Здоровье', value: '20', max: 20 },
  { type: 'item', name: 'Кошель', value: '35 золотых' },
  { type: 'item', name: 'Короткий меч' },
];

export const SCENES = [
  {
    id: 'item-received', title: 'Получил предмет',
    setup: and(hero(STD), npcs({ name: 'Ольт', attitude: 'насторожен' }), scene({ location: 'Ворота', present: ['Ольт'] })),
    action: 'Прошу воды',
    narration: 'Ольт снимает с пояса флягу и бросает тебе: «Держи, пока я добрый». Фляга тяжёлая, полная воды.',
    must: [['фляга в инвентаре', (st) => find(st, 'item', 'фляг')]],
    forbid: [['меч и кошель не тронуты', (st) => !find(st, 'item', 'меч') || !find(st, 'item', 'кошел')]],
    ideal: [['block', { type: 'item', name: 'Фляга', value: 'с водой' }], ['npc', { name: 'Ольт', history: 'дал герою флягу' }]],
  },
  {
    id: 'debt-paid', title: 'Вернул долг',
    setup: and(hero(STD), npcs({ name: 'Ольт' }), scene({ present: ['Ольт'] }),
      events({ type: 'debt', text: 'Ян должен Ольту двадцать золотых', participants: ['Ян', 'Ольт'] })),
    action: 'Отдаю долг',
    narration: 'Ты отсчитываешь Ольту двадцать золотых. Он пересчитывает монеты, прячет их и впервые улыбается: «Держишь слово».',
    must: [
      ['денег стало 15', (st) => /15/.test(find(st, 'item', 'кошел')?.value || '') || num(find(st, 'stat', 'золот', 'деньг')) === 15],
      ['долг в хронике закрыт', (st) => st.events[0].status === 'done'],
    ],
    forbid: [['не заведён новый долг', (st) => st.events.filter((e) => e.type === 'debt').length > 1]],
    ideal: [['block', { type: 'item', name: 'Кошель', value: '15 золотых' }], ['event', { action: 'close', id: '#1', outcome: 'done' }], ['npc', { name: 'Ольт', attitude: 'уважает героя' }]],
  },
  {
    id: 'wounded', title: 'Ранение',
    setup: hero(STD),
    action: 'Бросаюсь на разбойника',
    narration: 'Разбойник уходит от удара и полосует тебя ножом по боку. Рана глубокая, рубаха быстро темнеет от крови.',
    must: [['здоровье упало на 15–50%', (st) => { const v = num(find(st, 'stat', 'здоров')); return v >= 10 && v <= 17; }]],
    forbid: [['здоровье не обнулено', (st) => num(find(st, 'stat', 'здоров')) <= 2]],
    ideal: [['block', { type: 'stat', name: 'Здоровье', value: '15' }], ['block', { type: 'status', name: 'Ранен' }]],
  },
  {
    id: 'night-rest', title: 'Ночь сна',
    setup: and(hero([{ type: 'stat', name: 'Здоровье', value: '8', max: 20 }]), scene({ minute: 22 * 60, location: 'Постоялый двор' })),
    action: 'Ложусь спать',
    narration: 'Ты засыпаешь, едва коснувшись подушки, и спишь без снов до самого рассвета. Утром тело ноет меньше.',
    must: [
      ['здоровье выросло', (st) => num(find(st, 'stat', 'здоров')) > 8],
      ['часы ушли на ночь вперёд', (st) => st.scene.day === 2 && st.scene.minute >= 4 * 60 && st.scene.minute <= 10 * 60],
    ],
    forbid: [],
    ideal: [['block', { type: 'stat', name: 'Здоровье', value: '15' }], ['scene', { elapsed_minutes: 480 }]],
  },
  {
    id: 'idle-talk', title: 'Пустой разговор — ничего не менять',
    setup: and(hero(STD), npcs({ name: 'Марта', attitude: 'дружелюбна' }), scene({ present: ['Марта'] })),
    action: 'Спрашиваю про погоду',
    narration: '«Дождь к вечеру будет, — Марта смотрит в окно. — У меня колено ноет, а оно не врёт». Она возвращается к своему вязанию.',
    must: [],
    forbid: [
      ['лист героя не менялся', (st, calls, before) => blocksOf(st) !== before.blocks],
      ['в хронику ничего не добавлено', (st, calls, before) => eventsAdded(st, before.events) > 0],
      ['нить не заведена', (st) => st.threads.length > 0],
    ],
    ideal: [['npc', { name: 'Марта', voice_sample: 'У меня колено ноет, а оно не врёт.' }]],
  },
  {
    id: 'unnamed-gets-name', title: 'Безымянный назвал имя',
    setup: and(hero(STD), npcs({ name: 'Девушка в красном плаще', appearance: 'рыжая, в красном плаще, с арбалетом за спиной' }), scene({ present: ['Девушка в красном плаще'] })),
    action: 'Спрашиваю, как её зовут',
    narration: 'Рыжая поправляет арбалет за спиной и усмехается: «Лира. Запомни, пригодится».',
    must: [['запись переименована в Лиру', (st) => npc(st, 'лира') && !npc(st, 'девушка в красном')]],
    forbid: [['нет двух записей', (st) => st.npcs.length > 1]],
    ideal: [['npc', { name: 'Девушка в красном плаще', new_name: 'Лира' }]],
  },
  {
    id: 'npc-leaves', title: 'НПС ушёл из сцены',
    setup: and(hero(STD.concat([{ type: 'item', name: 'Фонарь' }, { type: 'item', name: 'Верёвка' }])), npcs({ name: 'Ольт' }), scene({ present: ['Ольт'], location: 'Таверна' })),
    action: 'Прощаюсь',
    narration: 'Ольт допивает эль, хлопает тебя по плечу и уходит, хлопнув дверью таверны.',
    must: [['Ольта нет рядом', (st) => !st.scene.present.some((p) => like(p, 'ольт'))]],
    forbid: [['инвентарь героя цел', (st, calls, before) => blocksOf(st) !== before.blocks], ['Ольт не в архиве', (st) => npc(st, 'ольт')?.archived]],
    ideal: [['scene', { present: [] }], ['npc', { name: 'Ольт', status: 'ушёл из таверны' }]],
  },
  {
    id: 'arrow-used', title: 'Израсходован боеприпас',
    setup: hero([{ type: 'item', name: 'Стрелы', value: '10' }, { type: 'item', name: 'Лук' }]),
    action: 'Стреляю в волка',
    narration: 'Ты натягиваешь тетиву и пускаешь стрелу. Она входит волку в бок, и зверь с визгом скрывается в кустах.',
    must: [['стрел стало 9', (st) => num(find(st, 'item', 'стрел')) === 9]],
    forbid: [['лук на месте', (st) => !find(st, 'item', 'лук')]],
    ideal: [['block', { type: 'item', name: 'Стрелы', value: '9' }]],
  },
  {
    id: 'item-given', title: 'Отдал предмет',
    setup: and(hero(STD.concat([{ type: 'item', name: 'Серебряный медальон' }])), npcs({ name: 'Вдова Кэрра' }), scene({ present: ['Вдова Кэрра'] })),
    action: 'Отдаю медальон вдове',
    narration: 'Ты вкладываешь серебряный медальон в ладонь вдовы Кэрры. Она сжимает его и долго молчит. «Спасибо», — шепчет она.',
    must: [['медальона больше нет', (st) => !find(st, 'item', 'медальон')]],
    forbid: [['кошель и меч на месте', (st) => !find(st, 'item', 'кошел') || !find(st, 'item', 'меч')]],
    ideal: [['block', { action: 'remove', type: 'item', name: 'Серебряный медальон' }], ['npc', { name: 'Вдова Кэрра', history: 'герой отдал ей медальон мужа' }]],
  },
  {
    id: 'promise', title: 'Дано обещание',
    setup: and(hero(STD), npcs({ name: 'Брат Ансельм' }), scene({ present: ['Брат Ансельм'] })),
    action: 'Обещаю найти книгу',
    narration: '«Я найду твою книгу до новолуния», — говоришь ты. Брат Ансельм кивает: «Я буду ждать. Не подведи».',
    must: [['обещание в хронике', (st) => st.events.some((e) => e.type === 'promise' || /обещ/i.test(e.text))]],
    forbid: [['не больше двух записей', (st, c, before) => eventsAdded(st, before.events) > 2]],
    ideal: [['event', { type: 'promise', text: 'Ян обещал брату Ансельму найти его книгу до новолуния', participants: ['Ян', 'Брат Ансельм'], when: 'до новолуния' }]],
  },
  {
    id: 'meeting-planned', title: 'Назначена встреча',
    setup: and(hero(STD), npcs({ name: 'Капитан Рейн' }), scene({ present: ['Капитан Рейн'], minute: 10 * 60 })),
    action: 'Соглашаюсь',
    narration: '«Завтра в полдень, у старого маяка, — говорит капитан Рейн. — Опоздаешь — уплыву без тебя».',
    must: [['встреча записана со сроком', (st) => st.events.some((e) => (e.type === 'plan' || /маяк/i.test(e.text)) && (e.when || /полдень|завтра/i.test(e.text)))]],
    forbid: [],
    ideal: [['event', { type: 'plan', text: 'Капитан Рейн ждёт Яна у старого маяка', when: 'завтра в полдень', participants: ['Ян', 'Капитан Рейн'] }]],
  },
  {
    id: 'overdue-closed', title: 'Прошёл срок встречи',
    setup: and(hero(STD), scene({ minute: 11 * 60 + 30, location: 'Рынок' }),
      events({ type: 'plan', text: 'Капитан Рейн ждёт Яна у маяка', when: 'в полдень', participants: ['Ян', 'Капитан Рейн'], at: { day: 1, minute: 600 } })),
    action: 'Брожу по рынку',
    narration: 'Ты бродишь по рынку, торгуешься за яблоки, слушаешь сплетни. Когда спохватываешься, солнце уже клонится к закату.',
    must: [
      ['время ушло далеко за полдень', (st) => st.scene.minute >= 15 * 60],
      ['встреча закрыта или поправлена', (st) => st.events[0].status === 'done' || st.events[0].when !== 'в полдень'],
    ],
    forbid: [],
    ideal: [['scene', { elapsed_minutes: 360 }], ['event', { action: 'close', id: '#1', outcome: 'broken' }]],
  },
  {
    id: 'location-change', title: 'Смена места',
    setup: and(hero(STD), scene({ location: 'Таверна «Кривой якорь»', present: [] })),
    action: 'Иду в порт',
    narration: 'Через полчаса узкие улочки выводят тебя к порту. Пахнет рыбой и смолой, у причалов скрипят мачты.',
    must: [['место — порт', (st) => /порт|причал/i.test(st.scene.location)], ['прошло время', (st) => st.scene.minute > 9 * 60]],
    forbid: [['инвентарь цел', (st, c, before) => blocksOf(st) !== before.blocks]],
    ideal: [['scene', { location: 'Порт, причалы', elapsed_minutes: 30 }]],
  },
  {
    id: 'lie', title: 'Герою солгали',
    setup: and(hero(STD), npcs({ name: 'Трактирщик Бруно' }), scene({ present: ['Трактирщик Бруно'] })),
    action: 'Спрашиваю про постояльца',
    narration: '«Никого похожего не видел», — пожимает плечами Бруно. Но пока ты идёшь к двери, замечаешь, как он торопливо прячет под стойку чужой плащ с серебряной пряжкой.',
    must: [['ложь записана', (st) => st.events.some((e) => e.type === 'lie' || /солгал|лож|скрыва|врёт|врет/i.test(e.text))]],
    forbid: [],
    ideal: [['event', { type: 'lie', text: 'Бруно солгал Яну, что не видел постояльца, и прячет его плащ', participants: ['Бруно', 'Ян'], known_by: ['Бруно', 'Ян'] }]],
  },
  {
    id: 'new-npc', title: 'Новый значимый персонаж',
    setup: and(hero(STD), scene({ location: 'Таверна', present: [] })),
    action: 'Подсаживаюсь к незнакомцу',
    narration: 'Незнакомец откидывает капюшон: худой, седой, с ожогом на шее. «Корвин, — представляется он. — Мне нужен человек, который не задаёт вопросов. Плачу золотом».',
    must: [
      ['Корвин заведён', (st) => npc(st, 'корвин')],
      ['у него записано желание', (st) => (npc(st, 'корвин')?.wants || '').length > 3],
      ['он рядом', (st) => st.scene.present.some((p) => like(p, 'корвин'))],
    ],
    forbid: [['один Корвин', (st) => st.npcs.filter((n) => like(n.name, 'корвин')).length > 1]],
    ideal: [['npc', { name: 'Корвин', appearance: 'худой, седой, ожог на шее', description: 'наниматель', attitude: 'деловит', wants: 'нанять человека без вопросов' }], ['scene', { present: ['Корвин'] }]],
  },
  {
    id: 'empty-sheet', title: 'Пустой лист в начале игры',
    setup: (st) => { H(st).persona = 'Ян — бывший наёмник, мастер меча, немного разбирается в травах. При нём меч и старая кольчуга.'; H(st).blocks = []; },
    action: 'Начни игру',
    narration: 'Ты просыпаешься в придорожной канаве. Голова гудит, но меч по-прежнему у пояса, а кольчуга на плечах.',
    must: [
      ['заведено Здоровье', (st) => find(st, 'stat', 'здоров', 'жизн', 'hp')],
      ['заведено умение владения мечом', (st) => find(st, 'ability', 'меч', 'фехт', 'клин')],
      ['меч в инвентаре', (st) => find(st, 'item', 'меч')],
    ],
    forbid: [],
    ideal: [['block', { type: 'stat', name: 'Здоровье', value: '18', max: 20 }], ['block', { type: 'ability', name: 'Фехтование', value: 'мастер' }], ['block', { type: 'ability', name: 'Травничество', value: 'новичок' }], ['block', { type: 'item', name: 'Меч' }], ['block', { type: 'item', name: 'Старая кольчуга' }]],
  },
  {
    id: 'locked-block', title: 'Закреплённое не трогать',
    setup: hero([{ type: 'stat', name: 'Здоровье', value: '20', max: 20, locked: true }, { type: 'item', name: 'Фамильный перстень', locked: true }]),
    action: 'Падаю с лестницы',
    narration: 'Ступенька подламывается, и ты летишь вниз, больно ударяясь плечом. Перстень соскальзывает с пальца и звенит где-то в темноте.',
    must: [],
    forbid: [['закреплённое не изменилось', (st) => num(find(st, 'stat', 'здоров')) !== 20 || !find(st, 'item', 'перстень')]],
    ideal: [['block', { type: 'status', name: 'Ушиб плеча' }]],
  },
  {
    id: 'npc-dies', title: 'Смерть НПС',
    setup: and(hero(STD), npcs({ name: 'Старый Эрвин', status: 'ранен' }), scene({ present: ['Старый Эрвин'] })),
    action: 'Пытаюсь помочь',
    narration: 'Эрвин хватает тебя за руку, пытается что-то сказать — и затихает. Глаза его стекленеют. Старик мёртв.',
    must: [['Эрвин помечен мёртвым', (st) => /мёртв|мертв|умер|погиб|скончал/i.test(npc(st, 'эрвин')?.status || '') || npc(st, 'эрвин')?.archived || st.events.some((e) => e.type === 'death')]],
    forbid: [],
    ideal: [['npc', { name: 'Старый Эрвин', status: 'мёртв' }], ['event', { type: 'death', text: 'Старый Эрвин умер на руках у Яна', participants: ['Старый Эрвин', 'Ян'] }]],
  },
  {
    id: 'new-thread', title: 'Новая цель',
    setup: and(hero(STD), npcs({ name: 'Марта' }), scene({ present: ['Марта'] })),
    action: 'Соглашаюсь помочь',
    narration: '«Мою сестру увели к северным шахтам, — Марта сжимает кулаки. — Найди её. Больше некому». Ты киваешь.',
    must: [['нить про сестру', (st) => st.threads.some((t) => /сестр/i.test(t.title + ' ' + t.progress))]],
    forbid: [['одна нить', (st) => st.threads.length > 1]],
    ideal: [['thread', { action: 'open', title: 'Найти сестру Марты', progress: 'её увели к северным шахтам' }], ['event', { type: 'promise', text: 'Ян согласился найти сестру Марты', participants: ['Ян', 'Марта'] }]],
  },
  {
    id: 'bought', title: 'Покупка',
    setup: and(hero(STD), npcs({ name: 'Торговка Ульна' }), scene({ present: ['Торговка Ульна'] })),
    action: 'Покупаю факелы',
    narration: '«Три факела — три серебрушки, то есть одна золотая», — Ульна заворачивает их в тряпицу. Ты расплачиваешься.',
    must: [['факелы в инвентаре', (st) => find(st, 'item', 'факел')], ['денег стало меньше', (st) => /34/.test(find(st, 'item', 'кошел')?.value || '')]],
    forbid: [],
    ideal: [['block', { type: 'item', name: 'Факелы', value: '3' }], ['block', { type: 'item', name: 'Кошель', value: '34 золотых' }]],
  },
  {
    id: 'atmosphere', title: 'Только описание',
    setup: and(hero(STD), scene({ location: 'Лесная дорога' })),
    action: 'Иду дальше',
    narration: 'Лес темнеет, ветви смыкаются над дорогой. Где-то кричит сова, и под ногами хрустит прошлогодняя листва.',
    must: [],
    forbid: [
      ['лист не менялся', (st, c, before) => blocksOf(st) !== before.blocks],
      ['хроника не менялась', (st, c, before) => eventsAdded(st, before.events) > 0],
      ['НПС не заведены', (st) => st.npcs.length > 0],
    ],
    ideal: [['nothing', {}]],
  },
  {
    id: 'potion', title: 'Выпил зелье',
    setup: hero([{ type: 'stat', name: 'Здоровье', value: '6', max: 20 }, { type: 'item', name: 'Зелье лечения', value: '2' }]),
    action: 'Пью зелье',
    narration: 'Ты выпиваешь зелье одним глотком. Горечь обжигает горло, но тепло разливается по телу, и рана перестаёт кровоточить.',
    must: [['здоровье выросло', (st) => num(find(st, 'stat', 'здоров')) > 6], ['зелий стало меньше', (st) => { const z = find(st, 'item', 'зель'); return !z || num(z) === 1; }]],
    forbid: [],
    ideal: [['block', { type: 'stat', name: 'Здоровье', value: '11' }], ['block', { type: 'item', name: 'Зелье лечения', value: '1' }]],
  },
];

// Снимок «до хода» для сравнения в forbid.
export function snapshotBefore(st) {
  return { blocks: blocksOf(st), events: (st.events || []).length };
}

// Применить проверки сцены. calls — [{ name, args }] из журнала учёта.
export function judge(sc, st, calls, before) {
  const failed = []; const violated = [];
  for (const [what, ok] of sc.must) { let r = false; try { r = Boolean(ok(st, calls, before)); } catch { r = false; } if (!r) failed.push(what); }
  for (const [what, bad] of sc.forbid) { let r = false; try { r = Boolean(bad(st, calls, before)); } catch { r = true; } if (r) violated.push(what); }
  return { failed, violated, ok: !failed.length && !violated.length };
}
export { used };
