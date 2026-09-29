// Chef search, read the way the backend writes it (audit F10). Port of searchWords in
// notifications/functions/search-tokens.js; app/.../util/ChefSearch.kt is the Android port. All
// three are held to shared/chef-search-words.tsv.
//
// Each profile carries `searchTokens`, written only by the backend: every beginning (2 to 20
// characters) of every word of the chef's name, of the whole name run together, and of their
// favourite things. A search asks Firestore for its longest word and checks the rest here, so any
// chef can be found, and a search costs what it returns rather than up to 300 reads.

const MIN_TOKEN = 2;
const MAX_TOKEN = 20;

/**
 * Lowercase words, accents and apostrophes dropped, split where a lower-case letter or a digit is
 * followed by a capital ("DaPlug" is "da plug", "J4Mr" is "j4 mr").
 */
export function searchWords(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The words of a search, cut to the token length; single letters are never tokens. */
export function queryWords(text) {
  return [...new Set(searchWords(text).map(w => w.slice(0, MAX_TOKEN)).filter(w => w.length >= MIN_TOKEN))];
}

/** The word asked of Firestore: the longest, which matches the fewest chefs. */
export const queryKey = words => words.reduce((best, word) => (word.length > best.length ? word : best), '');

/** Whether a profile's tokens hold every word of the search. */
export const matchesAll = (tokens, words) => Array.isArray(tokens) && words.every(word => tokens.includes(word));

/** Whether the chef's own name, not only their favourite things, matches every word. */
export function nameMatches(displayName, words) {
  const name = searchWords(displayName);
  const whole = name.join('');
  return words.every(word => whole.startsWith(word) || name.some(part => part.startsWith(word)));
}

/** Chefs whose name matches first, then those found by their favourite things; otherwise as found. */
export function byNameFirst(profiles, words, nameOf = profile => profile.displayName) {
  return profiles
    .map((profile, index) => ({ profile, index, rank: nameMatches(nameOf(profile), words) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.profile);
}
