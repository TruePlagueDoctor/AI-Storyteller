// Отношение персонажей не зависит от сложности: своя воля и интересы на любом уровне,
// а сложность — про мир (везение, цену ошибок, опасность), не про злость НПС.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeStorySystem } from '../src/narrator.js';
import { makeState } from './helpers.js';

const LEVELS = ['story', 'normal', 'hard', 'brutal'];

test('раздел «Люди этого мира» — на каждой сложности и без записанных НПС', () => {
  for (const difficulty of LEVELS) {
    const p = composeStorySystem(makeState({ difficulty }));
    assert.match(p, /ЛЮДИ ЭТОГО МИРА/, difficulty);
    assert.match(p, /своих интересах|свои дела/, difficulty);
    assert.match(p, /чего-то стоит|цену/, difficulty);
    assert.match(p, /без причины/, difficulty);
  }
});

test('сложность не диктует враждебность персонажей', () => {
  for (const difficulty of LEVELS) {
    const tail = composeStorySystem(makeState({ difficulty })).split('=== КАК ВЕСТИ ЭТОТ ХОД ===')[1];
    const rules = tail.split('ЛЮДИ ЭТОГО МИРА')[0];
    assert.ok(!/ВРАЖДЕБН|враждебн|NPC|НПС|щадить|любить/.test(rules), `${difficulty}: ${rules.slice(0, 400)}`);
  }
});
