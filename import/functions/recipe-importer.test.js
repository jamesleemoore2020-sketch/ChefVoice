"use strict";

// Port of app/src/test/.../importer/RecipeImporterTest.kt, row for row.
//
// One difference from Android, on purpose: the phone's importer builds a whole `Recipe` with
// an author name and step ids because the phone is about to save it. This one returns a draft
// and the client saves it, so the fields that belong to the saving device -- ids, author,
// timestamps -- are the client's to fill. Everything the *page* said is settled here.

const test = require("node:test");
const assert = require("node:assert/strict");
const { importFrom } = require("./recipe-importer");
const { FetchError } = require("./page-fetcher");

const recipeJson = (extra = "") => `{"@context":"https://schema.org","@type":"Recipe","name":"Best Chili",
 "author":{"@type":"Person","name":"Jane Cook"},
 "recipeYield":"6 servings","prepTime":"PT15M","cookTime":"PT1H",
 "recipeIngredient":["1 lb ground beef","2 tbsp chili powder","1 (14 oz) can tomatoes"],
 "recipeInstructions":[{"@type":"HowToStep","text":"Brown the beef."},{"@type":"HowToStep","text":"Simmer."}]${extra}}`;

const pageOf = (json, url = "https://example.com/chili") => ({
  finalUrl: url,
  html: `<html><head><script type="application/ld+json">${json}</script></head></html>`
});

/** Records what the importer asked for, so "never reaches the network" can be asserted. */
const fakeFetcher = respond => {
  const requested = [];
  const fetchPageImpl = async url => {
    requested.push(url);
    return respond(url);
  };
  return { fetchPageImpl, requested };
};

const imported = async (input, fetcher) => {
  const result = await importFrom(input, { fetchPageImpl: fetcher.fetchPageImpl });
  assert.ok(!result.failed, `expected an import but got ${JSON.stringify(result)}`);
  return result;
};
const failed = async (input, fetcher) => {
  const result = await importFrom(input, { fetchPageImpl: fetcher.fetchPageImpl });
  assert.ok(result.failed, `expected a failure but got ${JSON.stringify(result)}`);
  return result.failed;
};

test("turns a page into an ordinary private recipe draft", async () => {
  const fetcher = fakeFetcher(() => pageOf(recipeJson()));
  const result = await imported("https://example.com/chili", fetcher);
  const recipe = result.recipe;

  assert.equal(recipe.title, "Best Chili");
  assert.equal(recipe.servings, 6);
  assert.equal(recipe.prepTimeMinutes, 15);
  assert.equal(recipe.cookTimeMinutes, 60);
  assert.deepEqual(recipe.steps, ["Brown the beef.", "Simmer."]);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.ingredients[0].name, "Ground beef");
  assert.equal(recipe.ingredients[0].unit, "lb");
  assert.equal(result.host, "example.com");
  assert.equal(result.notes.length, 0, `a complete page needs no follow-up notes: ${result.notes}`);
});

test("credits the source in the description so it travels with the published recipe", async () => {
  const fetcher = fakeFetcher(() => pageOf(recipeJson(`,"description":"A hearty weeknight chili."`)));
  const result = await imported("https://example.com/chili", fetcher);
  assert.equal(result.recipe.description, "A hearty weeknight chili.\n\nSource: Jane Cook · https://example.com/chili");
});

test("credits just the address when the page names no author or summary", async () => {
  const fetcher = fakeFetcher(() => pageOf(`{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`));
  const result = await imported("https://example.com/chili", fetcher);
  assert.equal(result.recipe.description, "Source: https://example.com/chili");
});

test("credits the page it actually came from after redirects", async () => {
  const fetcher = fakeFetcher(() => pageOf(recipeJson(), "https://real.example.org/recipes/chili"));
  const result = await imported("https://short.link/abc", fetcher);
  assert.ok(result.recipe.description.endsWith("https://real.example.org/recipes/chili"));
  assert.equal(result.host, "real.example.org");
});

test("shortens a long summary at a word boundary", async () => {
  const long = "word ".repeat(200).trim();
  const fetcher = fakeFetcher(() => pageOf(recipeJson(`,"description":"${long}"`)));
  const result = await imported("https://example.com/chili", fetcher);
  const summary = result.recipe.description.split("\n\nSource:")[0];
  assert.ok(summary.length <= 501);
  assert.ok(summary.endsWith("…"));
  assert.ok(!summary.slice(0, -1).endsWith(" "));
});

test("caps an overlong title to what the Community rules accept", async () => {
  const fetcher = fakeFetcher(() => pageOf(`{"@type":"Recipe","name":"${"T".repeat(300)}","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`));
  const result = await imported("https://example.com/chili", fetcher);
  assert.equal(result.recipe.title.length, 180);
});

test("names the gaps a page leaves instead of filling them quietly", async () => {
  const fetcher = fakeFetcher(() => pageOf(`{"@type":"Recipe","name":"Bare","recipeIngredient":["1 egg"]}`));
  const result = await imported("https://example.com/chili", fetcher);

  assert.equal(result.recipe.servings, 2);
  assert.equal(result.recipe.prepTimeMinutes, 0);
  const notes = result.notes.join(" | ");
  assert.ok(notes.includes("doesn't say how many it serves"), notes);
  assert.ok(notes.includes("no prep or cook time"), notes);
  assert.ok(notes.includes("no method steps"), notes);
});

test("a recipe with no title anywhere is still saved under a default name", async () => {
  const fetcher = fakeFetcher(() => ({
    finalUrl: "https://example.com/x",
    html: `<html><script type="application/ld+json">{"@type":"Recipe","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}</script></html>`
  }));
  const result = await imported("https://example.com/x", fetcher);
  assert.equal(result.recipe.title, "Imported recipe");
});

test("an unusable link never reaches the network", async () => {
  const fetcher = fakeFetcher(() => { throw new Error("must not fetch"); });
  assert.ok((await failed("not a link", fetcher)).includes("web address"));
  assert.ok((await failed("https://192.168.1.1/admin", fetcher)).includes("public web page"));
  assert.equal(fetcher.requested.length, 0);
});

test("fetches the cleaned address, not the raw paste", async () => {
  const fetcher = fakeFetcher(() => pageOf(recipeJson()));
  await importFrom("Look: http://www.example.com/chili?utm_source=x", { fetchPageImpl: fetcher.fetchPageImpl });
  assert.deepEqual(fetcher.requested, ["https://www.example.com/chili"]);
});

test("passes a fetch problem through in the chef's language", async () => {
  const fetcher = fakeFetcher(() => { throw new FetchError("That page wasn't found. Check the address."); });
  assert.equal(await failed("https://example.com/x", fetcher), "That page wasn't found. Check the address.");
});

test("turns an unexpected error into a message rather than a crash", async () => {
  const fetcher = fakeFetcher(() => { throw new TypeError("boom"); });
  assert.ok((await failed("https://example.com/x", fetcher)).includes("nothing was saved"));
});

test("reports a page with no structured recipe", async () => {
  const fetcher = fakeFetcher(() => ({ finalUrl: "https://example.com/blog", html: "<html><body>1 cup flour, mix well.</body></html>" }));
  assert.ok((await failed("https://example.com/blog", fetcher)).includes("doesn't publish its recipe"));
});
