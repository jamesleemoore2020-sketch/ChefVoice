import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { singular, stepIngredientIndices, words } from '../js/step-ingredients.js';

// shared/step-ingredients.tsv is the contract both platforms keep: Android's StepIngredientsTest
// reads the same rows. A row that passes here and fails there is a port bug, not a new rule.

const rows = readFileSync(new URL('../../shared/step-ingredients.tsv', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter(line => line.trim() && !line.startsWith('#'))
  .map(line => {
    const [id, names, step, expected] = line.split('\t');
    return { id, names: names.split(' ;; '), step, expected: expected === '-' ? [] : expected.split(' ;; ') };
  });

test('the shared fixture is all there', () => {
  assert.ok(rows.length >= 40, `only ${rows.length} rows read`);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'fixture ids are unique');
  for (const row of rows) assert.ok(row.id && row.step && row.names.length, `malformed row ${row.id}`);
});

for (const row of rows) {
  test(`shared fixture: ${row.id}`, () => {
    const ingredients = row.names.map(name => ({ quantity: '1', unit: '', name }));
    const named = stepIngredientIndices(row.step, ingredients).map(i => row.names[i]);
    assert.deepEqual(named, row.expected);
  });
}

test('an empty step or an empty recipe names nothing', () => {
  assert.deepEqual(stepIngredientIndices('', [{ name: 'Garlic' }]), []);
  assert.deepEqual(stepIngredientIndices('Add the garlic', []), []);
  assert.deepEqual(stepIngredientIndices('Add the garlic', undefined), []);
  assert.deepEqual(stepIngredientIndices('Add the garlic', [{ name: '' }, { name: '  ' }, {}]), []);
});

test('indices point into the list as given, so a scaled copy of it lines up', () => {
  const ingredients = [{ name: 'Flour' }, { name: 'Sugar' }, { name: 'Butter' }];
  assert.deepEqual(stepIngredientIndices('Rub the butter into the flour', ingredients), [2, 0]);
});

test('singular forms only need to agree with each other', () => {
  for (const [a, b] of [['onions', 'onion'], ['tomatoes', 'tomato'], ['peaches', 'peach'], ['berries', 'berry'],
    ['leaves', 'leaf'], ['pies', 'pie'], ['eggs', 'egg'], ['radishes', 'radish']]) {
    assert.equal(singular(a), singular(b), `${a} / ${b}`);
  }
  // Words that end in s without being plural keep it.
  for (const word of ['asparagus', 'hummus', 'couscous', 'swiss', 'gas']) assert.equal(singular(word), word);
});

test('words drop accents, apostrophes and punctuation', () => {
  assert.deepEqual(words('Chef’s jalapeño, all-purpose!'), ['chef', 'jalapeno', 'all', 'purpose']);
});
