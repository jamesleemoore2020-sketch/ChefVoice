"use strict";

// Port of app/.../util/TagUtils.kt, and the same code as web/js/tag-utils.js. Keep all three
// in step. An imported recipe's tags have to fold onto the same canonical form the app uses,
// or a "#bbq" from a website would not find the "#bbq" a chef typed.

// Known spelling/format variants that should collapse onto one canonical tag. Intentionally
// small and literal -- never merges genuinely different concepts ("vegan" and "vegetarian"
// stay separate).
const TAG_ALIASES = { barbecue: "bbq", barbeque: "bbq", barbq: "bbq" };

const compactTag = raw => String(raw ?? "").trim().replace(/^#/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function canonicalTag(raw) {
  const compacted = compactTag(raw);
  return TAG_ALIASES[compacted] || compacted;
}

module.exports = { canonicalTag };
