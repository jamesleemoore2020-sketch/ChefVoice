package com.chefvoice.app.importer

import com.chefvoice.app.model.Recipe
import java.util.UUID

sealed class ImportOutcome {
    /** [notes] are things the chef should look at: gaps the page left, never guesses. */
    data class Imported(val recipe: Recipe, val notes: List<String>, val host: String) : ImportOutcome()

    /** [message] is written for the chef and can be shown as it stands. */
    data class Failed(val message: String) : ImportOutcome()
}

/**
 * Recipe import from a web address: normalize the link, fetch the page, read the recipe
 * the page itself publishes, and turn it into an ordinary private [Recipe].
 *
 * Every step is deterministic and there is no language model anywhere in it. What the
 * page does not say stays unsaid -- a missing yield is reported and left at the app's
 * default rather than estimated, and ingredient lines the parser cannot split keep their
 * words. The result is a normal recipe in every respect (editable, scalable, cookable,
 * shoppable); nothing about it is special-cased downstream.
 */
object RecipeImporter {
    private const val SUMMARY_LIMIT = 500
    private const val TITLE_LIMIT = 180
    private const val DEFAULT_SERVINGS = 2
    private const val GENERIC_FAILURE = "Something went wrong reading that page, so nothing was saved."

    fun importFrom(rawInput: String, authorName: String, fetcher: PageFetcher): ImportOutcome {
        val url = when (val checked = RecipeUrl.normalize(rawInput)) {
            is UrlResult.Rejected -> return ImportOutcome.Failed(checked.message)
            is UrlResult.Ok -> checked.url
        }
        return try {
            val page = fetcher.fetch(url)
            when (val extracted = RecipeHtmlExtractor.extract(page.html)) {
                is ExtractionResult.NotFound -> ImportOutcome.Failed(extracted.message)
                is ExtractionResult.Found -> build(extracted.recipe, page.finalUrl, authorName)
            }
        } catch (e: FetchException) {
            ImportOutcome.Failed(e.message ?: GENERIC_FAILURE)
        } catch (e: Exception) {
            ImportOutcome.Failed(GENERIC_FAILURE)
        } catch (e: StackOverflowError) {
            // A pathological page can overflow the regex engine; that is a bad page, not a crash.
            ImportOutcome.Failed(GENERIC_FAILURE)
        }
    }

    fun build(
        imported: ImportedRecipe,
        sourceUrl: String,
        authorName: String,
        now: Long = System.currentTimeMillis()
    ): ImportOutcome.Imported {
        val ingredients = imported.ingredientLines
            .map { WrittenIngredientParser.parse(it) }
            .filter { it.name.isNotBlank() }

        val notes = buildList {
            if (imported.servings == null) {
                add("The page doesn't say how many it serves, so servings is set to $DEFAULT_SERVINGS. Check it before scaling.")
            }
            if (imported.prepTimeMinutes == 0 && imported.cookTimeMinutes == 0) add("The page lists no prep or cook time.")
            if (ingredients.isEmpty()) add("The page lists no ingredients.")
            if (imported.steps.isEmpty()) add("The page lists no method steps.")
        }

        val recipe = Recipe(
            title = imported.title.ifBlank { "Imported recipe" }.take(TITLE_LIMIT),
            description = describe(imported, sourceUrl),
            servings = imported.servings ?: DEFAULT_SERVINGS,
            prepTimeMinutes = imported.prepTimeMinutes,
            cookTimeMinutes = imported.cookTimeMinutes,
            ingredients = ingredients,
            steps = imported.steps,
            stepIds = imported.steps.map { UUID.randomUUID().toString() },
            // Private, and owned by no cloud account until the chef chooses to publish.
            authorName = authorName,
            tags = imported.tags,
            createdAt = now,
            updatedAt = now
        )
        return ImportOutcome.Imported(recipe, notes, RecipeUrl.displayHost(sourceUrl))
    }

    /**
     * The page's own summary followed by where the recipe came from.
     *
     * The credit lives in the description because that field already travels everywhere a
     * recipe does, including publishing. A dedicated field would need a Firestore rules
     * change, and would still leave a published recipe looking like the chef's own.
     */
    private fun describe(imported: ImportedRecipe, sourceUrl: String): String {
        val credit = buildString {
            append("Source: ")
            if (imported.author.isNotBlank()) append(imported.author).append(" · ")
            append(sourceUrl)
        }
        val summary = shorten(imported.description, SUMMARY_LIMIT)
        return if (summary.isEmpty()) credit else "$summary\n\n$credit"
    }

    private fun shorten(text: String, limit: Int): String {
        if (text.length <= limit) return text
        val cut = text.substring(0, limit)
        return cut.substring(0, cut.lastIndexOf(' ').takeIf { it > limit / 2 } ?: limit).trimEnd(',', ';', ':', ' ') + "…"
    }
}
