"use strict";

// Port of app/.../importer/RecipeHtmlExtractor.kt. Keep the two in step.
//
// Reads a recipe out of a web page's schema.org `Recipe` data (JSON-LD), which is what
// essentially every mainstream recipe site publishes for search engines.
//
// **Deterministic and read-only**, by the same rule as the voice parser: it reports what the
// page says, and where the page says nothing it says nothing. It does not scrape visible text,
// guess a missing quantity, split a paragraph into steps, or rewrite anything. A page without
// structured recipe data is reported as such -- "not found" is an honest answer, a
// half-guessed recipe is not.
//
// Kept entirely apart from the voice parser: nothing here can change how a narrated recipe is
// parsed, and no golden-corpus row can be affected by it.

const HtmlText = require("./html-text");
const { canonicalTag } = require("./tag-utils");

const MAX_LIST = 300;
const MAX_MINUTES = 100000;
const MAX_TAGS = 5;
const MAX_DEPTH = 8;

const JSON_LD_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title\s*>/i;

const NOT_PUBLISHED =
  "That page doesn't publish its recipe in a form ChefVoice can read, so nothing was saved. " +
  "Try the recipe's own page rather than a search or category page.";
const NO_CONTENT =
  "That page mentions a recipe but doesn't list its ingredients or method, so nothing was saved.";

// -- locating the data ----------------------------------------------------------

/**
 * Real pages put raw newlines and tabs inside JSON strings, which is invalid JSON. Some JSON
 * readers tolerate it and some do not, so the tolerance is provided here rather than left to
 * whichever reader happens to be running.
 */
function escapeControlCharsInStrings(json) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of json) {
    if (inString) {
      if (escaped) { escaped = false; out += char; }
      else if (char === "\\") { escaped = true; out += char; }
      else if (char === '"') { inString = false; out += char; }
      else if (char === "\n") out += "\\n";
      else if (char === "\r") out += "\\r";
      else if (char === "\t") out += "\\t";
      else if (char < " ") out += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
      else out += char;
    } else {
      if (char === '"') inString = true;
      out += char;
    }
  }
  return out;
}

function parseJson(raw) {
  const trimmed = String(raw ?? "").trim();
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) if (trimmed[i] === "{" || trimmed[i] === "[") { start = i; break; }
  let end = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) if (trimmed[i] === "}" || trimmed[i] === "]") { end = i; break; }
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(escapeControlCharsInStrings(trimmed.slice(start, end + 1)));
  } catch {
    return null;
  }
}

function isRecipeType(type) {
  if (typeof type === "string") {
    const tail = type.split("/").pop().split(":").pop();
    return tail.toLowerCase() === "recipe";
  }
  if (Array.isArray(type)) return type.some(isRecipeType);
  return false;
}

function collectRecipes(node, out, depth) {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRecipes(item, out, depth + 1);
    return;
  }
  if (node && typeof node === "object") {
    if (isRecipeType(node["@type"])) { out.push(node); return; }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") collectRecipes(value, out, depth + 1);
    }
  }
}

// -- mapping fields -------------------------------------------------------------

/** Text of a scalar, or of the most useful field of an object / first item of a list. */
function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return HtmlText.line(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") return textOf(value.text) || textOf(value.name);
  return "";
}

function ingredientLines(recipe) {
  const source = recipe.recipeIngredient ?? recipe.ingredients ?? recipe.recipeIngredients;
  let out = [];
  if (typeof source === "string") out = HtmlText.lines(source);
  else if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === "string") out.push(...HtmlText.lines(item));
      else out.push(textOf(item));
    }
  }
  return out.filter(text => text && text.trim()).slice(0, MAX_LIST);
}

/** "1. Mix" / "Step 2: Bake" -> "Mix" / "Bake". The app numbers steps itself. */
const stripStepNumber = line => line.replace(/^(?:step\s*)?\d{1,2}\s*[.):-]\s+/i, "").trim();

function collectSteps(value, out, sectionName, depth) {
  if (depth > MAX_DEPTH || out.length >= MAX_LIST) return;
  let heading = sectionName;
  const add = text => {
    if (!text || !text.trim()) return;
    out.push(heading ? `${heading.replace(/:+$/, "")}: ${text}` : text);
    heading = "";
  };
  if (typeof value === "string") {
    for (const item of HtmlText.lines(value)) add(stripStepNumber(item));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const before = out.length;
      collectSteps(item, out, heading, depth + 1);
      if (out.length > before) heading = "";
    }
    return;
  }
  if (value && typeof value === "object") {
    if (value.itemListElement !== undefined && value.itemListElement !== null) {
      collectSteps(value.itemListElement, out, textOf(value.name) || heading, depth + 1);
    } else {
      for (const item of HtmlText.lines(textOf(value.text) || textOf(value.name))) add(stripStepNumber(item));
    }
  }
}

/**
 * Method steps in page order. Handles the four shapes sites actually use: one string with a
 * step per line, a list of strings, a list of `HowToStep` objects, and `HowToSection` groups
 * (whose heading is kept on the group's first step, since "for the frosting" says which
 * component a step belongs to).
 */
function instructionSteps(value) {
  const out = [];
  collectSteps(value, out, "", 0);
  return out.slice(0, MAX_LIST);
}

function servingsOf(value) {
  const candidates = Array.isArray(value) ? value.map(textOf) : [textOf(value)];
  for (const candidate of candidates) {
    const match = /\d{1,4}/.exec(candidate);
    if (!match) continue;
    const number = Number(match[0]);
    if (number >= 1 && number <= 1000) return number;
  }
  return null;
}

const ISO_DURATION = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/** ISO 8601 ("PT1H30M") first, then the plain "45 minutes" some sites write instead. */
function minutesOf(value) {
  const clamp = n => Math.min(Math.max(n, 0), MAX_MINUTES);
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(clamp(value)) : 0;
  const text = textOf(value).trim();
  if (!text) return 0;

  const iso = ISO_DURATION.exec(text);
  // "P" alone matches the pattern but states no duration; a match with no captured part is
  // not a duration, it is a stray token.
  if (iso && iso.slice(1).some(part => part !== undefined)) {
    const part = index => Number(iso[index] ?? 0) || 0;
    const minutes = part(1) * 10080 + part(2) * 1440 + part(3) * 60 + part(4) + part(5) / 60;
    return clamp(Math.ceil(minutes));
  }

  const lower = text.toLowerCase();
  if (/^\d+$/.test(lower)) return clamp(Number(lower));
  const hours = Number(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/.exec(lower)?.[1] ?? 0) || 0;
  const mins = Number(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/.exec(lower)?.[1] ?? 0) || 0;
  return clamp(Math.ceil(hours * 60 + mins));
}

const splitList = text => String(text ?? "").split(/[,;|]/).map(s => s.trim()).filter(Boolean);

function tagsOf(recipe, author) {
  const words = [];
  for (const key of ["recipeCategory", "recipeCuisine", "keywords"]) {
    const value = recipe[key];
    if (Array.isArray(value)) for (const item of value) words.push(...splitList(textOf(item)));
    else words.push(...splitList(textOf(value)));
  }
  // Sites often list the author among the keywords; that is a credit, not a tag.
  const authorTag = canonicalTag(author);
  const out = [];
  for (const word of words) {
    const tag = canonicalTag(word);
    if (!tag || tag.length > 24 || tag === authorTag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function authorOf(value) {
  if (typeof value === "string") return HtmlText.line(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = authorOf(item);
      if (name) return name;
    }
    return "";
  }
  if (value && typeof value === "object") return textOf(value.name);
  return "";
}

function toImported(recipe, html) {
  const titleFromTag = TITLE_TAG.exec(html || "");
  const title = textOf(recipe.name) || textOf(recipe.headline) ||
    (titleFromTag ? HtmlText.line(titleFromTag[1]) : "");
  const prep = minutesOf(recipe.prepTime);
  const cook = minutesOf(recipe.cookTime);
  const total = minutesOf(recipe.totalTime);
  const author = authorOf(recipe.author);
  return {
    title,
    description: textOf(recipe.description),
    servings: servingsOf(recipe.recipeYield),
    prepTimeMinutes: prep,
    // A page that only states a total has told us how long it takes, not how the time splits.
    // The total goes in the cook slot rather than being dropped.
    cookTimeMinutes: prep === 0 && cook === 0 ? total : cook,
    ingredientLines: ingredientLines(recipe),
    steps: instructionSteps(recipe.recipeInstructions),
    tags: tagsOf(recipe, author),
    author
  };
}

function completeness(recipe) {
  const hasIngredients = ingredientLines(recipe).length > 0;
  const hasSteps = instructionSteps(recipe.recipeInstructions).length > 0;
  return (hasIngredients ? 2 : 0) + (hasSteps ? 1 : 0);
}

/** `{recipe}` when the page publishes one, `{notFound}` with a message written for the chef. */
function extract(html) {
  const recipes = [];
  const source = String(html ?? "");
  JSON_LD_SCRIPT.lastIndex = 0;
  let match;
  while ((match = JSON_LD_SCRIPT.exec(source)) !== null) {
    const parsed = parseJson(match[1]);
    if (parsed) collectRecipes(parsed, recipes, 0);
  }
  if (!recipes.length) return { notFound: NOT_PUBLISHED };

  // A page can carry several: a roundup lists stubs with no ingredients. Prefer the one that
  // is actually a whole recipe.
  let best = recipes[0];
  for (const candidate of recipes) if (completeness(candidate) > completeness(best)) best = candidate;

  const imported = toImported(best, source);
  if (!imported.ingredientLines.length && !imported.steps.length) return { notFound: NO_CONTENT };
  return { recipe: imported };
}

module.exports = { extract, minutesOf, NOT_PUBLISHED, NO_CONTENT };
