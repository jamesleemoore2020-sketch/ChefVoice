import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionsContaining, createCollection, deleteCollection, MAX_COLLECTION_NAME,
  recipesInCollection, renameCollection, setRecipeInCollection
} from '../js/collections.js';

// Port of the collection behaviour in ChefAppState. Collections are a chef's own filing of
// their own library, so the rules that matter are: never lose a recipe, never make two
// collections a chef cannot tell apart, never let a deleted recipe corrupt one.

const recipes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

const withRecipes = (name, ids) => {
  const { collections, id } = createCollection([], name);
  return { list: setRecipeInCollection(collections, id, ids[0], true), id };
};

test('a blank collection id shows the whole library', () => {
  assert.deepEqual(recipesInCollection(recipes, [], ''), recipes);
});
test('an unknown collection id shows the whole library rather than nothing', () => {
  assert.deepEqual(recipesInCollection(recipes, [], 'gone'), recipes);
});
test('a collection shows only its own recipes, in library order', () => {
  const { collections, id } = createCollection([], 'Weeknight');
  let list = setRecipeInCollection(collections, id, 'c', true);
  list = setRecipeInCollection(list, id, 'a', true);
  assert.deepEqual(recipesInCollection(recipes, list, id).map(r => r.id), ['a', 'c']);
});
test('a recipe id that no longer resolves is skipped, not an error', () => {
  const { collections, id } = createCollection([], 'Weeknight');
  const list = setRecipeInCollection(collections, id, 'deleted-recipe', true);
  assert.deepEqual(recipesInCollection(recipes, list, id), []);
});

test('creating trims the name and caps its length', () => {
  const { collections, id } = createCollection([], `  ${'x'.repeat(200)}  `);
  assert.equal(collections.find(c => c.id === id).name.length, MAX_COLLECTION_NAME);
});
test('a blank name creates nothing', () => {
  const { collections, id } = createCollection([], '   ');
  assert.equal(id, '');
  assert.equal(collections.length, 0);
});
test('an existing name reuses that collection instead of making a twin', () => {
  const first = createCollection([], 'Weeknight');
  const second = createCollection(first.collections, 'weeknight');
  assert.equal(second.collections.length, 1);
  assert.equal(second.id, first.id);
});

test('renaming leaves the recipes in place', () => {
  const { list, id } = withRecipes('Weeknight', ['a']);
  const renamed = renameCollection(list, id, 'School nights');
  assert.equal(renamed[0].name, 'School nights');
  assert.deepEqual(renamed[0].recipeIds, ['a']);
});
test('renaming to blank is ignored', () => {
  const { list, id } = withRecipes('Weeknight', ['a']);
  assert.equal(renameCollection(list, id, '  ')[0].name, 'Weeknight');
});

test('deleting a collection does not touch the recipes in it', () => {
  const { list, id } = withRecipes('Weeknight', ['a']);
  assert.deepEqual(deleteCollection(list, id), []);
  assert.deepEqual(recipes.map(r => r.id), ['a', 'b', 'c']);
});

test('adding and removing a recipe is reversible', () => {
  const { collections, id } = createCollection([], 'Weeknight');
  const added = setRecipeInCollection(collections, id, 'b', true);
  assert.deepEqual(added[0].recipeIds, ['b']);
  assert.deepEqual(setRecipeInCollection(added, id, 'b', false)[0].recipeIds, []);
});
test('setting a state the recipe is already in changes nothing', () => {
  const { list, id } = withRecipes('Weeknight', ['a']);
  assert.equal(setRecipeInCollection(list, id, 'a', true), list);
});
test('an unknown collection id is ignored rather than creating one', () => {
  assert.deepEqual(setRecipeInCollection([], 'gone', 'a', true), []);
});

test('collectionsContaining finds every collection a recipe is filed in', () => {
  let list = createCollection([], 'Weeknight').collections;
  list = createCollection(list, 'Sunday').collections;
  list = setRecipeInCollection(list, list[0].id, 'a', true);
  list = setRecipeInCollection(list, list[1].id, 'a', true);
  assert.deepEqual(collectionsContaining(list, 'a').map(c => c.name), ['Weeknight', 'Sunday']);
  assert.deepEqual(collectionsContaining(list, 'b'), []);
});
