// Проверка интерфейса в настоящем браузере: сервер с поддельной моделью,
// Playwright проходит основные действия и ловит ошибки в консоли.
// Запуск: npm run test:ui   (нужен Playwright: npm i -D playwright && npx playwright install chromium)
// Скриншоты — в папку, указанную в UI_SHOTS (по умолчанию не сохраняются).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startStack } from '../test/harness.js';
import { reply, call } from '../test/fake-llm.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.log('Playwright не установлен — проверка интерфейса пропущена.\nУстановить: npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const shots = process.env.UI_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const errors = [];
const step = (name) => console.log('  •', name);

const stack = await startStack();
stack.handlers.sync = () => reply('', [
  call('block', { type: 'stat', name: 'Здоровье', value: '8', max: 10 }),
  call('block', { type: 'item', name: 'Фляга' }),
  call('npc', { name: 'Ольт', attitude: 'насторожен', description: 'Стражник у ворот', wants: 'спокойной смены', voice_sample: 'Чего надо?', competence: 'профессионал', skills: ['стража'] }),
  call('scene', { location: 'Городские ворота', present: ['Ольт'], elapsed_minutes: 5 }),
  call('event', { type: 'debt', text: 'Ян должен Ольту пять монет', participants: ['Ян', 'Ольт'] }),
  call('block', { type: 'ability', name: 'Фехтование', value: 'опытный' }),
  call('block', { type: 'status', name: 'Отравлен' }),
  call('thread', { action: 'open', title: 'Попасть в город' }),
]);
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1400, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    console.log(`Экран ${viewport.name}:`);
    if (viewport.name === 'mobile') await stack.api('POST', '/api/reset');
    const page = await browser.newPage({ viewport });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${viewport.name}] console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${viewport.name}] ${e.message}`));
    await page.goto(stack.base + '/');
    await page.waitForSelector('#startBtn', { state: 'visible' });
    const version = await page.evaluate(() => document.title);
    step(`страница открылась (${version})`);

    await page.click('#startBtn');
    await page.waitForSelector('.entry.narrator');
    step('вступление пришло');

    stack.handlers.narrator = () => reply('Ольт смотрит на бумаги и кивает: «Проходи».');
    await page.fill('#input', 'Показываю бумаги');
    await page.press('#input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.entry.narrator').length === 2);
    step('ход игрока отыгран');

    stack.handlers.narrator = () => reply('Ольт хмурится: «Подделка», — и рвёт бумаги.');
    await page.click('.regen-btn:not(.swipe)');
    await page.waitForSelector('.swipe-count');
    step('регенерация дала второй вариант');
    await page.click('.regen-btn.swipe >> nth=0');
    await page.waitForFunction(() => /Проходи/.test(document.querySelector('.entry.narrator:last-of-type')?.textContent || document.body.textContent));
    step('свайп вернул прежний вариант');

    // Alt+← — к прежнему варианту и Alt+→ обратно.
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForFunction(() => /Подделка/.test(document.body.textContent));
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => /Проходи/.test(document.body.textContent));
    step('варианты листаются клавишами');

    // Черновик переживает перезагрузку.
    await page.fill('#input', 'Черновик моего хода');
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForSelector('.entry.narrator');
    if (await page.inputValue('#input') !== 'Черновик моего хода') errors.push(`[${viewport.name}] черновик не сохранился`);
    await page.fill('#input', '');
    step('черновик пережил перезагрузку');
    await page.focus('#input');
    await page.keyboard.press('ArrowUp');
    await page.waitForSelector('.entry.editing');
    await page.click('.entry.editing .btn.ghost');
    step('↑ открывает правку своей реплики');

    // Поиск: Ctrl+K, находит, Enter прыгает к реплике, Esc закрывает окно.
    await page.keyboard.press('Control+k');
    await page.waitForSelector('#searchModal:not([hidden])');
    await page.fill('#searchInput', 'бумаги');
    await page.waitForSelector('.search-hit');
    await page.press('#searchInput', 'Enter');
    await page.waitForSelector('.entry.found');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    if (!(await page.isHidden('#searchModal'))) errors.push(`[${viewport.name}] Esc не закрыл поиск`);
    step('поиск находит и переходит к реплике');

    if (viewport.name === 'mobile') { await page.click('#sheetToggle'); await page.waitForTimeout(300); }
    for (const tab of ['tabNpcs', 'tabLore', 'tabThreads', 'tabEvents', 'tabHeroes']) await page.click('#' + tab);
    // Кодекс: новая статья-существо, поля раздела, ✨ выжимка, фильтр по разделу.
    await page.click('#tabLore');
    await page.click('#loreAddBtn');
    await page.fill('#loreTitle', 'Упыри');
    await page.selectOption('#loreKind', 'creature');
    await page.waitForSelector('#loreKindFields [data-field="weaknesses"]');
    if (await page.isVisible('#loreRelationsField')) errors.push(`[${viewport.name}] у существа видно поле отношений народов`);
    await page.fill('#loreKindFields [data-field="weaknesses"]', 'огонь');
    await page.selectOption('#loreKindFields [data-field="danger"]', '3');
    await page.fill('#loreContent', 'Ночные трупоеды.');
    stack.handlers.other = () => reply('Ночные трупоеды, боятся огня.');
    await page.click('#loreBriefFill');
    await page.waitForFunction(() => document.querySelector('#loreBrief').value.length > 0);
    await page.click('#loreSave');
    await page.waitForSelector('#loreList .lore.kind-creature .lore-danger');
    await page.click('#codexFilter .codex-chip >> text=Бестиарий');
    step('кодекс: статья, поля раздела, ✨ выжимка');
    await page.click('#loreList .lore.kind-creature');
    await page.waitForSelector('#codexViewModal:not([hidden])');
    if (!/огонь/.test(await page.textContent('#codexViewBody'))) errors.push(`[${viewport.name}] в статье кодекса нет полей`);
    stack.handlers.other = () => reply('ghoul, undead, graveyard, night, full body');
    await page.click('#codexViewBody .codex-art-tools .codex-tool >> nth=0');
    await page.waitForSelector('#codexViewBody .codex-frame.has-image');
    step('иллюстрация статьи рисуется');
    await page.click('#codexViewEdit');
    await page.waitForSelector('#loreModal:not([hidden])');
    if (await page.inputValue('#loreKindFields [data-field="weaknesses"]') !== 'огонь') errors.push(`[${viewport.name}] поле статьи не сохранилось`);
    await page.click('#loreCancel');
    step('вкладки панели переключаются');
    await page.click('#tabNpcs');
    await page.click('#npcList .npc >> nth=0');
    await page.click('#npcList [data-act="view"]');
    await page.waitForSelector('#npcViewModal:not([hidden])');
    const npcSecs = await page.$$eval('#npcViewBody .dossier-section > h3', (h) => h.map((x) => x.textContent));
    if (!npcSecs.includes('Кто это')) errors.push(`[${viewport.name}] в досье НПС нет «Кто это»: ${npcSecs.join(', ')}`);
    await page.click('#npcViewEdit');
    await page.waitForSelector('#npcModal:not([hidden])');
    await page.keyboard.press('Escape');
    step('досье НПС для чтения и переход к правке');
    if (!/профессионал · стража/.test(await page.textContent('#npcList .npc-competence').catch(() => ''))) errors.push(`[${viewport.name}] в карточке НПС нет умелости`);
    if (shots) await page.screenshot({ path: join(shots, `${viewport.name}-npcs.png`), fullPage: false });
    await page.click('#tabHeroes');
    await page.click('#dossierBtn');
    await page.waitForSelector('#dossierModal:not([hidden])');
    const sections = await page.$$eval('#dossierBody .dossier-section > h3', (h) => h.map((x) => x.textContent));
    for (const want of ['Внешность', 'Состояние', 'Умения', 'Снаряжение']) {
      if (!sections.includes(want)) errors.push(`[${viewport.name}] в досье нет раздела «${want}»: ${sections.join(', ')}`);
    }
    await page.click('#dossierClose');
    step('досье героя открывается');
    await page.click('#charEditBtn');
    await page.waitForSelector('#charModal:not([hidden])');
    await page.click('#charModal .lock-btn[data-lock="race"]');
    await page.click('#charSave');
    await page.waitForSelector('#charModal', { state: 'hidden' });
    const heroLocks = await page.evaluate(() => fetch('/api/state').then((r) => r.json()).then((d) => d.characters[0].locked));
    if (!heroLocks.includes('race')) errors.push(`[${viewport.name}] замок расы героя не сохранился: ${JSON.stringify(heroLocks)}`);
    await page.click('#charEditBtn');
    await page.waitForSelector('#charModal:not([hidden])');
    if ((await page.textContent('#charModal .lock-btn[data-lock="race"]')) !== '🔒') errors.push(`[${viewport.name}] замок расы не показан закрытым`);
    await page.click('#charModal .lock-btn[data-lock="race"]');
    await page.click('#charSave');
    await page.waitForSelector('#charModal', { state: 'hidden' });
    step('замки полей героя сохраняются');
    if (viewport.name === 'mobile') await page.click('#sheetClose').catch(() => {});

    await page.click('#diagBtn');
    await page.waitForSelector('#diagModal:not([hidden])');
    await page.click('#diagPrompt');
    await page.waitForSelector('.pb-row');
    step('состав промта показывается');
    await page.click('#diagClose');

    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsModal:not([hidden])');
    if (await page.textContent('.settings-nav button.active') !== 'Модели') errors.push(`[${viewport.name}] при открытии настроек подсвечен не первый раздел`);
    await page.click('.settings-nav button[data-target="set-images"]');
    await page.waitForFunction(() => document.querySelector('.settings-nav button.active')?.dataset.target === 'set-images');
    step('разделы настроек переключаются');
    await page.click('#settingsCancel');
    await page.click('#slotsBtn');
    await page.waitForSelector('#slotsModal:not([hidden])');
    await page.click('#backupsBox > summary');
    await page.waitForSelector('#backupList .backup');
    step('резервные копии видны');
    await page.click('#slotsClose');
    step('настройки и список историй открываются');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push(`[${viewport.name}] горизонтальная прокрутка: лишние ${overflow}px`);
    if (shots) await page.screenshot({ path: join(shots, `${viewport.name}.png`), fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
  stack.stop();
}
if (errors.length) {
  console.error('\nОШИБКИ:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nИнтерфейс в порядке.');
