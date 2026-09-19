"use strict";

// Port of app/.../importer/HtmlText.kt. Keep the two in step.
//
// Turns the markup-flavoured strings a recipe page embeds in its data -- "Fold in the
// egg&#39;s yolk<br>then chill" -- into plain text. Recipe plugins routinely leave HTML
// entities and stray tags inside their structured data, so nearly every text field goes
// through here before it reaches a recipe.

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  deg: "°", times: "×", middot: "·", bull: "•",
  frac12: "½", frac14: "¼", frac34: "¾",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ntilde: "ñ", uuml: "ü",
  ouml: "ö", auml: "ä", iacute: "í", oacute: "ó",
  aacute: "á", uacute: "ú", reg: "®", trade: "™"
};

const ENTITY = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** Line-ending tags become newlines so "step one<br>step two" stays two lines. */
const LINE_BREAK_TAG = /<br\s*\/?>|<\/(?:p|li|div|h[1-6]|tr)\s*>/gi;

/**
 * Only `<` followed by a letter, `/` or `!` opens a tag. A bare "<" in "bake < 20 minutes" is
 * text, and treating it as a tag would swallow everything up to the next ">" on the page.
 */
const ANY_TAG = /<(?:!--[\s\S]*?--|\/?[A-Za-z][^>]*)>/g;

function codePoint(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff) return null;
  if (value >= 0xd800 && value <= 0xdfff) return null;
  try {
    return String.fromCodePoint(value);
  } catch {
    return null;
  }
}

function decodeEntities(input) {
  let text = String(input ?? "");
  // Twice, because some sites encode an already-encoded string ("&amp;#39;").
  for (let pass = 0; pass < 2; pass++) {
    if (!text.includes("&")) return text;
    text = text.replace(ENTITY, (whole, body) => {
      let decoded;
      if (body.startsWith("#x") || body.startsWith("#X")) decoded = codePoint(parseInt(body.slice(2), 16));
      else if (body.startsWith("#")) decoded = codePoint(parseInt(body.slice(1), 10));
      else decoded = NAMED_ENTITIES[body];
      return decoded ?? whole;
    });
  }
  return text;
}

/** Trimmed, non-empty lines of plain text. Markup is stripped and entities decoded. */
function lines(input) {
  const withBreaks = String(input ?? "").replace(LINE_BREAK_TAG, "\n");
  const noTags = withBreaks.replace(ANY_TAG, "");
  return decodeEntities(noTags)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

/** `lines` flattened into a single line. */
const line = input => lines(input).join(" ");

module.exports = { decodeEntities, lines, line };
