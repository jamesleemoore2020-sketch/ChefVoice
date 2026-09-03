package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient

/**
 * Conservative ingredient pairing for Second Pass review.
 *
 * Identity is resolved before measurement comparison. Both sides are
 * canonicalized here so review generation never depends on whether an
 * earlier parser stage cleaned an ingredient correctly.
 */
object IngredientReviewClassifier {

    data class Match(
        val liveIndex: Int,
        val score: Double
    )

    data class Result(
        val secondMatches: Map<Int, Match>
    )

    fun classify(
        liveIngredients: List<Ingredient>,
        secondIngredients: List<Ingredient>
    ): Result {
        val matches = mutableMapOf<Int, Match>()
        val usedLive = mutableSetOf<Int>()
        val live = RecipeCanonicalizer.canonicalizeIngredients(liveIngredients)
        val second = RecipeCanonicalizer.canonicalizeIngredients(secondIngredients)

        second.forEachIndexed { secondIndex, candidate ->
            var best: Match? = null

            live.forEachIndexed { liveIndex, item ->
                if (liveIndex in usedLive) return@forEachIndexed
                val score = identityScore(item, candidate)
                val current = best
                if (score >= 0.66 && (current == null || score > current.score)) {
                    best = Match(liveIndex, score)
                }
            }

            best?.let {
                usedLive += it.liveIndex
                matches[secondIndex] = it
            }
        }

        return Result(matches)
    }

    private fun identityScore(
        live: Ingredient,
        second: Ingredient
    ): Double {
        val liveWords = words(live.name)
        val secondWords = words(second.name)

        if (liveWords.isEmpty() || secondWords.isEmpty()) return 0.0
        if (liveWords == secondWords) return 1.0

        // Tolerate ASR truncation: ground bee -> ground beef.
        if (liveWords.size == secondWords.size && liveWords.zip(secondWords).all {
                prefixClose(it.first, it.second)
            }) {
            return 0.88
        }

        val overlap = liveWords.count { it in secondWords }
        val union = (liveWords + secondWords).toSet().size
        val jaccard = overlap.toDouble() / union.coerceAtLeast(1)

        // Preserve distinctions such as pepper vs lemon pepper.
        if (liveWords.contains("pepper") && secondWords.contains("pepper") && liveWords != secondWords) {
            return jaccard
        }

        if (liveWords.containsAll(secondWords) || secondWords.containsAll(liveWords)) {
            return 0.92
        }

        return jaccard
    }

    private fun prefixClose(a: String, b: String): Boolean {
        if (a == b) return true
        val min = minOf(a.length, b.length)
        return min >= 3 && a.take(min) == b.take(min)
    }

    // Comparison-only. Live ASR routinely leaves a conversational tail on an
    // ingredient name ("Pepper You gonna"). Those words are not part of the
    // ingredient's identity, and leaving them in defeated the distinction rules
    // below: "Pepper You gonna" scored 0.33 against "Pepper" and never paired, so
    // the review offered a bogus "possible missed ingredient" plus a "live-only"
    // card instead of the name cleanup the chef needed. Saved recipe text is never
    // changed here.
    private val conversationalTail = Regex(
        "(?i)\\s+(?:(?:i|you|we)(?:'m|'re| am| are)?\\s+)?(?:gonna|going\\s+to)\\s*$"
    )

    private val trailingFiller = Regex("(?i)\\s+(?:like|wait|actually|sorry|no|too|also|there)\\s*$")

    private fun words(value: String): Set<String> {
        var text = value.trim().replace(Regex("\\s+"), " ")
        text = conversationalTail.replace(text, "").trim()
        text = trailingFiller.replace(text, "").trim()
        return text.lowercase()
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .toSet()
    }
}
