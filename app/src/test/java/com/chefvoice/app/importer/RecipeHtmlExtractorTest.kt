package com.chefvoice.app.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The extractor reports what a page's structured data says and nothing else, so most of
 * these are about the shapes real sites publish -- and about what is *not* invented when
 * the page leaves something out.
 */
class RecipeHtmlExtractorTest {
    private fun page(vararg jsonLdBlocks: String, head: String = "<title>Some Site</title>"): String =
        "<html><head>$head" +
            jsonLdBlocks.joinToString("") { "<script type=\"application/ld+json\">$it</script>" } +
            "</head><body><p>Visible text that is never used.</p></body></html>"

    private fun found(html: String): ImportedRecipe {
        val result = RecipeHtmlExtractor.extract(html)
        if (result !is ExtractionResult.Found) fail("expected a recipe but got $result")
        return (result as ExtractionResult.Found).recipe
    }

    private fun notFound(html: String): String {
        val result = RecipeHtmlExtractor.extract(html)
        if (result !is ExtractionResult.NotFound) fail("expected NotFound but got $result")
        return (result as ExtractionResult.NotFound).message
    }

    private val fullRecipe = """
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Best Chili",
          "description": "A hearty <b>weeknight</b> chili.",
          "author": {"@type": "Person", "name": "Jane Cook"},
          "recipeYield": ["6", "6 servings"],
          "prepTime": "PT15M",
          "cookTime": "PT1H30M",
          "totalTime": "PT1H45M",
          "recipeCategory": "Dinner",
          "recipeCuisine": "American",
          "keywords": "chili, beef, Weeknight Dinner",
          "recipeIngredient": ["1 lb ground beef", "2 tbsp chili powder", "1 (14 oz) can tomatoes"],
          "recipeInstructions": [
            {"@type": "HowToStep", "text": "Brown the beef."},
            {"@type": "HowToStep", "text": "Add everything else &amp; simmer."}
          ]
        }
    """.trimIndent()

    @Test
    fun readsEveryFieldOfAWholeRecipe() {
        val recipe = found(page(fullRecipe))
        assertEquals("Best Chili", recipe.title)
        assertEquals("A hearty weeknight chili.", recipe.description)
        assertEquals("Jane Cook", recipe.author)
        assertEquals(6, recipe.servings)
        assertEquals(15, recipe.prepTimeMinutes)
        assertEquals(90, recipe.cookTimeMinutes)
        assertEquals(listOf("1 lb ground beef", "2 tbsp chili powder", "1 (14 oz) can tomatoes"), recipe.ingredientLines)
        assertEquals(listOf("Brown the beef.", "Add everything else & simmer."), recipe.steps)
        assertEquals(listOf("dinner", "american", "chili", "beef", "weeknightdinner"), recipe.tags)
    }

    @Test
    fun findsTheRecipeInsideAGraph() {
        val recipe = found(page("""
            {"@context":"https://schema.org","@graph":[
              {"@type":"WebSite","name":"A Site"},
              {"@type":["Recipe"],"name":"Pancakes","recipeIngredient":["2 cups flour"],"recipeInstructions":"Mix.\nCook."}
            ]}
        """.trimIndent()))
        assertEquals("Pancakes", recipe.title)
        assertEquals(listOf("Mix.", "Cook."), recipe.steps)
    }

    @Test
    fun acceptsARecipeThatIsAlsoAnotherType() {
        val recipe = found(page("""{"@type":["Recipe","NewsArticle"],"name":"Soup","recipeIngredient":["1 cup water"],"recipeInstructions":["Boil."]}"""))
        assertEquals("Soup", recipe.title)
    }

    @Test
    fun findsARecipeNestedUnderAWebPage() {
        val recipe = found(page("""{"@type":"WebPage","mainEntity":{"@type":"Recipe","name":"Toast","recipeIngredient":["1 slice bread"],"recipeInstructions":["Toast it."]}}"""))
        assertEquals("Toast", recipe.title)
    }

    @Test
    fun skipsOtherStructuredDataBlocksAndBrokenOnes() {
        val recipe = found(page(
            """{"@type":"Organization","name":"Acme"}""",
            """{ this is not json""",
            fullRecipe
        ))
        assertEquals("Best Chili", recipe.title)
    }

    @Test
    fun toleratesAttributeOrderQuotesAndCase() {
        val block = """{"@type":"Recipe","name":"Soup","recipeIngredient":["1 cup water"],"recipeInstructions":["Boil."]}"""
        val html = "<SCRIPT class=\"graph\" TYPE='application/ld+json'>$block</SCRIPT>"
        assertEquals("Soup", found(html).title)
    }

    @Test
    fun toleratesRawNewlinesInsideJsonStrings() {
        // Invalid JSON, but real pages emit it constantly.
        val block = "{\"@type\":\"Recipe\",\"name\":\"Soup\",\"recipeIngredient\":[\"1 cup water\"],\"recipeInstructions\":\"Boil.\nServe.\"}"
        assertEquals(listOf("Boil.", "Serve."), found(page(block)).steps)
    }

    // -- method steps -------------------------------------------------------------------

    @Test
    fun keepsSectionHeadingsOnTheFirstStepOfEachGroup() {
        val recipe = found(page("""
            {"@type":"Recipe","name":"Pasta","recipeIngredient":["1 lb pasta"],"recipeInstructions":[
              {"@type":"HowToSection","name":"For the sauce","itemListElement":[
                {"@type":"HowToStep","text":"Simmer the tomatoes."},
                {"@type":"HowToStep","text":"Blend."}]},
              {"@type":"HowToSection","name":"To finish","itemListElement":[
                {"@type":"HowToStep","text":"Toss with pasta."}]}
            ]}
        """.trimIndent()))
        assertEquals(
            listOf("For the sauce: Simmer the tomatoes.", "Blend.", "To finish: Toss with pasta."),
            recipe.steps
        )
    }

    @Test
    fun stripsStepNumbersBecauseTheAppNumbersStepsItself() {
        val recipe = found(page("""{"@type":"Recipe","name":"Bread","recipeIngredient":["1 cup flour"],"recipeInstructions":"1. Preheat the oven.\n2. Bake for 20 minutes.\nStep 3: Cool."}"""))
        assertEquals(listOf("Preheat the oven.", "Bake for 20 minutes.", "Cool."), recipe.steps)
    }

    @Test
    fun doesNotMistakeAQuantityForAStepNumber() {
        val recipe = found(page("""{"@type":"Recipe","name":"Bread","recipeIngredient":["1 cup flour"],"recipeInstructions":["10-15 minutes: bake until golden.","2 cups of stock go in now."]}"""))
        assertEquals(listOf("10-15 minutes: bake until golden.", "2 cups of stock go in now."), recipe.steps)
    }

    @Test
    fun splitsStepsAtLineBreaksButNeverInsideAParagraph() {
        val recipe = found(page("""{"@type":"Recipe","name":"Eggs","recipeIngredient":["2 eggs"],"recipeInstructions":["Fold in the egg&#39;s yolk<br>then chill","Whisk. Then whisk again. Then rest."]}"""))
        assertEquals(listOf("Fold in the egg's yolk", "then chill", "Whisk. Then whisk again. Then rest."), recipe.steps)
    }

    // -- servings and time ---------------------------------------------------------------

    @Test
    fun readsYieldInTheFormsSitesWriteIt() {
        fun servings(recipeYield: String) = found(page("""{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"recipeYield":$recipeYield}""")).servings
        assertEquals(4, servings("\"4 servings\""))
        assertEquals(6, servings("6"))
        assertEquals(24, servings("\"Makes 24 cookies\""))
        assertEquals(4, servings("\"Serves 4 to 6\""))
        assertEquals(8, servings("[\"\", \"8\"]"))
    }

    @Test
    fun leavesServingsUnsetWhenThePageDoesNotSayOrSaysNonsense() {
        val base = """{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]"""
        assertNull(found(page("$base}")).servings)
        assertNull(found(page("$base,\"recipeYield\":\"0\"}")).servings)
        assertNull(found(page("$base,\"recipeYield\":\"a few\"}")).servings)
    }

    @Test
    fun readsIsoAndPlainDurations() {
        assertEquals(45, RecipeHtmlExtractor.minutesOf("PT45M"))
        assertEquals(90, RecipeHtmlExtractor.minutesOf("PT1H30M"))
        assertEquals(60, RecipeHtmlExtractor.minutesOf("P0DT1H"))
        assertEquals(1440, RecipeHtmlExtractor.minutesOf("P1D"))
        assertEquals(30, RecipeHtmlExtractor.minutesOf("PT0.5H"))
        assertEquals(2, RecipeHtmlExtractor.minutesOf("PT90S"))
        assertEquals(45, RecipeHtmlExtractor.minutesOf("45 minutes"))
        assertEquals(90, RecipeHtmlExtractor.minutesOf("1 hr 30 min"))
        assertEquals(60, RecipeHtmlExtractor.minutesOf("1 hour"))
        assertEquals(30, RecipeHtmlExtractor.minutesOf("30"))
        assertEquals(45, RecipeHtmlExtractor.minutesOf(45))
    }

    @Test
    fun readsAnUnreadableDurationAsNoTimeRatherThanGuessing() {
        assertEquals(0, RecipeHtmlExtractor.minutesOf(null))
        assertEquals(0, RecipeHtmlExtractor.minutesOf(""))
        assertEquals(0, RecipeHtmlExtractor.minutesOf("PT"))
        assertEquals(0, RecipeHtmlExtractor.minutesOf("a while"))
    }

    @Test
    fun capsAbsurdDurationsWithinWhatTheCommunityRulesAccept() {
        assertEquals(100_000, RecipeHtmlExtractor.minutesOf("P365D"))
    }

    @Test
    fun aPageThatOnlyStatesATotalPutsItInTheCookSlotRatherThanDroppingIt() {
        val recipe = found(page("""{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"totalTime":"PT30M"}"""))
        assertEquals(0, recipe.prepTimeMinutes)
        assertEquals(30, recipe.cookTimeMinutes)
    }

    @Test
    fun doesNotInferCookTimeFromATotalWhenPrepIsGiven() {
        // Total minus prep might be cooking, or might be chilling. That is a guess.
        val recipe = found(page("""{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"prepTime":"PT10M","totalTime":"PT40M"}"""))
        assertEquals(10, recipe.prepTimeMinutes)
        assertEquals(0, recipe.cookTimeMinutes)
    }

    // -- ingredients, title, tags ----------------------------------------------------------

    @Test
    fun readsIngredientsGivenAsOneNewlineSeparatedString() {
        val recipe = found(page("""{"@type":"Recipe","name":"X","recipeIngredient":"1 cup flour\n2 eggs","recipeInstructions":["Mix."]}"""))
        assertEquals(listOf("1 cup flour", "2 eggs"), recipe.ingredientLines)
    }

    @Test
    fun fallsBackToThePageTitleWhenTheRecipeHasNoName() {
        val recipe = found(page(
            """{"@type":"Recipe","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}""",
            head = "<title>Grandma&#39;s Pie | Some Site</title>"
        ))
        assertEquals("Grandma's Pie | Some Site", recipe.title)
    }

    @Test
    fun capsTagsAndDropsDuplicatesAndOverlongOnes() {
        val recipe = found(page("""{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],
            "recipeCategory":["Dinner","dinner"],"recipeCuisine":"Italian","keywords":"a, b, c, d, e, f, this tag is far too long to be useful here"}"""))
        assertEquals(listOf("dinner", "italian", "a", "b", "c"), recipe.tags)
    }

    @Test
    fun doesNotTurnTheAuthorsNameIntoATag() {
        // Real pages list the author among their keywords. That is a credit, not a tag.
        val recipe = found(page("""{"@type":"Recipe","name":"X","author":{"@type":"Person","name":"Cassie Best"},"recipeIngredient":["1 egg"],"recipeInstructions":["Cook."],"recipeCategory":"Breakfast","keywords":"pancakes, Cassie Best, brunch"}"""))
        assertEquals(listOf("breakfast", "pancakes", "brunch"), recipe.tags)
    }

    @Test
    fun readsAnAuthorGivenAsAStringOrAList() {
        val asString = found(page("""{"@type":"Recipe","name":"X","author":"Sam Lee","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""))
        assertEquals("Sam Lee", asString.author)
        val asList = found(page("""{"@type":"Recipe","name":"X","author":[{"@type":"Person","name":"Kim Ray"}],"recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""))
        assertEquals("Kim Ray", asList.author)
    }

    // -- choosing and refusing -------------------------------------------------------------

    @Test
    fun prefersTheWholeRecipeOverStubsOnARoundupPage() {
        val recipe = found(page(
            """{"@type":"Recipe","name":"Teaser only"}""",
            """{"@type":"Recipe","name":"The real one","recipeIngredient":["1 egg"],"recipeInstructions":["Cook."]}"""
        ))
        assertEquals("The real one", recipe.title)
    }

    @Test
    fun saysSoWhenAPageHasNoStructuredRecipe() {
        val message = notFound("<html><head><title>Blog</title></head><body>1 cup flour, 2 eggs, mix well.</body></html>")
        assertTrue(message, message.contains("doesn't publish its recipe"))
    }

    @Test
    fun neverScrapesVisibleTextEvenWhenItLooksLikeARecipe() {
        val message = notFound(page("""{"@type":"Organization","name":"Acme"}"""))
        assertTrue(message, message.contains("doesn't publish its recipe"))
    }

    @Test
    fun saysSoWhenTheRecipeHasNoIngredientsOrMethod() {
        val message = notFound(page("""{"@type":"Recipe","name":"Just a name","description":"Delicious."}"""))
        assertTrue(message, message.contains("doesn't list its ingredients or method"))
    }

    @Test
    fun aRecipeWithOnlyIngredientsIsStillImported() {
        val recipe = found(page("""{"@type":"Recipe","name":"Salad","recipeIngredient":["1 head lettuce"]}"""))
        assertEquals(1, recipe.ingredientLines.size)
        assertTrue(recipe.steps.isEmpty())
    }
}
