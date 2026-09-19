"use strict";

// Port of app/src/test/.../importer/WrittenIngredientParserTest.kt, row for row.
//
// A wrong amount on an imported recipe is worse than a missing one: the chef trusts the number
// and cooks from it. So these pin the parser as fail-soft -- an amount is only read when it is
// unambiguous, and everything else keeps its words.

const test = require("node:test");
const assert = require("node:assert/strict");
const WrittenIngredientParser = require("./written-ingredient-parser");

const assertParsed = (line, quantity, unit, name) => {
  const parsed = WrittenIngredientParser.parse(line);
  assert.equal(parsed.quantity, quantity, `quantity of "${line}"`);
  assert.equal(parsed.unit, unit, `unit of "${line}"`);
  assert.equal(parsed.name, name, `name of "${line}"`);
};

test("splits the common amount/unit/name shape", () => {
  assertParsed("1 1/2 cups all-purpose flour, sifted", "1 1/2", "cup", "All-purpose flour, sifted");
  assertParsed("2 tablespoons olive oil", "2", "tbsp", "Olive oil");
  assertParsed("1 lb ground beef", "1", "lb", "Ground beef");
  assertParsed("3 cloves garlic, minced", "3", "clove", "Garlic, minced");
  assertParsed("200g flour", "200", "g", "Flour");
  assertParsed("1 fl oz brandy", "1", "fl oz", "Brandy");
  assertParsed("8 fluid ounces water", "8", "fl oz", "Water");
});

test("reads unicode and glued fractions", () => {
  assertParsed("½ teaspoon salt", "1/2", "tsp", "Salt");
  assertParsed("1½ cups milk", "1 1/2", "cup", "Milk");
  assertParsed("⅛ cup sugar", "1/8", "cup", "Sugar");
});

test("keeps ranges as written so they are never scaled or summed", () => {
  assertParsed("1-2 tablespoons honey", "1-2", "tbsp", "Honey");
  assertParsed("1 to 2 tablespoons honey", "1 to 2", "tbsp", "Honey");
  assertParsed("1–2 tbsp oil", "1-2", "tbsp", "Oil");
});

test("moves package sizes after the name so different sizes stay apart", () => {
  assertParsed("1 (14.5 ounce) can diced tomatoes, undrained", "1", "can", "Diced tomatoes, undrained (14.5 ounce)");
  assertParsed("2 (14 oz) cans crushed tomatoes", "2", "can", "Crushed tomatoes (14 oz)");
  assertParsed("1/2 cup (1 stick) unsalted butter", "1/2", "cup", "Unsalted butter (1 stick)");
});

test("keeps how a measure is filled", () => {
  assertParsed("2 heaping tablespoons sugar", "2", "tbsp", "Sugar (heaping)");
});

// -- lines seen on real recipe sites (the first live-page validation of the importer) ----

test("lifts a size word out of the way only when a unit follows", () => {
  assertParsed("1 large can (28 ounces) diced tomatoes, lightly drained", "1", "can", "Diced tomatoes, lightly drained (large) (28 ounces)");
  assertParsed("4 medium cloves garlic, minced", "4", "clove", "Garlic, minced (medium)");
  // No unit follows, so the words stay exactly where the page put them.
  assertParsed("1 large onion, finely minced (about 8 ounces; 225g)", "1", "", "Large onion, finely minced (about 8 ounces; 225g)");
  assertParsed("3 large eggs", "3", "", "Large eggs");
});

test("reads ribs as a unit", () => {
  assertParsed("4 ribs celery, finely chopped (about 8 ounces; 225g)", "4", "rib", "Celery, finely chopped (about 8 ounces; 225g)");
});

test("reads a bare leading pinch as one pinch", () => {
  assertParsed("Pinch of red pepper flakes", "1", "pinch", "Red pepper flakes");
  assertParsed("Pinch freshly ground black pepper", "1", "pinch", "Freshly ground black pepper");
  assertParsed("Dash hot sauce", "1", "dash", "Hot sauce");
  // A unit word on its own is not a line to invent an amount for...
  assertParsed("Pinch", "", "", "Pinch");
  // ...and only inherently whole amounts are read this way.
  assertParsed("Cup of tea", "", "", "Cup of tea");
});

test("cleans up spacing that the source or the fraction expansion leaves behind", () => {
  assertParsed(
    "1 to 2 tablespoons lemon juice (½ to 1 medium lemon), to taste",
    "1 to 2", "tbsp", "Lemon juice (1/2 to 1 medium lemon), to taste"
  );
  assertParsed("Tortilla chips , to serve", "", "", "Tortilla chips, to serve");
});

test("a size is not an amount", () => {
  // "1 1/2-inch" describes the ginger; reading it as 1 1/2 of something would be a guess.
  assertParsed("1 1/2-inch piece fresh ginger", "", "", "1 1/2-inch piece fresh ginger");
  assertParsed("5-spice powder", "", "", "5-spice powder");
});

test("lines with no amount keep every word", () => {
  assertParsed("Salt and pepper, to taste", "", "", "Salt and pepper, to taste");
  assertParsed("Fresh basil leaves for garnish", "", "", "Fresh basil leaves for garnish");
});

test("understands word amounts", () => {
  assertParsed("a pinch of salt", "1", "pinch", "Salt");
  assertParsed("two eggs", "2", "", "Eggs");
  // "a" is only an amount when a unit follows, or "a little salt" would become 1.
  assertParsed("a little salt", "", "", "A little salt");
});

test("drops an 'of' after the unit and punctuation after an abbreviation", () => {
  assertParsed("1 cup of milk", "1", "cup", "Milk");
  assertParsed("2 tsp. vanilla extract", "2", "tsp", "Vanilla extract");
});

test("strips list markers", () => {
  assertParsed("• 2 cups flour", "2", "cup", "Flour");
  assertParsed("▢1 cup sugar", "1", "cup", "Sugar");
});

test("never loses words when there is nothing to attach the amount to", () => {
  assertParsed("2 cups", "", "", "2 cups");
});

test("blank lines give an empty ingredient", () => {
  assertParsed("", "", "", "");
  assertParsed("   ", "", "", "");
});
