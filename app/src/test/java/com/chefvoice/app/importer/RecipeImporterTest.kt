package com.chefvoice.app.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RecipeImporterTest {
    private class FakeFetcher(private val respond: (String) -> FetchedPage) : PageFetcher {
        val requested = mutableListOf<String>()
        override fun fetch(url: String): FetchedPage {
            requested += url
            return respond(url)
        }
    }

    private fun recipeJson(extra: String = "") = """
        {"@context":"https://schema.org","@type":"Recipe","name":"Best Chili",
         "author":{"@type":"Person","name":"Jane Cook"},
         "recipeYield":"6 servings","prepTime":"PT15M","cookTime":"PT1H",
         "recipeIngredient":["1 lb ground beef","2 tbsp chili powder","1 (14 oz) can tomatoes"],
         "recipeInstructions":[{"@type":"HowToStep","text":"Brown the beef."},{"@type":"HowToStep","text":"Simmer."}]$extra}
    """.trimIndent()

    private fun pageOf(json: String, url: String = "https://example.com/chili") = FetchedPage(
        url,
        "<html><head><script type=\"application/ld+json\">$json</script></head></html>"
    )

    private fun imported(outcome: ImportOutcome): ImportOutcome.Imported {
        if (outcome !is ImportOutcome.Imported) fail("expected an import but got $outcome")
        return outcome as ImportOutcome.Imported
    }

    private fun failed(outcome: ImportOutcome): String {
        if (outcome !is ImportOutcome.Failed) fail("expected a failure but got $outcome")
        return (outcome as ImportOutcome.Failed).message
    }

    @Test
    fun turnsAPageIntoAnOrdinaryPrivateRecipe() {
        val fetcher = FakeFetcher { pageOf(recipeJson()) }
        val result = imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher))
        val recipe = result.recipe

        assertEquals("Best Chili", recipe.title)
        assertEquals(6, recipe.servings)
        assertEquals(15, recipe.prepTimeMinutes)
        assertEquals(60, recipe.cookTimeMinutes)
        assertEquals(listOf("Brown the beef.", "Simmer."), recipe.steps)
        assertEquals(recipe.steps.size, recipe.stepIds.size)
        assertEquals(3, recipe.ingredients.size)
        assertEquals("Ground beef", recipe.ingredients[0].name)
        assertEquals("lb", recipe.ingredients[0].unit)
        assertEquals("Sam", recipe.authorName)
        // Private and owned by no cloud account: nothing about an import publishes it.
        assertFalse(recipe.isPublic)
        assertEquals("", recipe.authorId)
        assertEquals("example.com", result.host)
        assertTrue("a complete page needs no follow-up notes: ${result.notes}", result.notes.isEmpty())
    }

    @Test
    fun marksWhereTheRecipeCameFromSoPublishingCanWarnAboutIt() {
        val fetcher = FakeFetcher { pageOf(recipeJson(), url = "https://real.example.org/chili") }
        val recipe = imported(RecipeImporter.importFrom("https://short.link/abc", "Sam", fetcher)).recipe
        // The page it actually came from, not the link that was pasted.
        assertEquals("https://real.example.org/chili", recipe.importedFrom)
    }

    @Test
    fun creditsTheSourceInTheDescriptionSoItTravelsWithThePublishedRecipe() {
        val fetcher = FakeFetcher { pageOf(recipeJson(""","description":"A hearty weeknight chili."""")) }
        val description = imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher)).recipe.description
        assertEquals("A hearty weeknight chili.\n\nSource: Jane Cook · https://example.com/chili", description)
    }

    @Test
    fun creditsJustTheAddressWhenThePageNamesNoAuthorOrSummary() {
        val json = """{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""
        val fetcher = FakeFetcher { pageOf(json) }
        val description = imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher)).recipe.description
        assertEquals("Source: https://example.com/chili", description)
    }

    @Test
    fun creditsThePageItActuallyCameFromAfterRedirects() {
        val fetcher = FakeFetcher { pageOf(recipeJson(), url = "https://real.example.org/recipes/chili") }
        val result = imported(RecipeImporter.importFrom("https://short.link/abc", "Sam", fetcher))
        assertTrue(result.recipe.description.endsWith("https://real.example.org/recipes/chili"))
        assertEquals("real.example.org", result.host)
    }

    @Test
    fun shortensALongSummaryAtAWordBoundary() {
        val long = "word ".repeat(200).trim()
        val fetcher = FakeFetcher { pageOf(recipeJson(""","description":"$long"""")) }
        val description = imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher)).recipe.description
        val summary = description.substringBefore("\n\nSource:")
        assertTrue(summary.length <= 501)
        assertTrue(summary.endsWith("…"))
        assertFalse(summary.dropLast(1).endsWith(" "))
    }

    @Test
    fun capsAnOverlongTitleToWhatTheCommunityRulesAccept() {
        val json = """{"@type":"Recipe","name":"${"T".repeat(300)}","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""
        val fetcher = FakeFetcher { pageOf(json) }
        assertEquals(180, imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher)).recipe.title.length)
    }

    @Test
    fun namesTheGapsAPageLeavesInsteadOfFillingThemQuietly() {
        val json = """{"@type":"Recipe","name":"Bare","recipeIngredient":["1 egg"]}"""
        val fetcher = FakeFetcher { pageOf(json) }
        val result = imported(RecipeImporter.importFrom("https://example.com/chili", "Sam", fetcher))

        assertEquals(2, result.recipe.servings)
        assertEquals(0, result.recipe.prepTimeMinutes)
        val notes = result.notes.joinToString(" | ")
        assertTrue(notes, notes.contains("doesn't say how many it serves"))
        assertTrue(notes, notes.contains("no prep or cook time"))
        assertTrue(notes, notes.contains("no method steps"))
    }

    @Test
    fun aRecipeWithNoTitleAnywhereIsStillSavedUnderADefaultName() {
        val json = """{"@type":"Recipe","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""
        val fetcher = FakeFetcher { FetchedPage("https://example.com/x", "<html><script type=\"application/ld+json\">$json</script></html>") }
        assertEquals("Imported recipe", imported(RecipeImporter.importFrom("https://example.com/x", "Sam", fetcher)).recipe.title)
    }

    @Test
    fun anUnusableLinkNeverReachesTheNetwork() {
        val fetcher = FakeFetcher { fail("must not fetch"); FetchedPage("", "") }
        assertTrue(failed(RecipeImporter.importFrom("not a link", "Sam", fetcher)).contains("web address"))
        assertTrue(failed(RecipeImporter.importFrom("https://192.168.1.1/admin", "Sam", fetcher)).contains("public web page"))
        assertTrue(fetcher.requested.isEmpty())
    }

    @Test
    fun fetchesTheCleanedAddressNotTheRawPaste() {
        val fetcher = FakeFetcher { pageOf(recipeJson()) }
        RecipeImporter.importFrom("Look: http://www.example.com/chili?utm_source=x", "Sam", fetcher)
        assertEquals(listOf("https://www.example.com/chili"), fetcher.requested)
    }

    @Test
    fun passesAFetchProblemThroughInTheChefsLanguage() {
        val fetcher = FakeFetcher { throw FetchException("That page wasn't found. Check the address.") }
        assertEquals("That page wasn't found. Check the address.", failed(RecipeImporter.importFrom("https://example.com/x", "Sam", fetcher)))
    }

    @Test
    fun turnsAnUnexpectedErrorIntoAMessageRatherThanACrash() {
        val fetcher = FakeFetcher { throw IllegalStateException("boom") }
        assertTrue(failed(RecipeImporter.importFrom("https://example.com/x", "Sam", fetcher)).contains("nothing was saved"))
    }

    @Test
    fun reportsAPageWithNoStructuredRecipe() {
        val fetcher = FakeFetcher { FetchedPage("https://example.com/blog", "<html><body>1 cup flour, mix well.</body></html>") }
        assertTrue(failed(RecipeImporter.importFrom("https://example.com/blog", "Sam", fetcher)).contains("doesn't publish its recipe"))
    }
}
