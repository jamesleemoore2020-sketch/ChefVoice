package com.chefvoice.app.util

import java.text.Normalizer
import java.util.Locale

/**
 * Chef search, read the way the backend writes it (audit F10). Port of `searchWords` in
 * `notifications/functions/search-tokens.js`; `web/js/chef-search.js` is the PWA's. All three are
 * held to `shared/chef-search-words.tsv`.
 *
 * Each profile carries `searchTokens`, written only by the backend: every beginning (2 to 20
 * characters) of every word of the chef's name, of the whole name run together, and of their
 * favourite things. A search asks Firestore for its longest word and checks the rest here, so any
 * chef can be found, and a search costs what it returns rather than up to 300 reads.
 */
object ChefSearch {
    private const val MIN_TOKEN = 2
    private const val MAX_TOKEN = 20
    private val MARKS = Regex("\\p{M}+")
    private val CAPITAL_AFTER = Regex("([\\p{Ll}\\p{N}])(\\p{Lu})")
    private val NOT_A_WORD = Regex("[^\\p{L}\\p{N}]+")

    /**
     * Lowercase words, accents and apostrophes dropped, split where a lower-case letter or a digit
     * is followed by a capital ("DaPlug" is "da plug", "J4Mr" is "j4 mr").
     */
    fun searchWords(text: String): List<String> =
        Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "")
            .replace(CAPITAL_AFTER, "$1 $2")
            .lowercase(Locale.ROOT)
            .replace("'", "").replace("’", "")
            .split(NOT_A_WORD)
            .filter { it.isNotEmpty() }

    /** The words of a search, cut to the token length; single letters are never tokens. */
    fun queryWords(text: String): List<String> =
        searchWords(text).map { it.take(MAX_TOKEN) }.filter { it.length >= MIN_TOKEN }.distinct()

    /** The word asked of Firestore: the longest, which matches the fewest chefs. */
    fun queryKey(words: List<String>): String = words.maxByOrNull { it.length }.orEmpty()

    /** Whether a profile's tokens hold every word of the search. */
    fun matchesAll(tokens: List<String>, words: List<String>): Boolean = words.all { it in tokens }

    /** Whether the chef's own name, not only their favourite things, matches every word. */
    fun nameMatches(displayName: String, words: List<String>): Boolean {
        val name = searchWords(displayName)
        val whole = name.joinToString("")
        return words.all { word -> whole.startsWith(word) || name.any { it.startsWith(word) } }
    }

    /** Chefs whose name matches first, then those found by their favourite things; otherwise as found. */
    fun <T> byNameFirst(profiles: List<T>, words: List<String>, nameOf: (T) -> String): List<T> =
        profiles.withIndex()
            .sortedWith(compareBy<IndexedValue<T>> { if (nameMatches(nameOf(it.value), words)) 0 else 1 }.thenBy { it.index })
            .map { it.value }
}
