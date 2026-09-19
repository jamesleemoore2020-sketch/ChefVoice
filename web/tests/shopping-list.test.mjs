import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, itemsFor, asShareText } from '../js/shopping-list.js';

// Port of ShoppingListTest.kt. A duplicate is a small annoyance; a silently wrong total sends
// the chef to buy the wrong amount, so the merge is deliberately narrow.

const item = (quantity, unit, name, from = 'Chili') => ({ id: `${name}${quantity}${unit}`, quantity, unit, name, recipeTitle: from, checked: false });

test('adds quantities for the same thing in the same unit', () => {
  const m = merge([item('2', 'cups', 'flour')], [item('1', 'cup', 'flour')]);
  assert.equal(m.length, 1);
  assert.equal(m[0].quantity, '3');
});
test('folds unit spellings onto one line', () => {
  const m = merge([item('2', 'tablespoons', 'olive oil')], [item('1', 'tbsp', 'olive oil')]);
  assert.equal(m.length, 1);
  assert.equal(m[0].quantity, '3');
});
test('matches singular and plural names', () => {
  const m = merge([item('2', '', 'onions')], [item('1', '', 'Onion')]);
  assert.equal(m.length, 1);
  assert.equal(m[0].quantity, '3');
});
test('never adds across incomparable units', () => {
  assert.equal(merge([item('2', 'cups', 'flour')], [item('200', 'g', 'flour')]).length, 2);
});
test('keeps different ingredients apart', () => {
  assert.equal(merge([item('2', 'cups', 'flour')], [item('2', 'cups', 'sugar')]).length, 2);
});
test('does not merge when either quantity cannot be read', () => {
  assert.equal(merge([item('a pinch', '', 'salt')], [item('1', 'tsp', 'salt')]).length, 2);
});
test('a merged line remembers every recipe it came from', () => {
  const m = merge([item('2', 'cups', 'flour', 'Chili')], [item('1', 'cup', 'flour', 'Cornbread')]);
  assert.equal(m[0].recipeTitle, 'Chili, Cornbread');
});
test('merging into a checked line brings it back onto the list', () => {
  const bought = { ...item('2', 'cups', 'flour'), checked: true };
  const m = merge([bought], [item('1', 'cup', 'flour')]);
  assert.equal(m.length, 1);
  assert.equal(m[0].checked, false);
});
test('building from a recipe carries the scaling', () => {
  const items = itemsFor('r1', 'Chili', [{ quantity: '2', unit: 'cups', name: 'beans' }], 2);
  assert.equal(items[0].quantity, '4');
  assert.equal(items[0].recipeId, 'r1');
  assert.equal(items[0].recipeTitle, 'Chili');
});
test('building from a recipe drops only nameless lines', () => {
  const items = itemsFor('r1', 'Chili', [
    { quantity: '2', unit: 'cups', name: 'beans' },
    { quantity: '1', unit: 'tsp', name: '  ' },
    { quantity: '', unit: '', name: 'black pepper' }
  ]);
  assert.equal(items.length, 2);
  assert.ok(items.some(i => i.name === 'black pepper'));
});
test('share text marks what is already bought', () => {
  const text = asShareText([item('2', 'cups', 'flour'), { ...item('1', 'tsp', 'salt'), checked: true }]);
  assert.ok(text.includes('[ ] 2 cups flour'));
  assert.ok(text.includes('[x] 1 tsp salt'));
});
test('share text of an empty list says so', () => assert.ok(asShareText([]).includes('empty')));
