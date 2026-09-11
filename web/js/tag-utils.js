// Recipe #tags: freeform, chef-typed, folded onto a small canonical form so
// "BBQ", "barbecue" and "Bar-B-Q" all discover the same recipes. Mirrors
// app/src/main/java/com/chefvoice/app/util/TagUtils.kt -- keep both in sync.

// Known spelling/format variants that should collapse onto one canonical tag.
// Intentionally small and literal -- never merges genuinely different concepts
// (e.g. "vegan" and "vegetarian" stay separate). Add more entries here as real
// chef-entered variants show up.
const TAG_ALIASES = { barbecue: 'bbq', barbeque: 'bbq', barbq: 'bbq' };

function compactTag(raw) {
  return String(raw || '').trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function canonicalTag(raw) {
  const compacted = compactTag(raw);
  return TAG_ALIASES[compacted] || compacted;
}

export function parseTagsInput(raw, maxTags = 8) {
  const seen = new Set();
  const out = [];
  for (const piece of String(raw || '').split(/[,\s]+/)) {
    const tag = canonicalTag(piece);
    if (!tag || tag.length > 24 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= maxTags) break;
  }
  return out;
}

export function tagMatchesQuery(tag, query) {
  const q = canonicalTag(query);
  if (!q) return false;
  return tag === q || tag.includes(q) || q.includes(tag);
}
