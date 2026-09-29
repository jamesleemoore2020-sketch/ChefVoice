"use strict";

// Chef search that can find any chef (audit F10).
//
// Search used to page through `users` in document-id order, 300 at most, and match text on the
// device, so a chef outside the first 300 ids could never be found, and every search cost up to
// 300 reads. Now each profile carries `searchTokens`: every beginning (2 to 20 characters) of every
// word of the chef's name, of the whole name run together, and of the words of their favourite
// things. Search is one `array-contains` query for the typed word.
//
// The tokens are written here, by the backend (syncChefSearchTokens, and
// backfillChefVoiceSearchTokens for profiles saved before it), never by an app: firestore.rules
// keeps clients from writing them, so a chef cannot stuff their profile with other people's names
// to turn up in their searches.
//
// `searchWords` is how text becomes words, on the backend and in both apps; all three are held to
// shared/chef-search-words.tsv.

const MIN_TOKEN = 2;
const MAX_TOKEN = 20;
const MAX_TOKENS = 300;
const MAX_FAVORITES = 12;

/**
 * Lowercase words, accents and apostrophes dropped, split where a lower-case letter or a digit is
 * followed by a capital ("DaPlug" is "da plug", "J4Mr" is "j4 mr").
 */
function searchWords(text) {
  return String(text ?? "")
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A word's beginnings a search can match: "plug" is "pl", "plu", "plug". */
function beginnings(word) {
  const out = [];
  for (let n = MIN_TOKEN; n <= Math.min(word.length, MAX_TOKEN); n++) out.push(word.slice(0, n));
  return out;
}

/** The tokens a profile is found by. Name first, so the cap only ever drops favourite things. */
function chefSearchTokens(profile) {
  const tokens = new Set();
  const add = (words) => {
    for (const word of words) for (const token of beginnings(word)) {
      if (tokens.size >= MAX_TOKENS) return;
      tokens.add(token);
    }
  };
  const name = searchWords(profile?.displayName);
  add(name);
  // "daplug" finds "Da Plug" as well as "DaPlug".
  if (name.length > 1) add([name.join("")]);
  const favorites = Array.isArray(profile?.favoriteThings) ? profile.favoriteThings.slice(0, MAX_FAVORITES) : [];
  for (const favorite of favorites) add(searchWords(favorite));
  return [...tokens];
}

/** Whether a stored token list already says what a profile should, so nothing is rewritten. */
function sameTokens(stored, wanted) {
  return Array.isArray(stored) && stored.length === wanted.length && stored.every((token, i) => token === wanted[i]);
}

module.exports = { searchWords, beginnings, chefSearchTokens, sameTokens, MIN_TOKEN, MAX_TOKEN, MAX_TOKENS };
