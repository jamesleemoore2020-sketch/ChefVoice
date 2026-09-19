"use strict";

// Port of app/src/test/.../importer/HtmlTextTest.kt, row for row.

const test = require("node:test");
const assert = require("node:assert/strict");
const HtmlText = require("./html-text");

test("decodes named and numeric entities", () => {
  assert.equal(HtmlText.decodeEntities("Fish &amp; chips"), "Fish & chips");
  assert.equal(HtmlText.decodeEntities("the egg&#39;s yolk"), "the egg's yolk");
  assert.equal(HtmlText.decodeEntities("the egg&#x27;s yolk"), "the egg's yolk");
  assert.equal(HtmlText.decodeEntities("&frac12; cup"), "½ cup");
  assert.equal(HtmlText.decodeEntities("350&deg;F"), "350°F");
});

test("decodes text that was encoded twice", () => {
  assert.equal(HtmlText.decodeEntities("the egg&amp;#39;s yolk"), "the egg's yolk");
});

test("leaves an unknown entity as written", () => {
  assert.equal(HtmlText.decodeEntities("a &bogus; b"), "a &bogus; b");
});

test("strips tags and turns line endings into lines", () => {
  assert.deepEqual(HtmlText.lines("<p>Chop the <b>onion</b></p><p>Fry until soft</p>"), ["Chop the onion", "Fry until soft"]);
  assert.deepEqual(HtmlText.lines("one<br>two<br/>three"), ["one", "two", "three"]);
});

test("a bare less-than sign is text, not a tag", () => {
  assert.equal(HtmlText.line("Bake < 20 minutes, then cool"), "Bake < 20 minutes, then cool");
});

test("collapses whitespace and drops empty lines", () => {
  assert.deepEqual(HtmlText.lines("  a    b \n\n\r\n c  "), ["a b", "c"]);
});

test("an encoded tag is text, not markup", () => {
  // Tags are stripped before entities are decoded, so this stays literal text.
  assert.equal(HtmlText.line("use &lt;b&gt; for bold"), "use <b> for bold");
});
