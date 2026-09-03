package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient

/** Cleans parsed cooking speech before Second Pass comparison. */
object IngredientNormalizer {
    private val tails = Regex("(?i)\\s+(?:you(?:\\'re| are)?\\s+gonna\\s+need|you\\'ll\\s+need|you\\s+need|we\\'re\\s+gonna\\s+use|let\\'s\\s+add|in\\s+there|right\\s+there|there|too|also|as\\s+well)\\s*$")
    private val noise = setOf("the", "just", "hey", "there", "lets", "let\'s", "and", "oh", "uh")

    private val asrTrailingFillers = Regex(
        "(?i)\\s+(?:oh|uh|hey|just|the|and)\\s*$"
    )

    private val prepOnly = Regex(
        "(?i)^(?:\\d+\\s+)?(?:patties|pieces|portions|servings)$"
    )

    fun normalize(item: Ingredient): Ingredient {
        val cleaned = item.name.trim()
            .replace(tails, "")
            .replace(asrTrailingFillers, "")
            .replace(Regex("(?i)^just\\s+(?:a\\s+)?pinch\\s+of\\s+"), "")
            .replace(Regex("(?i)^a\\s+pinch\\s+of\\s+"), "")
            .trim()
        return item.copy(name = cleaned)
    }

    fun isUseful(item: Ingredient): Boolean {
        val name = normalize(item).name.lowercase()
        return name.isNotBlank() && name !in noise && !prepOnly.matches(name)
    }

    fun merge(items: List<Ingredient>): List<Ingredient> {
        return items.map { normalize(it) }.filter { isUseful(it) }.distinctBy {
            listOf(it.quantity.trim(), it.unit.trim(), it.name.lowercase()).joinToString("|")
        }
    }
}
