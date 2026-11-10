// Ход целиком: рассказ → учёт → сверка текста с состоянием.

import { findContradictions, findSceneIssues, findQuestionIssues, findClicheIssues, autoFix, correctionNote } from './contradictions.js';
import { toolModelOf } from './llm.js';
import { narrate, lastPlayerAction } from './narrator.js';
import { syncState, syncWorthwhile } from './sync.js';
import { sameName } from './tools.js';
import { codexMisses } from './codex.js';
import { npcVoices } from './voices.js';

// После хода: кто был рядом с героем — тот его видел. Последняя встреча нужна рассказчику,
// чтобы давно не видевшие героя НПС не знали того, что с ним случилось потом.
export function markSeen(state) {
  const sc = state.scene || {};
  const near = (sc.present || []).map((p) => String(p).trim()).filter(Boolean);
  const first = (s) => s.toLowerCase().split(/\s+/)[0];
  const isNear = (name) => near.some((p) => p.toLowerCase() === name.toLowerCase() || sameName(p, name) || first(p) === first(name));
  const seen = (state.npcs || []).filter((n) => !n.archived && (n.bound || isNear(n.name)));
  // since — с какого хода он рядом без перерыва: по этому «играющий сам» персонаж знает, что слышал.
  const turn = state.turn || 0;
  for (const n of seen) {
    const prev = n.lastSeen;
    const since = prev && prev.turn >= turn - 1 ? (Number.isFinite(prev.since) ? prev.since : prev.turn) : turn;
    n.lastSeen = { turn, day: sc.day || 1, since };
  }
  const hero = state.characters.find((c) => c.id === state.activeCharacterId);
  for (const e of (hero && hero.appearanceLog) || []) {
    for (const n of seen) if (!e.seenBy.some((x) => x.toLowerCase() === n.name.toLowerCase() || sameName(x, n.name))) e.seenBy.push(n.name);
  }
}

// Сверка текста с состоянием после учёта: числовые огрехи чиним сразу,
// смысловые передаём рассказчику замечанием на следующий ход.
export function afterSync(state, narration, rolls = [], { codexSeen = null } = {}) {
  const issues = findContradictions(state, narration);
  const fixed = autoFix(issues);
  const scene = findSceneIssues(state, narration, lastPlayerAction(state), rolls);
  const prevReplies = (state.messages || []).filter((m) => m.role === 'assistant' && !m.ooc && typeof m.content === 'string').map((m) => m.content);
  if (prevReplies.length && prevReplies[prevReplies.length - 1] === narration) prevReplies.pop(); // текущий ответ уже в истории
  const questions = [...findQuestionIssues(state, narration), ...findClicheIssues(narration, prevReplies)];
  const missed = codexMisses(state, narration, codexSeen);
  const codex = missed.length ? [{ kind: 'codex', text: `Ты вывел ${missed.map((t) => `«${t}»`).join(', ')}, не зная статьи кодекса. ` +
    'Сверь с ней облик и повадки (codex_lookup) и дальше заглядывай в статью до того, как выводить существо в сцену.' }] : [];
  state.correctionNote = correctionNote([...issues, ...scene, ...questions, ...codex]) || undefined;
  markSeen(state);
  return { issues: issues.map((i) => i.text), fixed };
}

export async function runTurn({ state, apiKey, skipSync = false, beforeSync = null }) {
  const narrTimer = [];
  if (skipSync) {
    // OOC/служебный ход: чистое повествование, без инструментов и без прохода учёта.
    const { narration, truncated } = await narrate(state, apiKey, false, { allowDice: false, timer: narrTimer });
    return { narration: narration || '(Рассказчик молчит. Попробуй описать своё действие иначе.)', rolls: [], truncated, timing: { narrate: narrTimer } };
  }
  const journal = [];
  const syncTimer = [];
  const sync = state.stateSync !== false; // по умолчанию включён
  // Персонажи, которые «играют сами», решают до рассказа; рассказчик получает их решение на этот ход.
  const voiceTimer = [];
  const voices = await npcVoices(state, apiKey, voiceTimer);
  let told;
  state._voices = voices.length ? voices : undefined;
  try { told = await narrate(state, apiKey, !sync, { journal, timer: narrTimer }); }
  finally { delete state._voices; }
  const { narration, rolls, truncated, codexSeen, lookups } = told;
  let syncInfo;
  // Снимок мира «после текста, до учёта» — для кнопки «переучесть».
  if (sync && beforeSync) { try { beforeSync(); } catch { /* не критично */ } }
  if (!sync) {
    syncInfo = { status: 'inline', calls: journal }; // однопроходный режим: инструменты вызывал сам рассказчик
  } else if (!syncWorthwhile(state, narration)) {
    syncInfo = { status: 'skipped', calls: [] };
  } else {
    try {
      await syncState(state, apiKey, narration, journal, { timer: syncTimer });
      syncInfo = { status: 'done', calls: journal, model: toolModelOf(state), timing: syncTimer };
    } catch (e) {
      // Сбой учёта не должен рушить ход — история важнее. Но он виден в журнале.
      syncInfo = { status: 'failed', error: String(e.message || e).slice(0, 200), calls: journal, model: toolModelOf(state), timing: syncTimer };
    }
  }
  const { issues, fixed } = afterSync(state, narration, rolls, { codexSeen });

  return {
    narration: narration || '(Рассказчик молчит. Попробуй описать своё действие иначе.)',
    rolls,
    truncated,
    issues,
    fixed,
    sync: syncInfo,
    lookups: lookups && lookups.length ? lookups : undefined,
    voices: voices.length ? voices : undefined,
    timing: { narrate: narrTimer, voices: voiceTimer.length ? voiceTimer : undefined },
  };
}
