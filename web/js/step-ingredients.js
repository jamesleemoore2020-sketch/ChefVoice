// Port of app/.../util/StepIngredients.kt. Keep the two in step: both are held to
// shared/step-ingredients.tsv, row for row.
//
// Which of a recipe's ingredients one method step names, so the cook-along can put the amount
// beside the step that uses it. A read-only view, like the step timers: it never edits a step
// or an ingredient, never contributes to what is saved, and it is not the parser.
//
// It is literal on purpose. A step names an ingredient when it says the whole name ("the
// olive oil") or the end of it ("the oil" for olive oil, "the onion" for diced onion), and an
// end counts only while it belongs to one ingredient: "heat the oil" in a recipe with olive oil
// and sesame oil shows neither, rather than a guess. Words that usually mean something the chef
// made rather than bought ("the sauce", "the mixture", "the pan juices"), or a verb ("cream the
// butter"), never count on their own. A missed ingredient costs the chef a glance at the full
// list, which the screen keeps one tap away; a wrong one, shown with its amount beside the step,
// is one they might add.

// Words a name can end in that describe it rather than name it: "parsley for garnish", "salt to
// taste". A name is matched by what is left once they are gone, as well as in full.
const TRAILING = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'to', 'for', 'with', 'as', 'if', 'plus', 'taste', 'needed',
  'optional', 'divided', 'extra', 'more', 'fresh', 'freshly', 'finely', 'roughly', 'thinly', 'large',
  'small', 'medium', 'whole', 'warm', 'cold', 'softened', 'melted', 'chopped', 'diced', 'minced',
  'sliced', 'grated', 'shredded', 'crushed', 'peeled', 'cubed', 'beaten', 'cooked', 'drained',
  'rinsed', 'toasted', 'halved', 'quartered', 'trimmed', 'sifted', 'pitted', 'seeded', 'cored',
  'crumbled', 'mashed', 'packed', 'room', 'temperature', 'serving', 'garnish'
]);

// The last word of a name that never counts alone. Each usually means something the chef made
// or a shape they cut, not the thing they bought.
const WEAK = new Set([
  'sauce', 'mixture', 'mix', 'batter', 'dressing', 'filling', 'glaze', 'marinade', 'seasoning',
  'cream', 'topping', 'liquid', 'juice', 'piece', 'slice', 'cube', 'strip', 'chunk', 'wedge',
  'round', 'bit'
]);

// The part of a thing a name ends in: "garlic cloves" is the garlic, "chicken breasts" the
// chicken, "lime wedges" the lime.
const FORMS = new Set([
  'clove', 'breast', 'thigh', 'drumstick', 'wing', 'fillet', 'filet', 'leaf', 'sprig', 'stalk',
  'rib', 'stick', 'floret', 'spear', 'strand', 'pod', 'head', 'bulb', 'piece', 'slice', 'cube',
  'strip', 'chunk', 'wedge', 'round'
]);

const IRREGULAR = { leaves: 'leaf', loaves: 'loaf', halves: 'half' };

/** "onions" -> "onion", "tomatoes" -> "tomato", "cherries" -> "cherry". Only ever compared with another word made singular the same way. */
export function singular(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 3) return word;
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:oes|ches|shes|xes|sses|zzes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercase words with accents, apostrophes and punctuation dropped, each made singular. */
export function words(text) {
  const plain = String(text ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/['’]/g, '');
  return (plain.match(/[\p{L}\p{N}]+/gu) ?? []).map(singular);
}

/** The phrases that name one ingredient, and the key two ingredients share when they are the same thing. */
function describe(name) {
  // What follows a comma or sits in brackets describes the ingredient -- "butter, softened",
  // "onion (diced)" -- and is not how a step refers to it.
  const core = String(name ?? '').replace(/\([^)]*\)/g, ' ').split(/[,(]/)[0];
  const full = words(core);
  let end = full.length;
  while (end > 0 && TRAILING.has(full[end - 1])) end--;
  const head = end > 0 ? full.slice(0, end) : full;
  if (!head.length) return null;
  const phrases = new Map();
  const add = (phrase, whole) => {
    const key = phrase.join(' ');
    const known = phrases.get(key);
    if (known) known.whole ||= whole;
    else phrases.set(key, { words: phrase, whole });
  };
  add(full, true);
  add(head, true);
  for (let start = 1; start < head.length; start++) {
    const tail = head.slice(start);
    if (tail.length === 1 && WEAK.has(tail[0])) continue;
    add(tail, false);
  }
  if (head.length > 1 && FORMS.has(head[head.length - 1])) {
    const body = head.slice(0, -1);
    if (!(body.length === 1 && (WEAK.has(body[0]) || TRAILING.has(body[0])))) add(body, false);
  }
  return { key: head.join(' '), phrases: [...phrases.values()] };
}

/**
 * Indices into `ingredients` of the ones `step` names, in the order the step names them, each
 * once. The longest phrase is read first, so "kosher salt" is the kosher salt and not also the
 * salt, and a whole name beats the end of another one.
 */
export function stepIngredientIndices(step, ingredients) {
  const tokens = words(step);
  if (!tokens.length) return [];
  const spans = new Map();
  (ingredients || []).forEach((ingredient, index) => {
    const named = describe(ingredient?.name);
    if (!named) return;
    for (const phrase of named.phrases) {
      const n = phrase.words.length;
      for (let start = 0; start + n <= tokens.length; start++) {
        if (!phrase.words.every((word, k) => tokens[start + k] === word)) continue;
        const id = `${start}:${n}`;
        if (!spans.has(id)) spans.set(id, { start, length: n, entries: [] });
        spans.get(id).entries.push({ index, whole: phrase.whole, key: named.key });
      }
    }
  });
  const claimed = new Array(tokens.length).fill(false);
  const found = [];
  for (const span of [...spans.values()].sort((a, b) => b.length - a.length || a.start - b.start)) {
    if (claimed.slice(span.start, span.start + span.length).some(Boolean)) continue;
    claimed.fill(true, span.start, span.start + span.length);
    const best = span.entries.some(e => e.whole) ? span.entries.filter(e => e.whole) : span.entries;
    // Two different ingredients that end the same way: the step does not say which.
    if (new Set(best.map(e => e.key)).size !== 1) continue;
    for (const e of best) found.push({ start: span.start, index: e.index });
  }
  found.sort((a, b) => a.start - b.start || a.index - b.index);
  const result = [];
  for (const { index } of found) if (!result.includes(index)) result.push(index);
  return result;
}
