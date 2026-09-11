import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTag, parseTagsInput, tagMatchesQuery } from '../js/tag-utils.js';

test('known spelling variants collapse to one canonical tag', () => {
  assert.equal(canonicalTag('BBQ'), 'bbq');
  assert.equal(canonicalTag('#BBQ'), 'bbq');
  assert.equal(canonicalTag('Barbecue'), 'bbq');
  assert.equal(canonicalTag('barbeque'), 'bbq');
  assert.equal(canonicalTag('Bar-B-Q'), 'bbq');
});

test('distinct concepts are not merged', () => {
  assert.equal(canonicalTag('vegan'), 'vegan');
  assert.equal(canonicalTag('vegetarian'), 'vegetarian');
});

test('parseTagsInput splits, dedupes and canonicalizes', () => {
  assert.deepEqual(parseTagsInput('#BBQ, camping   Camping bbq'), ['bbq', 'camping']);
});

test('parseTagsInput caps at maxTags', () => {
  const raw = Array.from({ length: 12 }, (_, i) => `tag${i}`).join(' ');
  assert.equal(parseTagsInput(raw).length, 8);
});

test('tagMatchesQuery handles aliases and partial input', () => {
  assert.equal(tagMatchesQuery('bbq', 'barbecue'), true);
  assert.equal(tagMatchesQuery('bbq', '#bbq'), true);
  assert.equal(tagMatchesQuery('bbq', 'bb'), true);
  assert.equal(tagMatchesQuery('bbq', 'camping'), false);
});
