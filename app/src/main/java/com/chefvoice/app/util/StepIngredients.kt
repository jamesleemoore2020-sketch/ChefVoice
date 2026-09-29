package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import java.text.Normalizer
import java.util.Locale

/**
 * Which of a recipe's ingredients one method step names, so the cook-along can put the
 * amount beside the step that uses it (audit F21).
 *
 * A read-only view, like [StepTimers]: it never edits a step or an ingredient, never
 * contributes to what is saved, and it is not the parser. `web/js/step-ingredients.js` is
 * its port, and both are held to `shared/step-ingredients.tsv`, row for row.
 *
 * It is literal on purpose. A step names an ingredient when it says the whole name ("the
 * olive oil") or the end of it ("the oil" for olive oil, "the onion" for diced onion), and
 * an end counts only while it belongs to one ingredient: "heat the oil" in a recipe with
 * olive oil and sesame oil shows neither, rather than a guess. Words that usually mean
 * something the chef made rather than bought ("the sauce", "the mixture", "the pan juices"),
 * or a verb ("cream the butter"), never count on their own. A missed ingredient costs the
 * chef a glance at the full list, which the screen keeps one tap away; a wrong one, shown
 * with its amount beside the step, is one they might add.
 */
object StepIngredients {
    /**
     * Words a name can end in that describe it rather than name it: "parsley for garnish",
     * "salt to taste". A name is matched by what is left once they are gone, as well as in full.
     */
    private val TRAILING = setOf(
        "a", "an", "the", "of", "and", "or", "to", "for", "with", "as", "if", "plus", "taste", "needed",
        "optional", "divided", "extra", "more", "fresh", "freshly", "finely", "roughly", "thinly", "large",
        "small", "medium", "whole", "warm", "cold", "softened", "melted", "chopped", "diced", "minced",
        "sliced", "grated", "shredded", "crushed", "peeled", "cubed", "beaten", "cooked", "drained",
        "rinsed", "toasted", "halved", "quartered", "trimmed", "sifted", "pitted", "seeded", "cored",
        "crumbled", "mashed", "packed", "room", "temperature", "serving", "garnish"
    )

    /**
     * The last word of a name that never counts alone. Each usually means something the chef
     * made or a shape they cut, not the thing they bought.
     */
    private val WEAK = setOf(
        "sauce", "mixture", "mix", "batter", "dressing", "filling", "glaze", "marinade", "seasoning",
        "cream", "topping", "liquid", "juice", "piece", "slice", "cube", "strip", "chunk", "wedge",
        "round", "bit"
    )

    /** The part of a thing a name ends in: "garlic cloves" is the garlic, "lime wedges" the lime. */
    private val FORMS = setOf(
        "clove", "breast", "thigh", "drumstick", "wing", "fillet", "filet", "leaf", "sprig", "stalk",
        "rib", "stick", "floret", "spear", "strand", "pod", "head", "bulb", "piece", "slice", "cube",
        "strip", "chunk", "wedge", "round"
    )

    private val IRREGULAR = mapOf("leaves" to "leaf", "loaves" to "loaf", "halves" to "half")
    private val MARKS = Regex("\\p{M}+")
    private val WORD = Regex("[\\p{L}\\p{N}]+")
    private val BRACKETED = Regex("\\([^)]*\\)")
    private val DESCRIPTION_START = Regex("[,(]")

    /**
     * "onions" -> "onion", "tomatoes" -> "tomato", "cherries" -> "cherry". Only ever compared
     * with another word made singular the same way.
     */
    fun singular(word: String): String {
        IRREGULAR[word]?.let { return it }
        if (word.length <= 3) return word
        if (word.length > 4 && word.endsWith("ies")) return word.dropLast(3) + "y"
        if (listOf("oes", "ches", "shes", "xes", "sses", "zzes").any { word.endsWith(it) }) return word.dropLast(2)
        if (word.endsWith("s") && listOf("ss", "us", "is").none { word.endsWith(it) }) return word.dropLast(1)
        return word
    }

    /** Lowercase words with accents, apostrophes and punctuation dropped, each made singular. */
    fun words(text: String): List<String> {
        val plain = Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "")
            .lowercase(Locale.ROOT).replace("'", "").replace("’", "")
        return WORD.findAll(plain).map { singular(it.value) }.toList()
    }

    private class Phrase(val words: List<String>, var whole: Boolean)

    /** The phrases that name one ingredient, and the key two ingredients share when they are the same thing. */
    private class Named(val key: String, val phrases: Collection<Phrase>)

    private fun describe(name: String): Named? {
        // What follows a comma or sits in brackets describes the ingredient -- "butter,
        // softened", "onion (diced)" -- and is not how a step refers to it.
        val core = name.replace(BRACKETED, " ").split(DESCRIPTION_START)[0]
        val full = words(core)
        var end = full.size
        while (end > 0 && full[end - 1] in TRAILING) end--
        val head = if (end > 0) full.subList(0, end) else full
        if (head.isEmpty()) return null
        val phrases = LinkedHashMap<String, Phrase>()
        fun add(phrase: List<String>, whole: Boolean) {
            val known = phrases[phrase.joinToString(" ")]
            if (known != null) known.whole = known.whole || whole
            else phrases[phrase.joinToString(" ")] = Phrase(phrase, whole)
        }
        add(full, true)
        add(head, true)
        for (start in 1 until head.size) {
            val tail = head.subList(start, head.size)
            if (tail.size == 1 && tail[0] in WEAK) continue
            add(tail, false)
        }
        if (head.size > 1 && head.last() in FORMS) {
            val body = head.subList(0, head.size - 1)
            if (!(body.size == 1 && (body[0] in WEAK || body[0] in TRAILING))) add(body, false)
        }
        return Named(head.joinToString(" "), phrases.values)
    }

    private class Entry(val index: Int, val whole: Boolean, val key: String)
    private class Span(val start: Int, val length: Int) {
        val entries = mutableListOf<Entry>()
    }

    /**
     * Indices into [ingredients] of the ones [step] names, in the order the step names them,
     * each once. The longest phrase is read first, so "kosher salt" is the kosher salt and not
     * also the salt, and a whole name beats the end of another one. Indices rather than
     * ingredients, so a scaled or converted copy of the same list lines up with them.
     */
    fun indicesIn(step: String, ingredients: List<Ingredient>): List<Int> {
        val tokens = words(step)
        if (tokens.isEmpty()) return emptyList()
        val spans = LinkedHashMap<Pair<Int, Int>, Span>()
        ingredients.forEachIndexed { index, ingredient ->
            val named = describe(ingredient.name) ?: return@forEachIndexed
            for (phrase in named.phrases) {
                val n = phrase.words.size
                for (start in 0..tokens.size - n) {
                    if ((0 until n).any { tokens[start + it] != phrase.words[it] }) continue
                    spans.getOrPut(start to n) { Span(start, n) }.entries += Entry(index, phrase.whole, named.key)
                }
            }
        }
        val claimed = BooleanArray(tokens.size)
        val found = mutableListOf<Pair<Int, Int>>()
        for (span in spans.values.sortedWith(compareByDescending<Span> { it.length }.thenBy { it.start })) {
            val range = span.start until span.start + span.length
            if (range.any { claimed[it] }) continue
            range.forEach { claimed[it] = true }
            val best = if (span.entries.any { it.whole }) span.entries.filter { it.whole } else span.entries
            // Two different ingredients that end the same way: the step does not say which.
            if (best.map { it.key }.toSet().size != 1) continue
            best.forEach { found += span.start to it.index }
        }
        return found.sortedWith(compareBy<Pair<Int, Int>> { it.first }.thenBy { it.second }).map { it.second }.distinct()
    }
}
