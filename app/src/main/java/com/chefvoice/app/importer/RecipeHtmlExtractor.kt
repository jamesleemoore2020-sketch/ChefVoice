package com.chefvoice.app.importer

import com.chefvoice.app.util.canonicalTag
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import kotlin.math.ceil

/** What a page's own structured data says about a recipe, before it becomes a [com.chefvoice.app.model.Recipe]. */
data class ImportedRecipe(
    val title: String,
    val description: String,
    /** Null when the page gives no usable yield. The caller decides how to say so. */
    val servings: Int?,
    val prepTimeMinutes: Int,
    val cookTimeMinutes: Int,
    /** Ingredient lines exactly as the page prints them, in page order. */
    val ingredientLines: List<String>,
    val steps: List<String>,
    val tags: List<String>,
    val author: String
)

sealed class ExtractionResult {
    data class Found(val recipe: ImportedRecipe) : ExtractionResult()
    data class NotFound(val message: String) : ExtractionResult()
}

/**
 * Reads a recipe out of a web page's schema.org `Recipe` data (JSON-LD), which is what
 * essentially every mainstream recipe site publishes for search engines.
 *
 * **Deterministic and read-only**, by the same rule as the voice parser: it reports what
 * the page says, and where the page says nothing it says nothing. It does not scrape
 * visible text, guess a missing quantity, split a paragraph into steps, or rewrite
 * anything. A page without structured recipe data is reported as such -- "not found" is
 * an honest answer, a half-guessed recipe is not.
 *
 * Kept entirely apart from `voice.CookingSessionParser`: nothing here can change how a
 * narrated recipe is parsed, and no golden-corpus row can be affected by it.
 */
object RecipeHtmlExtractor {
    private const val MAX_LIST = 300
    private const val MAX_MINUTES = 100_000
    private const val MAX_TAGS = 5
    private const val MAX_DEPTH = 8

    private val jsonLdScript = Regex(
        """<script\b[^>]*\btype\s*=\s*["']?application/ld\+json["']?[^>]*>(.*?)</script\s*>""",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
    )
    private val titleTag = Regex("<title[^>]*>(.*?)</title\\s*>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

    private const val NOT_PUBLISHED =
        "That page doesn't publish its recipe in a form ChefVoice can read, so nothing was saved. " +
            "Try the recipe's own page rather than a search or category page."
    private const val NO_CONTENT =
        "That page mentions a recipe but doesn't list its ingredients or method, so nothing was saved."

    fun extract(html: String): ExtractionResult {
        val recipes = mutableListOf<JSONObject>()
        jsonLdScript.findAll(html).forEach { match ->
            val parsed = parseJson(match.groupValues[1]) ?: return@forEach
            collectRecipes(parsed, recipes, 0)
        }
        if (recipes.isEmpty()) return ExtractionResult.NotFound(NOT_PUBLISHED)

        // A page can carry several: a roundup lists stubs with no ingredients. Prefer the
        // one that is actually a whole recipe.
        val best = recipes.maxByOrNull { completeness(it) }!!
        val imported = toImported(best, html)
        if (imported.ingredientLines.isEmpty() && imported.steps.isEmpty()) {
            return ExtractionResult.NotFound(NO_CONTENT)
        }
        return ExtractionResult.Found(imported)
    }

    // -- locating the data ----------------------------------------------------------

    private fun parseJson(raw: String): Any? {
        val trimmed = raw.trim()
        val start = trimmed.indexOfFirst { it == '{' || it == '[' }
        val end = trimmed.indexOfLast { it == '}' || it == ']' }
        if (start < 0 || end <= start) return null
        return runCatching { JSONTokener(escapeControlCharsInStrings(trimmed.substring(start, end + 1))).nextValue() }
            .getOrNull()
    }

    /**
     * Real pages put raw newlines and tabs inside JSON strings, which is invalid JSON.
     * Some JSON readers tolerate it and some do not, so the tolerance is provided here
     * rather than left to whichever reader happens to be running.
     */
    private fun escapeControlCharsInStrings(json: String): String {
        val out = StringBuilder(json.length + 16)
        var inString = false
        var escaped = false
        for (char in json) {
            if (inString) {
                when {
                    escaped -> { escaped = false; out.append(char) }
                    char == '\\' -> { escaped = true; out.append(char) }
                    char == '"' -> { inString = false; out.append(char) }
                    char == '\n' -> out.append("\\n")
                    char == '\r' -> out.append("\\r")
                    char == '\t' -> out.append("\\t")
                    char < ' ' -> out.append("\\u%04x".format(char.code))
                    else -> out.append(char)
                }
            } else {
                if (char == '"') inString = true
                out.append(char)
            }
        }
        return out.toString()
    }

    private fun collectRecipes(node: Any?, out: MutableList<JSONObject>, depth: Int) {
        if (depth > MAX_DEPTH) return
        when (node) {
            is JSONArray -> for (i in 0 until node.length()) collectRecipes(node.opt(i), out, depth + 1)
            is JSONObject -> {
                if (isRecipeType(node.opt("@type"))) {
                    out += node
                    return
                }
                val keys = node.keys()
                while (keys.hasNext()) {
                    val value = node.opt(keys.next())
                    if (value is JSONObject || value is JSONArray) collectRecipes(value, out, depth + 1)
                }
            }
        }
    }

    private fun isRecipeType(type: Any?): Boolean = when (type) {
        is String -> type.substringAfterLast('/').substringAfterLast(':').equals("Recipe", ignoreCase = true)
        is JSONArray -> (0 until type.length()).any { isRecipeType(type.opt(it)) }
        else -> false
    }

    private fun completeness(recipe: JSONObject): Int {
        val hasIngredients = ingredientLines(recipe).isNotEmpty()
        val hasSteps = instructionSteps(recipe.opt("recipeInstructions")).isNotEmpty()
        return (if (hasIngredients) 2 else 0) + (if (hasSteps) 1 else 0)
    }

    // -- mapping fields -------------------------------------------------------------

    private fun toImported(recipe: JSONObject, html: String): ImportedRecipe {
        val title = textOf(recipe.opt("name")).ifBlank { textOf(recipe.opt("headline")) }
            .ifBlank { titleTag.find(html)?.groupValues?.get(1)?.let { HtmlText.line(it) }.orEmpty() }
        val prep = minutesOf(recipe.opt("prepTime"))
        val cook = minutesOf(recipe.opt("cookTime"))
        val total = minutesOf(recipe.opt("totalTime"))
        val author = authorOf(recipe.opt("author"))
        return ImportedRecipe(
            title = title,
            description = textOf(recipe.opt("description")),
            servings = servingsOf(recipe.opt("recipeYield")),
            prepTimeMinutes = prep,
            // A page that only states a total has told us how long it takes, not how the
            // time splits. The total goes in the cook slot rather than being dropped.
            cookTimeMinutes = if (prep == 0 && cook == 0) total else cook,
            ingredientLines = ingredientLines(recipe),
            steps = instructionSteps(recipe.opt("recipeInstructions")),
            tags = tagsOf(recipe, author),
            author = author
        )
    }

    /** Text of a scalar, or of the most useful field of an object / first item of a list. */
    private fun textOf(value: Any?): String = when (value) {
        null, JSONObject.NULL -> ""
        is String -> HtmlText.line(value)
        is Number, is Boolean -> value.toString()
        is JSONObject -> textOf(value.opt("text")).ifBlank { textOf(value.opt("name")) }
        is JSONArray -> (0 until value.length()).map { textOf(value.opt(it)) }.firstOrNull { it.isNotBlank() }.orEmpty()
        else -> ""
    }

    private fun ingredientLines(recipe: JSONObject): List<String> {
        val source = recipe.opt("recipeIngredient") ?: recipe.opt("ingredients") ?: recipe.opt("recipeIngredients")
        val lines = when (source) {
            is String -> HtmlText.lines(source)
            is JSONArray -> (0 until source.length()).flatMap { index ->
                val item = source.opt(index)
                if (item is String) HtmlText.lines(item) else listOf(textOf(item))
            }
            else -> emptyList()
        }
        return lines.filter { it.isNotBlank() }.take(MAX_LIST)
    }

    /**
     * Method steps in page order. Handles the four shapes sites actually use: one string
     * with a step per line, a list of strings, a list of `HowToStep` objects, and
     * `HowToSection` groups (whose heading is kept on the group's first step, since "for
     * the frosting" says which component a step belongs to).
     */
    private fun instructionSteps(value: Any?): List<String> {
        val out = mutableListOf<String>()
        collectSteps(value, out, sectionName = "", depth = 0)
        return out.take(MAX_LIST)
    }

    private fun collectSteps(value: Any?, out: MutableList<String>, sectionName: String, depth: Int) {
        if (depth > MAX_DEPTH || out.size >= MAX_LIST) return
        var heading = sectionName
        fun add(text: String) {
            if (text.isBlank()) return
            out += if (heading.isNotBlank()) "${heading.trimEnd(':')}: $text" else text
            heading = ""
        }
        when (value) {
            is String -> HtmlText.lines(value).forEach { add(stripStepNumber(it)) }
            is JSONArray -> {
                for (i in 0 until value.length()) {
                    val before = out.size
                    collectSteps(value.opt(i), out, heading, depth + 1)
                    if (out.size > before) heading = ""
                }
            }
            is JSONObject -> {
                val items = value.opt("itemListElement")
                if (items != null) {
                    collectSteps(items, out, textOf(value.opt("name")).ifBlank { heading }, depth + 1)
                } else {
                    val text = HtmlText.lines(textOf(value.opt("text")).ifBlank { textOf(value.opt("name")) })
                    text.forEach { add(stripStepNumber(it)) }
                }
            }
        }
    }

    /** "1. Mix" / "Step 2: Bake" -> "Mix" / "Bake". The app numbers steps itself. */
    private fun stripStepNumber(line: String): String =
        line.replace(Regex("^(?:step\\s*)?\\d{1,2}\\s*[.):-]\\s+", RegexOption.IGNORE_CASE), "").trim()

    private fun servingsOf(value: Any?): Int? {
        val candidates = when (value) {
            is JSONArray -> (0 until value.length()).map { textOf(value.opt(it)) }
            else -> listOf(textOf(value))
        }
        for (candidate in candidates) {
            val number = Regex("\\d{1,4}").find(candidate)?.value?.toIntOrNull() ?: continue
            if (number in 1..1000) return number
        }
        return null
    }

    private val isoDuration = Regex(
        """^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$""",
        RegexOption.IGNORE_CASE
    )

    /** ISO 8601 ("PT1H30M") first, then the plain "45 minutes" some sites write instead. */
    internal fun minutesOf(value: Any?): Int {
        val text = when (value) {
            null, JSONObject.NULL -> return 0
            is Number -> return value.toDouble().coerceIn(0.0, MAX_MINUTES.toDouble()).toInt()
            else -> textOf(value).trim()
        }
        if (text.isEmpty()) return 0

        isoDuration.matchEntire(text)?.let { match ->
            fun part(index: Int) = match.groupValues[index].toDoubleOrNull() ?: 0.0
            val minutes = part(1) * 10080 + part(2) * 1440 + part(3) * 60 + part(4) + part(5) / 60.0
            return ceil(minutes).toInt().coerceIn(0, MAX_MINUTES)
        }

        val lower = text.lowercase()
        lower.toIntOrNull()?.let { return it.coerceIn(0, MAX_MINUTES) }
        val hours = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hour|hours)\\b").find(lower)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        val mins = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:m|min|mins|minute|minutes)\\b").find(lower)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        return ceil(hours * 60 + mins).toInt().coerceIn(0, MAX_MINUTES)
    }

    private fun tagsOf(recipe: JSONObject, author: String): List<String> {
        val words = mutableListOf<String>()
        listOf("recipeCategory", "recipeCuisine", "keywords").forEach { key ->
            when (val value = recipe.opt(key)) {
                is JSONArray -> for (i in 0 until value.length()) words += splitList(textOf(value.opt(i)))
                else -> words += splitList(textOf(value))
            }
        }
        // Sites often list the author among the keywords; that is a credit, not a tag.
        val authorTag = canonicalTag(author)
        return words.map { canonicalTag(it) }
            .filter { it.isNotBlank() && it.length <= 24 && it != authorTag }
            .distinct()
            .take(MAX_TAGS)
    }

    private fun splitList(text: String): List<String> = text.split(',', ';', '|').map { it.trim() }.filter { it.isNotEmpty() }

    private fun authorOf(value: Any?): String = when (value) {
        is String -> HtmlText.line(value)
        is JSONObject -> textOf(value.opt("name"))
        is JSONArray -> (0 until value.length()).map { authorOf(value.opt(it)) }.firstOrNull { it.isNotBlank() }.orEmpty()
        else -> ""
    }
}
