package com.chefvoice.app.data

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.Recipe
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins what the phone actually stores for a recipe.
 *
 * Tags were once a field on [Recipe] that the local JSON simply never wrote, so a chef's
 * tags silently vanished the next time the app was closed. Nothing in the UI hinted at
 * it: "Tags saved to this recipe." showed, and the tags were there until the restart.
 * Round-tripping through the real serializer is the only check that catches a field
 * being added to the model but not to the storage.
 */
class RecipeRepositoryJsonTest {
    private fun roundTrip(recipe: Recipe): Recipe =
        JSONObject(recipe.toJson().toString()).toRecipe()

    @Test
    fun tagsSurviveBeingSavedAndReloaded() {
        val restored = roundTrip(Recipe(id = "r1", title = "Chili", tags = listOf("bbq", "weeknight")))
        assertEquals(listOf("bbq", "weeknight"), restored.tags)
    }

    @Test
    fun aRecipeWithNoTagsStaysWithoutTags() {
        assertTrue(roundTrip(Recipe(id = "r2", title = "Toast")).tags.isEmpty())
    }

    @Test
    fun recipesSavedBeforeTagsWerePersistedStillLoad() {
        // The stored JSON of every recipe written by an earlier version has no "tags" key.
        val legacy = Recipe(id = "r3", title = "Old recipe").toJson().apply { remove("tags") }
        assertTrue(JSONObject(legacy.toString()).toRecipe().tags.isEmpty())
    }

    @Test
    fun theRestOfTheRecipeIsNotDisturbedByTheTagsField() {
        val original = Recipe(
            id = "r4",
            title = "Pancakes",
            description = "Fluffy",
            servings = 4,
            prepTimeMinutes = 10,
            cookTimeMinutes = 15,
            ingredients = listOf(Ingredient(id = "i1", quantity = "1 1/2", unit = "cup", name = "Flour")),
            steps = listOf("Whisk.", "Fry."),
            tags = listOf("breakfast")
        )
        val restored = roundTrip(original)
        assertEquals(original.title, restored.title)
        assertEquals(original.description, restored.description)
        assertEquals(original.servings, restored.servings)
        assertEquals(original.prepTimeMinutes, restored.prepTimeMinutes)
        assertEquals(original.cookTimeMinutes, restored.cookTimeMinutes)
        assertEquals(original.ingredients, restored.ingredients)
        assertEquals(original.steps, restored.steps)
    }
}
