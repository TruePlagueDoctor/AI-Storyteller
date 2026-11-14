// Бестиарий: общая статья о типовом монстре и подстатьи об особых вариантах (как группы в «Магии и явлениях»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, narratorIndex, selectCodex, renderCodex, lookupCodex, codexIndex, withInherited, KIND_FIELDS } from '../src/codex.js';
import { composeStorySystem } from '../src/narrator.js';
import { statusCatalogOf } from '../src/statuses.js';
import { makeState } from './helpers.js';

const book = () => [
  normalizeEntry({ id: 'g', title: 'Гуль', kind: 'creature', brief: 'Трупоед с кладбищ.', fields: { look: 'серая кожа, длинные когти', habits: 'роет могилы по ночам', habitat: 'кладбища', danger: 2, weaknesses: 'огонь, солнечный свет' } }),
  normalizeEntry({ id: 'g1', title: 'Гуль-матка', kind: 'creature', brief: 'Раздутая, созывает стаю криком.', fields: { group: 'Гуль', look: 'втрое крупнее, брюхо волочится по земле', danger: 4 } }),
  normalizeEntry({ id: 'g2', title: 'Гуль-плевун', kind: 'creature', brief: 'Плюётся едкой слизью.', fields: { group: 'гуль', weaknesses: 'огня не боится; боится холода' } }),
  normalizeEntry({ id: 'w', title: 'Волколак', kind: 'creature', brief: 'Оборотень.', fields: { danger: 3, habitat: 'леса' } }),
  normalizeEntry({ id: 'o', title: 'Тень болотная', kind: 'creature', brief: 'Особая тень.', fields: { group: 'Тень' } }), // общей статьи нет
];
const world = (over = {}) => makeState({ lorebook: book(), messages: [{ role: 'user', content: 'Иду' }, { role: 'assistant', content: 'Тихо.' }, { role: 'user', content: 'Жду' }], ...over });

test('у существа есть поле «особый вариант», стоит первым', () => {
  assert.equal(KIND_FIELDS.creature[0][0], 'group');
  assert.deepEqual(KIND_FIELDS.creature.map(([k]) => k).slice(1), ['look', 'habits', 'habitat', 'danger', 'weaknesses', 'rumors']);
});

test('оглавление: варианты не перечисляются, у типового — число особых видов и правило про редкость', () => {
  const idx = narratorIndex(world());
  assert.match(idx, /Бестиарий: Гуль \(☠☠, кладбища; 2 особых вида\), Волколак \(☠☠☠, леса\), Тень \(1 особый вид\)/);
  assert.ok(!/Гуль-матка|Гуль-плевун|Тень болотная/.test(idx));
  assert.match(idx, /обычно встречается типовой[\s\S]{0,160}редк/);
  // Без вариантов текст оглавления прежний.
  const plain = narratorIndex(world({ lorebook: book().filter((e) => !e.fields.group) }));
  assert.ok(!/особы/.test(plain));
  assert.match(plain, /Бестиарий: Гуль \(☠☠, кладбища\), Волколак/);
});

test('вариант наследует незаполненное от типового, своё — перекрывает', () => {
  const b = book();
  const m = withInherited(b, b[1]);
  assert.equal(m.fields.look, 'втрое крупнее, брюхо волочится по земле');
  assert.equal(m.fields.danger, 4);
  assert.equal(m.fields.habits, 'роет могилы по ночам');
  assert.equal(m.fields.weaknesses, 'огонь, солнечный свет');
  assert.equal(withInherited(b, b[2]).fields.danger, 2, 'опасность — от типового, если своя не задана');
  assert.equal(withInherited(b, b[0]), b[0], 'типовой и обычные статьи — как есть');
});

test('вариант в сцене: рассказчик получает его статью с унаследованным от типового', () => {
  const st = world();
  st.scene.creatures = ['Гуль-плевун'];
  const sel = selectCodex(st);
  assert.equal(sel.find((x) => x.entry.id === 'g2').level, 'full');
  const text = renderCodex(st).text;
  assert.match(text, /Гуль-плевун \[бестиарий\] — Плюётся едкой слизью\./);
  assert.match(text, /Особый вариант существа: Гуль/);
  assert.match(text, /Слабости: огня не боится; боится холода/);
  assert.match(text, /От обычного \(Гуль\):[\s\S]*Облик: серая кожа, длинные когти[\s\S]*Повадки: роет могилы по ночам/);
  assert.ok(!/От обычного[\s\S]*Слабости: огонь/.test(text), 'перекрытое поле от типового не дублируется');
});

test('типовой в сцене: названия особых видов рядом, без их описаний', () => {
  const st = world();
  st.scene.creatures = ['Гуль'];
  const text = renderCodex(st).text;
  assert.match(text, /Особые виды \(редкость; обычно встречается типовой\): Гуль-матка, Гуль-плевун/);
  assert.ok(!text.includes('Раздутая, созывает стаю'));
});

test('по запросу: типовой — со списком особых видов и их выжимками; вариант — целиком с унаследованным; группа без общей статьи находится', () => {
  const st = world();
  const parent = lookupCodex(st, ['Гуль']).text;
  assert.match(parent, /Особые виды \(2\)[\s\S]*Гуль-матка — Раздутая, созывает стаю криком\.[\s\S]*Гуль-плевун — Плюётся едкой слизью\./);
  assert.match(lookupCodex(st, ['Гуль-матка']).text, /Опасность: 4\/5[\s\S]*От обычного \(Гуль\):[\s\S]*Слабости: огонь, солнечный свет/);
  assert.match(lookupCodex(st, ['Тень']).text, /Особые виды \(1\)[\s\S]*Тень болотная/);
});

test('начало игры знакомит с типовыми, а не со всеми вариантами; учётчик видит точные названия вариантов', () => {
  const st = world({ messages: [{ role: 'user', content: 'Начни игру' }] });
  const text = renderCodex(st).text;
  assert.match(text, /• Гуль \[бестиарий\]/);
  assert.ok(!text.includes('• Гуль-матка'));
  assert.match(codexIndex(st), /Бестиарий: [^\n]*Гуль-матка[^\n]*Гуль-плевун/);
});

test('варианты существ — не состояния, и правило рассказчику появляется только при вариантах', () => {
  const st = world();
  assert.ok(!statusCatalogOf(st).some((d) => /Гуль/.test(d.name)));
  assert.match(composeStorySystem(st), /обычно встречается типовой/);
  assert.ok(!/обычно встречается типовой/.test(composeStorySystem(world({ lorebook: [book()[0], book()[3]] }))));
});
