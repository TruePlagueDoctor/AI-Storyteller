// Общие заготовки для тестов: минимальное состояние партии без диска и сети.
import { emptyScene } from '../src/scene.js';
import { normalizeStatusCatalog } from '../src/statuses.js';
import { DEFAULT_TRAITS } from '../src/traits.js';

export function makeState(over = {}) {
  const hero = { id: 'h1', name: 'Ян', persona: '', blocks: [], skillXp: {}, present: true, appearance: '', social: '' };
  return {
    characters: [hero],
    activeCharacterId: 'h1',
    npcs: [],
    lorebook: [],
    threads: [],
    events: [],
    scene: emptyScene(),
    statusCatalog: normalizeStatusCatalog(null),
    traitPool: DEFAULT_TRAITS.map((t) => ({ ...t })),
    seedPool: { quirks: [], secrets: [] },
    messages: [],
    log: [],
    turn: 1,
    model: 'test/model',
    toolModel: '',
    ...over,
  };
}

export const hero = (state) => state.characters[0];
export const block = (state, name) => hero(state).blocks.find((b) => b.name === name);
