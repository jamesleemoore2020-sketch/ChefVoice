// Port of the collections half of app/.../ui/ChefAppState.kt. Keep the two in step.
//
// A chef's own filing of their own library -- "Weeknight", "Thanksgiving". Deliberately
// local to this browser: cloud bookmarks already cover saving other chefs' dishes, so this
// needs no Firestore collection, no security rule and therefore no rules deploy, and it
// keeps working for a chef who is signed out.
//
// Every function returns a new list rather than mutating one, so the caller persists the
// result in a single place instead of each edit remembering to save itself.

export const MAX_COLLECTION_NAME = 60;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const cleanName = raw => String(raw ?? '').trim().slice(0, MAX_COLLECTION_NAME);

/** Recipes in `collectionId`, in library order. A blank or unknown id means the whole library. */
export function recipesInCollection(recipes, collections, collectionId) {
  if (!collectionId) return recipes;
  const collection = collections.find(c => c.id === collectionId);
  if (!collection) return recipes;
  // Ids that no longer resolve are skipped rather than pruned, so deleting a recipe can
  // never corrupt a collection that mentioned it.
  const ids = new Set(collection.recipeIds || []);
  return recipes.filter(r => ids.has(r.id));
}

export const collectionsContaining = (collections, recipeId) =>
  collections.filter(c => (c.recipeIds || []).includes(recipeId));

/**
 * Adds a collection. Returns `{collections, id}`; `id` is '' when the name was blank.
 * A name that already exists returns that collection instead of making a second one with
 * the same label, which would be indistinguishable in the picker.
 */
export function createCollection(collections, name) {
  const label = cleanName(name);
  if (!label) return { collections, id: '' };
  const existing = collections.find(c => String(c.name ?? '').toLowerCase() === label.toLowerCase());
  if (existing) return { collections, id: existing.id };
  const now = Date.now();
  const collection = { id: newId(), name: label, recipeIds: [], createdAt: now, updatedAt: now };
  return { collections: [...collections, collection], id: collection.id };
}

export function renameCollection(collections, collectionId, name) {
  const label = cleanName(name);
  if (!label) return collections;
  const index = collections.findIndex(c => c.id === collectionId);
  if (index < 0) return collections;
  const next = [...collections];
  next[index] = { ...next[index], name: label, updatedAt: Date.now() };
  return next;
}

/** Removes the collection only. The recipes in it are untouched. */
export function deleteCollection(collections, collectionId) {
  if (!collections.some(c => c.id === collectionId)) return collections;
  return collections.filter(c => c.id !== collectionId);
}

export function setRecipeInCollection(collections, collectionId, recipeId, inCollection) {
  const index = collections.findIndex(c => c.id === collectionId);
  if (index < 0 || !recipeId) return collections;
  const current = collections[index];
  const ids = current.recipeIds || [];
  if (ids.includes(recipeId) === inCollection) return collections;
  const next = [...collections];
  next[index] = {
    ...current,
    recipeIds: inCollection ? [...ids, recipeId] : ids.filter(id => id !== recipeId),
    updatedAt: Date.now()
  };
  return next;
}
