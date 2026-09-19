"use strict";

// Port of app/.../importer/WrittenIngredientParser.kt. Keep the two in step.
//
// Splits an ingredient line as a website prints it -- "1 1/2 cups all-purpose flour, sifted"
// -- into the amount / unit / name shape the rest of the app stores.
//
// This is deliberately not the voice ingredient parser. That one is tuned for what speech
// recognition produces and is pinned row by row by the golden corpus. A written line has
// different failure modes -- unicode fractions, ranges, "(14 oz) can" -- and this needs to be
// free to be wrong about them without ever being able to disturb a spoken one.
//
// It follows the same rule the scaling and shopping code do: **fail soft**. When an amount
// cannot be read with confidence the whole line is kept as the name with no amount, so
// importing can never invent a number or drop words. Units are written the way the voice
// parser writes them ("cup", "tbsp", "clove") so that scaling, unit conversion and
// shopping-list merging treat an imported recipe exactly like a narrated one.

const VULGAR_FRACTIONS = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
  "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"
};

const NUMBER_WORDS = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12"
};

/** Written spelling -> the canonical spelling the voice parser also produces. */
const UNITS = {};
const addUnit = (canonical, ...spellings) => { for (const s of spellings) UNITS[s] = canonical; };
addUnit("tbsp", "tablespoon", "tablespoons", "tbsp", "tbsps", "tbs", "tbl");
addUnit("tsp", "teaspoon", "teaspoons", "tsp", "tsps");
addUnit("cup", "cup", "cups");
addUnit("oz", "ounce", "ounces", "oz");
addUnit("fl oz", "fluid ounce", "fluid ounces", "fl oz", "fl. oz");
addUnit("lb", "pound", "pounds", "lb", "lbs");
addUnit("g", "gram", "grams", "g");
addUnit("kg", "kilogram", "kilograms", "kg", "kgs");
addUnit("mg", "milligram", "milligrams", "mg");
addUnit("ml", "milliliter", "milliliters", "millilitre", "millilitres", "ml");
addUnit("L", "liter", "liters", "litre", "litres", "l");
addUnit("pint", "pint", "pints", "pt");
addUnit("quart", "quart", "quarts", "qt");
addUnit("gallon", "gallon", "gallons", "gal");
addUnit("pinch", "pinch", "pinches");
addUnit("dash", "dash", "dashes");
addUnit("clove", "clove", "cloves");
addUnit("can", "can", "cans");
addUnit("tin", "tin", "tins");
addUnit("package", "package", "packages", "pkg", "pkgs");
addUnit("packet", "packet", "packets");
addUnit("jar", "jar", "jars");
addUnit("bottle", "bottle", "bottles");
addUnit("bag", "bag", "bags");
addUnit("box", "box", "boxes");
addUnit("bunch", "bunch", "bunches");
addUnit("head", "head", "heads");
addUnit("sprig", "sprig", "sprigs");
addUnit("stick", "stick", "sticks");
addUnit("slice", "slice", "slices");
addUnit("piece", "piece", "pieces");
addUnit("handful", "handful", "handfuls");
addUnit("stalk", "stalk", "stalks");
addUnit("rib", "rib", "ribs");

/**
 * Words that qualify a unit rather than the ingredient: how a measure is filled ("2 heaping
 * tablespoons") or how big the container is ("1 large can", "4 medium cloves"). They are kept,
 * as a note after the name, because a heaping spoon is not a level one -- but they are only
 * lifted out when a unit follows, so "3 large eggs" and "1 large onion" keep their words in
 * place.
 */
const MEASURE_MODIFIERS = new Set([
  "heaping", "heaped", "rounded", "level", "scant", "generous", "packed",
  "small", "medium", "large", "big"
]);

/**
 * A unit that is a whole amount on its own: "Pinch of red pepper flakes" means one pinch.
 * Deliberately short -- "Cup of ..." and "Can of ..." are not written that way.
 */
const IMPLIES_ONE = new Set(["pinch", "dash", "handful", "sprig", "bunch"]);

const NUM = "(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)";
const LEADING_AMOUNT = new RegExp(`^(${NUM}(?:\\s*(?:-|to|or)\\s*${NUM})?)`, "i");
// Anchored: only a hyphen *immediately* after the number is a size ("1 1/2-inch piece"). An
// unanchored test would see the hyphen in "1 1/2 cups all-purpose flour" and throw the amount
// away.
const SIZE_ADJECTIVE = /^-[A-Za-z]/;

function normalize(raw) {
  let text = "";
  for (const char of String(raw ?? "")) {
    const fraction = VULGAR_FRACTIONS[char];
    if (fraction) text += ` ${fraction} `;
    else if (char === "⁄") text += "/";
    else if (char === " " || char === " " || char === " ") text += " ";
    else text += char;
  }
  return text
    .replace(/(?<=\d)\s*[–—−]\s*(?=\d)/g, "-")
    .replace(/^[•*▢☐□·]+\s*/, "")
    .replace(/^[-–—]\s+/, "")
    .replace(/\s+/g, " ")
    // Expanding a fraction inside "(½ to 1 lemon)" leaves "( 1/2", and sites themselves write
    // "chips , to serve". Neither space means anything.
    .replace(/\(\s+/g, "(")
    .replace(/\s+([,;)])/g, "$1")
    .trim();
}

function matchUnit(text) {
  if (!text) return null;
  const words = text.split(" ");
  if (words.length >= 2) {
    const two = `${words[0]} ${words[1]}`.toLowerCase().replace(/[.,]+$/, "");
    if (UNITS[two]) return { canonical: UNITS[two], length: words[0].length + 1 + words[1].length };
  }
  const one = words[0].toLowerCase().replace(/[.,]+$/, "");
  return UNITS[one] ? { canonical: UNITS[one], length: words[0].length } : null;
}

const before = (text, sep) => (text.includes(sep) ? text.slice(0, text.indexOf(sep)) : text);
const after = (text, sep) => (text.includes(sep) ? text.slice(text.indexOf(sep) + sep.length) : "");

/** "one" .. "twelve", and "a"/"an" -- but only when a unit follows ("a pinch of salt"). */
function wordAmount(line) {
  const first = before(line, " ").toLowerCase();
  const remainder = after(line, " ").trim();
  if (NUMBER_WORDS[first]) return [NUMBER_WORDS[first], remainder];
  if ((first === "a" || first === "an") && matchUnit(remainder)) return ["1", remainder];
  return null;
}

/**
 * Moves any leading "(14 oz)" groups out of the way, into `notes`. They describe the package
 * or an alternative measure, and belong after the name, where they stay readable and keep two
 * different can sizes from being merged into one shopping line.
 */
function takeParentheticals(text, notes) {
  let remaining = text.replace(/^\s+/, "");
  while (remaining.startsWith("(")) {
    let depth = 0;
    let close = -1;
    for (let index = 0; index < remaining.length; index++) {
      if (remaining[index] === "(") depth++;
      else if (remaining[index] === ")") {
        depth--;
        if (depth === 0) { close = index; break; }
      }
    }
    if (close < 0) break;
    notes.push(remaining.slice(0, close + 1));
    remaining = remaining.slice(close + 1).replace(/^\s+/, "");
  }
  return remaining;
}

const capitalize = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** `{quantity, unit, name}` -- the shape the rest of the app stores an ingredient in. */
function parse(raw) {
  const line = normalize(raw);
  if (!line) return { quantity: "", unit: "", name: "" };

  let quantity = "";
  let rest = line;

  const amount = LEADING_AMOUNT.exec(line);
  if (amount) {
    const remainder = line.slice(amount[0].length);
    // "1 1/2-inch piece fresh ginger": the number is the size of the thing, not how much of it
    // there is. Reading it as an amount would be a guess.
    if (!SIZE_ADJECTIVE.test(remainder)) {
      quantity = amount[1].replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
      rest = remainder.trim();
    }
  } else {
    const word = wordAmount(line);
    if (word) { [quantity, rest] = word; }
    if (!quantity) {
      const match = matchUnit(line);
      const remainder = match ? line.slice(match.length).trim() : "";
      if (match && IMPLIES_ONE.has(match.canonical) && remainder) {
        quantity = "1";
        rest = line;
      }
    }
  }

  const notes = [];
  let unit = "";
  if (quantity) {
    rest = takeParentheticals(rest, notes);
    const modifier = before(rest, " ").toLowerCase();
    if (MEASURE_MODIFIERS.has(modifier) && matchUnit(after(rest, " "))) {
      notes.push(`(${modifier})`);
      rest = after(rest, " ");
    }
    const match = matchUnit(rest);
    if (match) {
      unit = match.canonical;
      rest = rest.slice(match.length).trim();
      rest = takeParentheticals(rest, notes);
    }
  }

  let name = rest.replace(/^of\s+/i, "").replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
  // "2 cups" on its own has no ingredient to attach an amount to. Keep the whole line rather
  // than silently dropping words.
  if (!name) return { quantity: "", unit: "", name: capitalize(line) };

  if (notes.length) name = `${name} ${notes.join(" ")}`;
  return { quantity, unit, name: capitalize(name) };
}

module.exports = { parse };
