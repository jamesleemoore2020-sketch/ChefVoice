package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.ShoppingItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A shopping list with a duplicate on it is a small annoyance. One with a silently
 * wrong total sends the chef to the shop to buy the wrong amount, and they will not
 * find out until they are cooking. So these tests pin the merge as deliberately
 * narrow: combine only when it is certainly safe, and split into two lines otherwise.
 */
class ShoppingListTest {
    private fun item(quantity: String, unit: String, name: String, from: String = "Chili") =
        ShoppingItem(quantity = quantity, unit = unit, name = name, recipeTitle = from)

    @Test
    fun addsQuantitiesForTheSameThingInTheSameUnit() {
        val merged = ShoppingList.merge(
            listOf(item("2", "cups", "flour")),
            listOf(item("1", "cup", "flour"))
        )
        assertEquals(1, merged.size)
        assertEquals("3", merged.single().quantity)
    }

    @Test
    fun foldsUnitSpellingsOntoOneLine() {
        val merged = ShoppingList.merge(
            listOf(item("2", "tablespoons", "olive oil")),
            listOf(item("1", "tbsp", "olive oil"))
        )
        assertEquals(1, merged.size)
        assertEquals("3", merged.single().quantity)
    }

    @Test
    fun matchesSingularAndPluralIngredientNames() {
        val merged = ShoppingList.merge(
            listOf(item("2", "", "onions")),
            listOf(item("1", "", "Onion"))
        )
        assertEquals(1, merged.size)
        assertEquals("3", merged.single().quantity)
    }

    @Test
    fun neverAddsAcrossIncomparableUnits() {
        // Turning 200 g of flour into cups needs to know how flour packs. Two lines
        // is the honest answer.
        val merged = ShoppingList.merge(
            listOf(item("2", "cups", "flour")),
            listOf(item("200", "g", "flour"))
        )
        assertEquals(2, merged.size)
    }

    @Test
    fun keepsDifferentIngredientsApart() {
        val merged = ShoppingList.merge(
            listOf(item("2", "cups", "flour")),
            listOf(item("2", "cups", "sugar"))
        )
        assertEquals(2, merged.size)
    }

    @Test
    fun doesNotMergeWhenEitherQuantityCannotBeRead() {
        // Adding "a pinch" to "1 tsp" would mean inventing a number.
        val merged = ShoppingList.merge(
            listOf(item("a pinch", "", "salt")),
            listOf(item("1", "tsp", "salt"))
        )
        assertEquals(2, merged.size)
    }

    @Test
    fun aMergedLineRemembersEveryRecipeItCameFrom() {
        val merged = ShoppingList.merge(
            listOf(item("2", "cups", "flour", from = "Chili")),
            listOf(item("1", "cup", "flour", from = "Cornbread"))
        )
        assertEquals("Chili, Cornbread", merged.single().recipeTitle)
    }

    @Test
    fun mergingIntoACheckedLineBringsItBackOntoTheList() {
        // The chef already bought 2 cups and ticked it off. Adding a recipe that needs
        // another cup means there is more to buy, so the line must not stay satisfied.
        val bought = item("2", "cups", "flour").copy(checked = true)
        val merged = ShoppingList.merge(listOf(bought), listOf(item("1", "cup", "flour")))
        assertEquals(1, merged.size)
        assertFalse(merged.single().checked)
    }

    @Test
    fun buildingFromARecipeCarriesTheScaling() {
        // A recipe doubled on screen must buy twice as much.
        val items = ShoppingList.itemsFor(
            recipeId = "r1",
            recipeTitle = "Chili",
            ingredients = listOf(Ingredient(quantity = "2", unit = "cups", name = "beans")),
            servingFactor = 2.0
        )
        assertEquals("4", items.single().quantity)
        assertEquals("r1", items.single().recipeId)
        assertEquals("Chili", items.single().recipeTitle)
    }

    @Test
    fun buildingFromARecipeDropsOnlyNamelessLines() {
        val items = ShoppingList.itemsFor(
            recipeId = "r1",
            recipeTitle = "Chili",
            ingredients = listOf(
                Ingredient(quantity = "2", unit = "cups", name = "beans"),
                Ingredient(quantity = "1", unit = "tsp", name = "  "),
                Ingredient(quantity = "", unit = "", name = "black pepper")
            )
        )
        // The blank-name row has nothing to buy; the quantity-less one still does.
        assertEquals(2, items.size)
        assertTrue(items.any { it.name == "black pepper" })
    }

    @Test
    fun shareTextMarksWhatIsAlreadyBought() {
        val text = ShoppingList.asShareText(
            listOf(item("2", "cups", "flour"), item("1", "tsp", "salt").copy(checked = true))
        )
        assertTrue(text.contains("[ ] 2 cups flour"))
        assertTrue(text.contains("[x] 1 tsp salt"))
    }

    @Test
    fun shareTextOfAnEmptyListSaysSo() {
        assertTrue(ShoppingList.asShareText(emptyList()).contains("empty"))
    }
}
