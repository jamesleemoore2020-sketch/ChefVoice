import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { byNameFirst, matchesAll, nameMatches, queryKey, queryWords, searchWords } from '../js/chef-search.js';

// Chef search (audit F10). shared/chef-search-words.tsv is how the backend and both apps read text
// into words; the backend's own token builder is used below so the PWA is tested against exactly
// what it will be searching.

const require = createRequire(import.meta.url);
const { chefSearchTokens } = require('../../notifications/functions/search-tokens.js');

const rows = readFileSync(new URL('../../shared/chef-search-words.tsv', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const [id, text, words] = line.split('\t');
    return { id, text, words: words === '-' ? [] : words.split(' ;; ') };
  });

test('the shared word rows are all there', () => assert.ok(rows.length >= 17, `only ${rows.length} rows`));

for (const row of rows) {
  test(`shared words: ${row.id}`, () => assert.deepEqual(searchWords(row.text), row.words));
}

/** Whether a typed search finds a profile, the way firebase-client.js decides it. */
const finds = (profile, typed) => {
  const words = queryWords(typed);
  return words.length > 0 && matchesAll(chefSearchTokens(profile), words);
};

test('a search finds a chef by the start of any word of their name, in any case or spacing', () => {
  const chef = { displayName: 'DaPlug', favoriteThings: ['Birria tacos'] };
  for (const typed of ['DaPlug', 'daplug', 'Da Plug', 'plug', 'pl', 'DAP', 'birria', 'tacos plug']) assert.ok(finds(chef, typed), typed);
  for (const typed of ['lug', 'plugs', 'x', '', 'da plugz']) assert.ok(!finds(chef, typed), `${typed} should not find DaPlug`);
});

test('the key asked of Firestore is the longest word, and every word has to match', () => {
  assert.deepEqual(queryWords('Mary  BERRY mary'), ['mary', 'berry']);
  assert.equal(queryKey(queryWords('Mary Berry')), 'berry');
  assert.equal(queryKey(queryWords('ab cd')), 'ab');
  assert.equal(queryKey([]), '');
  assert.equal(queryWords('a b').length, 0, 'single letters are never searched for');
  assert.deepEqual(queryWords('Extraordinarilylongchefnamethatgoeson'), ['extraordinarilylongc']);
  assert.equal(matchesAll(['ma', 'mar', 'mary'], ['mary', 'berry']), false);
  assert.equal(matchesAll(undefined, ['mary']), false);
});

test('chefs found by their name come before chefs found by their favourite things', () => {
  const byName = { displayName: 'Mango Mike', favoriteThings: [] };
  const byFavorite = { displayName: 'Ana', favoriteThings: ['Mango sticky rice'] };
  const words = queryWords('mango');
  assert.equal(nameMatches(byName.displayName, words), true);
  assert.equal(nameMatches(byFavorite.displayName, words), false);
  assert.deepEqual(byNameFirst([byFavorite, byName], words), [byName, byFavorite]);
  // Otherwise the order Firestore returned is kept.
  const second = { displayName: 'Mangosteen Mo', favoriteThings: [] };
  assert.deepEqual(byNameFirst([byFavorite, byName, second], words), [byName, second, byFavorite]);
});
