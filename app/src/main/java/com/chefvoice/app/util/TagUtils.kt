package com.chefvoice.app.util

import java.util.Locale

// Known spelling/format variants that should collapse onto one canonical tag.
// This is intentionally small and literal (never merges genuinely different
// concepts, e.g. "vegan" and "vegetarian" stay separate) -- add more entries
// here as real chef-entered variants show up.
private val TAG_ALIASES: Map<String, String> = mapOf(
    "barbecue" to "bbq",
    "barbeque" to "bbq",
    "barbq" to "bbq" // "Bar-B-Q" compacts to this once punctuation is stripped.
)

private fun compact(raw: String): String =
    raw.trim().removePrefix("#").lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }

/** Folds a raw chef-typed tag (any case/punctuation) onto its canonical form. */
fun canonicalTag(raw: String): String {
    val compacted = compact(raw)
    return TAG_ALIASES[compacted] ?: compacted
}

/** Splits free text like "#BBQ, camping" into deduped, canonicalized tags. */
fun parseTagsInput(raw: String, maxTags: Int = 8): List<String> =
    raw.split(',', ' ', '\n', '\t')
        .map { canonicalTag(it) }
        .filter { it.isNotBlank() && it.length <= 24 }
        .distinct()
        .take(maxTags)

/** True if a stored (already-canonical) tag should surface for a chef's search text. */
fun tagMatchesQuery(tag: String, query: String): Boolean {
    val canonicalQuery = canonicalTag(query)
    if (canonicalQuery.isBlank()) return false
    return tag == canonicalQuery || tag.contains(canonicalQuery) || canonicalQuery.contains(tag)
}
