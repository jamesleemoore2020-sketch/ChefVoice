package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient

/**
 * Canonical recipe cleanup before UI/review comparison.
 *
 * This only normalizes parsed speech artifacts. It never rewrites the
 * user's saved recipe text.
 */
object RecipeCanonicalizer {
    private val speechTails = Regex(
        "(?i)\\s+(?:" +
            "you(?:'re| are)?\\s+gonna\\s+need|" +
            "you(?:'ll| will)?\\s+need|" +
            "we(?:'re| are)?\\s+gonna\\s+use|" +
            "let'?s\\s+add|" +
            "we'?re\\s+gonna\\s+use|" +
            "in\\s+there|right\\s+there|" +
            "just|hey|okay|ok|there" +
            ")\\s*$"
    )

    private val invalidStandalone = setOf(
        "the", "a", "an", "there", "hey", "just", "okay", "ok",
        "lets", "let's", "um", "uh"
    )

    private val measurementNoise = Regex(
        "(?i)^\\s*(?:\\d+(?:\\.\\d+)?\\s*)?(?:degrees?|minutes?|mins?|seconds?|secs?)\\s*$"
    )

    fun canonicalizeIngredients(items: List<Ingredient>): List<Ingredient> {
        return items
            .map(::clean)
            .filter(::isUseful)
            .groupBy { canonicalName(it.name) }
            .map { (_, group) -> mergeQuantityVariant(group) }
            .distinctBy(::key)
    }

    private fun clean(item: Ingredient): Ingredient {
        val name = item.name
            .trim()
            .replace(speechTails, "")
            .replace(Regex("(?i)\\b(?:oh|uh|hey|just|the|and)$"), "")
            .replace(Regex("(?i)^a\\s+pinch\\s+of\\s+"), "")
            .trim()

        return item.copy(name = name)
    }

    private fun canonicalName(value: String): String {
        return value.lowercase()
            .replace(Regex("(?i)\\ba\\s+pinch\\s+of\\s+"), "")
            .replace(Regex("(?i)\\bjust\\s+"), "")
            .trim()
    }

    private fun mergeQuantityVariant(items: List<Ingredient>): Ingredient {
        // Keep the latest parsed quantity while preserving the canonical ingredient identity.
        return items.last()
    }

    private fun isUseful(item: Ingredient): Boolean {
        val name = item.name.lowercase().trim()
        if (name.isBlank()) return false
        if (name in invalidStandalone) return false
        if (measurementNoise.matches(name)) return false
        return true
    }

    private fun key(item: Ingredient): String {
        return listOf(
            item.quantity.trim(),
            item.unit.trim().lowercase(),
            item.name.lowercase().trim()
        ).joinToString("|")
    }
}
