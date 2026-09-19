"use strict";

// Port of app/src/test/.../importer/RecipeHtmlExtractorTest.kt, row for row.
//
// The extractor reports what a page's structured data says and nothing else, so most of these
// are about the shapes real sites publish -- and about what is *not* invented when the page
// leaves something out.

const test = require("node:test");
const assert = require("node:assert/strict");
const { extract, minutesOf } = require("./recipe-html-extractor");

const page = (blocks, head = "<title>Some Site</title>") =>
  `<html><head>${head}${(Array.isArray(blocks) ? blocks : [blocks])
    .map(block => `<script type="application/ld+json">${block}</script>`)
    .join("")}</head><body><p>Visible text that is never used.</p></body></html>`;

const found = html => {
  const result = extract(html);
  assert.ok(result.recipe, `expected a recipe but got ${JSON.stringify(result)}`);
  return result.recipe;
};
const notFound = html => {
  const result = extract(html);
  assert.ok(result.notFound, `expected notFound but got ${JSON.stringify(result)}`);
  return result.notFound;
};

const FULL_RECIPE = `{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Best Chili",
  "description": "A hearty <b>weeknight</b> chili.",
  "author": {"@type": "Person", "name": "Jane Cook"},
  "recipeYield": ["6", "6 servings"],
  "prepTime": "PT15M",
  "cookTime": "PT1H30M",
  "totalTime": "PT1H45M",
  "recipeCategory": "Dinner",
  "recipeCuisine": "American",
  "keywords": "chili, beef, Weeknight Dinner",
  "recipeIngredient": ["1 lb ground beef", "2 tbsp chili powder", "1 (14 oz) can tomatoes"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Brown the beef."},
    {"@type": "HowToStep", "text": "Add everything else &amp; simmer."}
  ]
}`;

test("reads every field of a whole recipe", () => {
  const recipe = found(page(FULL_RECIPE));
  assert.equal(recipe.title, "Best Chili");
  assert.equal(recipe.description, "A hearty weeknight chili.");
  assert.equal(recipe.author, "Jane Cook");
  assert.equal(recipe.servings, 6);
  assert.equal(recipe.prepTimeMinutes, 15);
  assert.equal(recipe.cookTimeMinutes, 90);
  assert.deepEqual(recipe.ingredientLines, ["1 lb ground beef", "2 tbsp chili powder", "1 (14 oz) can tomatoes"]);
  assert.deepEqual(recipe.steps, ["Brown the beef.", "Add everything else & simmer."]);
  assert.deepEqual(recipe.tags, ["dinner", "american", "chili", "beef", "weeknightdinner"]);
});

test("finds the recipe inside a graph", () => {
  const recipe = found(page(`{"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":"A Site"},
    {"@type":["Recipe"],"name":"Pancakes","recipeIngredient":["2 cups flour"],"recipeInstructions":"Mix.\\nCook."}
  ]}`));
  assert.equal(recipe.title, "Pancakes");
  assert.deepEqual(recipe.steps, ["Mix.", "Cook."]);
});

test("accepts a recipe that is also another type", () => {
  assert.equal(found(page(`{"@type":["Recipe","NewsArticle"],"name":"Soup","recipeIngredient":["1 cup water"],"recipeInstructions":["Boil."]}`)).title, "Soup");
});

test("finds a recipe nested under a WebPage", () => {
  assert.equal(found(page(`{"@type":"WebPage","mainEntity":{"@type":"Recipe","name":"Toast","recipeIngredient":["1 slice bread"],"recipeInstructions":["Toast it."]}}`)).title, "Toast");
});

test("skips other structured data blocks and broken ones", () => {
  const recipe = found(page([`{"@type":"Organization","name":"Acme"}`, `{ this is not json`, FULL_RECIPE]));
  assert.equal(recipe.title, "Best Chili");
});

test("tolerates attribute order, quotes and case", () => {
  const block = `{"@type":"Recipe","name":"Soup","recipeIngredient":["1 cup water"],"recipeInstructions":["Boil."]}`;
  assert.equal(found(`<SCRIPT class="graph" TYPE='application/ld+json'>${block}</SCRIPT>`).title, "Soup");
});

test("tolerates raw newlines inside JSON strings", () => {
  // Invalid JSON, but real pages emit it constantly.
  const block = '{"@type":"Recipe","name":"Soup","recipeIngredient":["1 cup water"],"recipeInstructions":"Boil.\nServe."}';
  assert.deepEqual(found(page(block)).steps, ["Boil.", "Serve."]);
});

// -- method steps -------------------------------------------------------------------

test("keeps section headings on the first step of each group", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"Pasta","recipeIngredient":["1 lb pasta"],"recipeInstructions":[
    {"@type":"HowToSection","name":"For the sauce","itemListElement":[
      {"@type":"HowToStep","text":"Simmer the tomatoes."},
      {"@type":"HowToStep","text":"Blend."}]},
    {"@type":"HowToSection","name":"To finish","itemListElement":[
      {"@type":"HowToStep","text":"Toss with pasta."}]}
  ]}`));
  assert.deepEqual(recipe.steps, ["For the sauce: Simmer the tomatoes.", "Blend.", "To finish: Toss with pasta."]);
});

test("strips step numbers because the app numbers steps itself", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"Bread","recipeIngredient":["1 cup flour"],"recipeInstructions":"1. Preheat the oven.\\n2. Bake for 20 minutes.\\nStep 3: Cool."}`));
  assert.deepEqual(recipe.steps, ["Preheat the oven.", "Bake for 20 minutes.", "Cool."]);
});

test("does not mistake a quantity for a step number", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"Bread","recipeIngredient":["1 cup flour"],"recipeInstructions":["10-15 minutes: bake until golden.","2 cups of stock go in now."]}`));
  assert.deepEqual(recipe.steps, ["10-15 minutes: bake until golden.", "2 cups of stock go in now."]);
});

test("splits steps at line breaks but never inside a paragraph", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"Eggs","recipeIngredient":["2 eggs"],"recipeInstructions":["Fold in the egg&#39;s yolk<br>then chill","Whisk. Then whisk again. Then rest."]}`));
  assert.deepEqual(recipe.steps, ["Fold in the egg's yolk", "then chill", "Whisk. Then whisk again. Then rest."]);
});

// -- servings and time ---------------------------------------------------------------

test("reads yield in the forms sites write it", () => {
  const servings = recipeYield =>
    found(page(`{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"recipeYield":${recipeYield}}`)).servings;
  assert.equal(servings('"4 servings"'), 4);
  assert.equal(servings("6"), 6);
  assert.equal(servings('"Makes 24 cookies"'), 24);
  assert.equal(servings('"Serves 4 to 6"'), 4);
  assert.equal(servings('["", "8"]'), 8);
});

test("leaves servings unset when the page does not say, or says nonsense", () => {
  const base = `{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]`;
  assert.equal(found(page(`${base}}`)).servings, null);
  assert.equal(found(page(`${base},"recipeYield":"0"}`)).servings, null);
  assert.equal(found(page(`${base},"recipeYield":"a few"}`)).servings, null);
});

test("reads ISO and plain durations", () => {
  assert.equal(minutesOf("PT45M"), 45);
  assert.equal(minutesOf("PT1H30M"), 90);
  assert.equal(minutesOf("P0DT1H"), 60);
  assert.equal(minutesOf("P1D"), 1440);
  assert.equal(minutesOf("PT0.5H"), 30);
  assert.equal(minutesOf("PT90S"), 2);
  assert.equal(minutesOf("45 minutes"), 45);
  assert.equal(minutesOf("1 hr 30 min"), 90);
  assert.equal(minutesOf("1 hour"), 60);
  assert.equal(minutesOf("30"), 30);
  assert.equal(minutesOf(45), 45);
});

test("reads an unreadable duration as no time rather than guessing", () => {
  assert.equal(minutesOf(null), 0);
  assert.equal(minutesOf(""), 0);
  assert.equal(minutesOf("PT"), 0);
  assert.equal(minutesOf("a while"), 0);
});

test("caps absurd durations within what the Community rules accept", () => {
  assert.equal(minutesOf("P365D"), 100000);
});

test("a page that only states a total puts it in the cook slot rather than dropping it", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"totalTime":"PT30M"}`));
  assert.equal(recipe.prepTimeMinutes, 0);
  assert.equal(recipe.cookTimeMinutes, 30);
});

test("does not infer cook time from a total when prep is given", () => {
  // Total minus prep might be cooking, or might be chilling. That is a guess.
  const recipe = found(page(`{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"prepTime":"PT10M","totalTime":"PT40M"}`));
  assert.equal(recipe.prepTimeMinutes, 10);
  assert.equal(recipe.cookTimeMinutes, 0);
});

// -- ingredients, title, tags ----------------------------------------------------------

test("reads ingredients given as one newline-separated string", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"X","recipeIngredient":"1 cup flour\\n2 eggs","recipeInstructions":["Mix."]}`));
  assert.deepEqual(recipe.ingredientLines, ["1 cup flour", "2 eggs"]);
});

test("falls back to the page title when the recipe has no name", () => {
  const recipe = found(page(
    `{"@type":"Recipe","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`,
    "<title>Grandma&#39;s Pie | Some Site</title>"
  ));
  assert.equal(recipe.title, "Grandma's Pie | Some Site");
});

test("caps tags and drops duplicates and overlong ones", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],
    "recipeCategory":["Dinner","dinner"],"recipeCuisine":"Italian","keywords":"a, b, c, d, e, f, this tag is far too long to be useful here"}`));
  assert.deepEqual(recipe.tags, ["dinner", "italian", "a", "b", "c"]);
});

test("does not turn the author's name into a tag", () => {
  // Real pages list the author among their keywords. That is a credit, not a tag.
  const recipe = found(page(`{"@type":"Recipe","name":"X","author":{"@type":"Person","name":"Cassie Best"},"recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"recipeCategory":"Breakfast","keywords":"pancakes, Cassie Best, brunch"}`));
  assert.deepEqual(recipe.tags, ["breakfast", "pancakes", "brunch"]);
});

test("reads an author given as a string or a list", () => {
  assert.equal(found(page(`{"@type":"Recipe","name":"X","author":"Sam Lee","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`)).author, "Sam Lee");
  assert.equal(found(page(`{"@type":"Recipe","name":"X","author":[{"@type":"Person","name":"Kim Ray"}],"recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`)).author, "Kim Ray");
});

// -- choosing and refusing -------------------------------------------------------------

test("prefers the whole recipe over stubs on a roundup page", () => {
  const recipe = found(page([
    `{"@type":"Recipe","name":"Teaser only"}`,
    `{"@type":"Recipe","name":"The real one","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}`
  ]));
  assert.equal(recipe.title, "The real one");
});

test("says so when a page has no structured recipe", () => {
  const message = notFound("<html><head><title>Blog</title></head><body>1 cup flour, 2 eggs, mix well.</body></html>");
  assert.ok(message.includes("doesn't publish its recipe"), message);
});

test("never scrapes visible text even when it looks like a recipe", () => {
  const message = notFound(page(`{"@type":"Organization","name":"Acme"}`));
  assert.ok(message.includes("doesn't publish its recipe"), message);
});

test("says so when the recipe has no ingredients or method", () => {
  const message = notFound(page(`{"@type":"Recipe","name":"Just a name","description":"Delicious."}`));
  assert.ok(message.includes("doesn't list its ingredients or method"), message);
});

test("a recipe with only ingredients is still imported", () => {
  const recipe = found(page(`{"@type":"Recipe","name":"Salad","recipeIngredient":["1 head lettuce"]}`));
  assert.equal(recipe.ingredientLines.length, 1);
  assert.equal(recipe.steps.length, 0);
});
