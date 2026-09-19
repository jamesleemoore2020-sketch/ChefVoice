"use strict";

// Port of app/.../importer/RecipeImporter.kt. Keep the two in step.
//
// Recipe import from a web address: normalize the link, fetch the page, read the recipe the
// page itself publishes, and turn it into an ordinary private recipe draft.
//
// Every step is deterministic and there is no language model anywhere in it. What the page
// does not say stays unsaid -- a missing yield is reported and left at the app's default
// rather than estimated, and ingredient lines the parser cannot split keep their words. The
// result is a normal recipe in every respect (editable, scalable, cookable, shoppable);
// nothing about it is special-cased downstream.

const RecipeUrl = require("./recipe-url");
const { extract } = require("./recipe-html-extractor");
const WrittenIngredientParser = require("./written-ingredient-parser");
const { fetchPage, FetchError } = require("./page-fetcher");

const SUMMARY_LIMIT = 500;
const TITLE_LIMIT = 180;
const DEFAULT_SERVINGS = 2;
const GENERIC_FAILURE = "Something went wrong reading that page, so nothing was saved.";

function shorten(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  const end = space > limit / 2 ? space : limit;
  return `${cut.slice(0, end).replace(/[,;:\s]+$/, "")}…`;
}

/**
 * The page's own summary followed by where the recipe came from.
 *
 * The credit lives in the description because that field already travels everywhere a recipe
 * does, including publishing. A dedicated field would need a Firestore rules change, and would
 * still leave a published recipe looking like the chef's own.
 */
function describe(imported, sourceUrl) {
  const credit = `Source: ${imported.author ? `${imported.author} · ` : ""}${sourceUrl}`;
  const summary = shorten(imported.description || "", SUMMARY_LIMIT);
  return summary ? `${summary}\n\n${credit}` : credit;
}

/** Turns an extracted page into the recipe draft the client saves. */
function build(imported, sourceUrl) {
  const ingredients = imported.ingredientLines
    .map(line => WrittenIngredientParser.parse(line))
    .filter(ingredient => ingredient.name && ingredient.name.trim());

  // Notes are things the chef should look at: gaps the page left, never guesses.
  const notes = [];
  if (imported.servings === null || imported.servings === undefined) {
    notes.push(`The page doesn't say how many it serves, so servings is set to ${DEFAULT_SERVINGS}. Check it before scaling.`);
  }
  if (imported.prepTimeMinutes === 0 && imported.cookTimeMinutes === 0) notes.push("The page lists no prep or cook time.");
  if (!ingredients.length) notes.push("The page lists no ingredients.");
  if (!imported.steps.length) notes.push("The page lists no method steps.");

  return {
    recipe: {
      title: (imported.title || "Imported recipe").slice(0, TITLE_LIMIT),
      description: describe(imported, sourceUrl),
      servings: imported.servings ?? DEFAULT_SERVINGS,
      prepTimeMinutes: imported.prepTimeMinutes,
      cookTimeMinutes: imported.cookTimeMinutes,
      ingredients,
      steps: imported.steps,
      tags: imported.tags
    },
    notes,
    host: RecipeUrl.displayHost(sourceUrl),
    sourceUrl
  };
}

/**
 * The whole import. Returns `{recipe, notes, host, sourceUrl}` or `{failed: message}`, where
 * the message is written for the chef and can be shown as it stands.
 */
async function importFrom(rawInput, options = {}) {
  const checked = RecipeUrl.normalize(rawInput);
  // An unusable link never reaches the network.
  if (!checked.url) return { failed: checked.rejected };
  const fetchPageImpl = options.fetchPageImpl || fetchPage;
  try {
    const page = await fetchPageImpl(checked.url, options);
    const extracted = extract(page.html);
    if (extracted.notFound) return { failed: extracted.notFound };
    return build(extracted.recipe, page.finalUrl);
  } catch (error) {
    if (error instanceof FetchError) return { failed: error.message };
    return { failed: GENERIC_FAILURE };
  }
}

module.exports = { importFrom, build, describe, DEFAULT_SERVINGS, GENERIC_FAILURE };
