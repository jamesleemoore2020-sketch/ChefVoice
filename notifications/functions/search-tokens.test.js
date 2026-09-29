"use strict";

// Chef search tokens (audit F10). shared/chef-search-words.tsv holds how text becomes words; the
// PWA and Android read typed searches with the same rows.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { searchWords, beginnings, chefSearchTokens, sameTokens, MAX_TOKENS } = require("./search-tokens");

const rows = fs.readFileSync(path.join(__dirname, "../../shared/chef-search-words.tsv"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [id, text, words] = line.split("\t");
    return { id, text, words: words === "-" ? [] : words.split(" ;; ") };
  });

test("the shared word rows are all there", () => {
  assert.ok(rows.length >= 16, `only ${rows.length} rows`);
});

for (const row of rows) {
  test(`shared words: ${row.id}`, () => assert.deepEqual(searchWords(row.text), row.words));
}

/** Whether a search for `typed` would find a profile with these tokens, as both apps check it. */
const finds = (tokens, typed) => searchWords(typed).map((w) => w.slice(0, 20)).filter((w) => w.length >= 2)
  .every((word) => tokens.includes(word));

test("a chef is found by the start of any word of their name, or the whole name run together", () => {
  const tokens = chefSearchTokens({ displayName: "DaPlug", favoriteThings: [] });
  for (const typed of ["da", "dap", "daplug", "pl", "plug", "Da Plug", "DAPLUG"]) assert.ok(finds(tokens, typed), typed);
  for (const typed of ["lug", "ug", "plugs", "daplugs"]) assert.ok(!finds(tokens, typed), `${typed} should not match`);
  const chef = chefSearchTokens({ displayName: "ChefJ4Mr.Voice" });
  for (const typed of ["chef", "j4", "mr voice", "voice", "chefj4mrvoice"]) assert.ok(finds(chef, typed), typed);
});

test("favourite things are searchable too, after the name", () => {
  const tokens = chefSearchTokens({ displayName: "Ana", favoriteThings: ["Sourdough", "Thai curry"] });
  assert.ok(finds(tokens, "sourdough"));
  assert.ok(finds(tokens, "thai cur"));
  assert.deepEqual(tokens.slice(0, 2), ["an", "ana"]);
});

test("single letters are never tokens, and nothing is longer than 20 characters", () => {
  const tokens = chefSearchTokens({ displayName: "A Extraordinarilylongchefnamethatgoeson", favoriteThings: ["x"] });
  assert.ok(tokens.every((t) => t.length >= 2 && t.length <= 20));
  assert.ok(tokens.includes("extraordinarilylongc"));
  assert.ok(!tokens.includes("a"));
});

test("the list is capped, and the cap drops favourite things before any of the name", () => {
  // Twelve favourites of four words each, every word different from its third letter on.
  const favorites = Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => `${String.fromCharCode(97 + i)}${String.fromCharCode(97 + j)}qrstuvwxyzqrstuvwxyz`).join(" "));
  const tokens = chefSearchTokens({ displayName: "Mary Berry", favoriteThings: favorites });
  assert.equal(tokens.length, MAX_TOKENS);
  for (const name of ["ma", "mary", "be", "berry", "maryberry"]) assert.ok(tokens.includes(name), name);
});

test("a profile with nothing searchable has no tokens", () => {
  assert.deepEqual(chefSearchTokens({ displayName: "!!", favoriteThings: [] }), []);
  assert.deepEqual(chefSearchTokens(null), []);
  assert.deepEqual(chefSearchTokens({ displayName: "Bo", favoriteThings: "not a list" }), ["bo"]);
});

test("beginnings and sameTokens", () => {
  assert.deepEqual(beginnings("plug"), ["pl", "plu", "plug"]);
  assert.deepEqual(beginnings("a"), []);
  assert.equal(sameTokens(["a", "b"], ["a", "b"]), true);
  assert.equal(sameTokens(["b", "a"], ["a", "b"]), false);
  assert.equal(sameTokens(undefined, []), false);
});
