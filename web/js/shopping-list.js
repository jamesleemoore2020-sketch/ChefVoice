// Port of app/.../util/ShoppingList.kt. Keep the two in step.
//
// Merges only when it is certainly safe: same thing, comparable units, AND both quantities
// readable as numbers. "2 cups flour" + "200 g flour" stays two lines because turning volume
// into weight needs to know what the ingredient is. A list with a duplicate on it is a small
// annoyance; one with a silently wrong total sends the chef to buy the wrong amount.

import { formatQuantity, parseQuantity, scale } from './ingredient-scaling.js';

const unitAliases = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp', cups: 'cup',
  ounce: 'oz', ounces: 'oz', ozs: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb',
  gram: 'g', grams: 'g', gs: 'g', kilogram: 'kg', kilograms: 'kg',
  milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  cloves: 'clove', slices: 'slice', pinches: 'pinch', cans: 'can', tins: 'tin', packs: 'pack', packets: 'packet'
};

const normalizeUnit = raw => {
  const clean = String(raw ?? '').trim().toLowerCase().replace(/\.+$/, '');
  return unitAliases[clean] ?? clean;
};

/** Lowercased, punctuation-stripped, trailing plural "s" removed: "Onions" == "onion". */
const normalizeName = raw => {
  const clean = String(raw ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return clean.length > 3 && clean.endsWith('s') ? clean.slice(0, -1) : clean;
};

const mergeKey = item => `${normalizeName(item.name)} ${normalizeUnit(item.unit)}`;

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** List entries for one recipe, scaled for `servingFactor`. */
export function itemsFor(recipeId, recipeTitle, ingredients, servingFactor = 1) {
  return scale(ingredients, servingFactor)
    .filter(i => String(i.name ?? '').trim())
    .map(i => ({
      id: newId(), name: String(i.name).trim(), quantity: String(i.quantity ?? '').trim(), unit: String(i.unit ?? '').trim(),
      recipeId, recipeTitle, checked: false, addedAt: Date.now()
    }));
}

/**
 * Folds `incoming` into `existing`. A merged line keeps its checked state only if it was
 * already unchecked: more of something already ticked off means more to buy.
 */
export function merge(existing, incoming) {
  const result = [...existing];
  for (const item of incoming) {
    const index = result.findIndex(c => mergeKey(c) === mergeKey(item));
    if (index < 0) { result.push(item); continue; }
    const current = result[index];
    const a = parseQuantity(current.quantity);
    const b = parseQuantity(item.quantity);
    // "a pinch" plus "1 tsp" would mean inventing a number; the second line stands alone.
    if (a === null || b === null) { result.push(item); continue; }
    const sources = [...String(current.recipeTitle ?? '').split(', '), item.recipeTitle]
      .map(s => String(s ?? '').trim()).filter(Boolean);
    result[index] = { ...current, quantity: formatQuantity(a + b), recipeTitle: [...new Set(sources)].join(', '), checked: false };
  }
  return result;
}

export const displayText = item => [item.quantity, item.unit, item.name].filter(s => String(s ?? '').trim()).join(' ');

/** Plain text for sharing a list to Messages, Keep, a partner, anywhere. */
export function asShareText(items) {
  if (!items.length) return 'ChefVoice shopping list (empty)';
  const lines = [...items].sort((a, b) => Number(a.checked) - Number(b.checked))
    .map(i => `${i.checked ? '[x]' : '[ ]'} ${displayText(i)}`).join('\n');
  return `ChefVoice shopping list\n\n${lines}`;
}

/**
 * What adding one recipe did, in the words ChefAppState.addRecipeToShoppingList uses. A chef
 * needs to know when a line was folded into one already on the list, because the total they
 * are about to buy changed without a new line appearing.
 */
export function additionMessage(previousCount, incomingCount, mergedCount) {
  const added = mergedCount - previousCount;
  const combined = incomingCount - added;
  const plural = n => (n === 1 ? '' : 's');
  if (combined <= 0) return `Added ${added} item${plural(added)} to the shopping list.`;
  if (added <= 0) return `Combined ${combined} item${plural(combined)} into lines already on the list.`;
  return `Added ${added} and combined ${combined} into the shopping list.`;
}
