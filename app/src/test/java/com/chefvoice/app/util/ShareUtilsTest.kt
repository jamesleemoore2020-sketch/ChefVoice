package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.Recipe
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What a chef's share sheet carries (audit F29: a link a messaging app can preview). */
class ShareUtilsTest {
    private val recipe = Recipe(
        id = "abc-123",
        title = "Garlic butter pasta",
        authorName = "DaPlug",
        ingredients = listOf(Ingredient(quantity = "2", unit = "tbsp", name = "butter")),
        steps = listOf("Melt the butter.")
    )

    @Test
    fun aPublishedRecipeSharesItsPreviewLink() {
        val text = recipeShareText(recipe.copy(isPublic = true))
        assertTrue(text, text.trimEnd().endsWith("https://chefvoice-d7fec.web.app/r/abc-123"))
        assertFalse("the old deep link is not shared any more", text.contains("?tab="))
    }

    @Test
    fun aPrivateRecipeSharesTextOnly() {
        val text = recipeShareText(recipe.copy(isPublic = false))
        assertFalse(text, text.contains("https://"))
        assertTrue(text.contains("• 2 tbsp butter"))
        assertTrue(text.contains("1. Melt the butter."))
    }
}
