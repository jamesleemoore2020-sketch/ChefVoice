package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * `shared/step-ingredients.tsv` is the contract both platforms keep: the PWA's
 * `web/tests/step-ingredients.test.mjs` reads the same rows. A row that passes there and
 * fails here is a port bug, not a new rule.
 */
class StepIngredientsTest {
    private fun fixtureFile(): File {
        var dir = File(System.getProperty("user.dir") ?: ".")
        repeat(6) {
            val candidate = File(dir, "shared/step-ingredients.tsv")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        error("Could not find shared/step-ingredients.tsv from ${System.getProperty("user.dir")}")
    }

    @Test
    fun everySharedRowPassesOnAndroid() {
        val rows = fixtureFile().readLines().filter { it.isNotBlank() && !it.startsWith("#") }
        assertTrue("only ${rows.size} rows read", rows.size >= 40)
        val failures = rows.mapNotNull { line ->
            val columns = line.split("\t")
            require(columns.size >= 4) { "Malformed step-ingredients row: $line" }
            val names = columns[1].split(" ;; ")
            val expected = if (columns[3] == "-") emptyList() else columns[3].split(" ;; ")
            val ingredients = names.map { Ingredient(quantity = "1", name = it) }
            val actual = StepIngredients.indicesIn(columns[2], ingredients).map { names[it] }
            if (actual == expected) null else "[${columns[0]}] expected=$expected actual=$actual"
        }
        assertTrue("Android step-ingredient failures:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    @Test
    fun anEmptyStepOrAnEmptyRecipeNamesNothing() {
        assertEquals(emptyList<Int>(), StepIngredients.indicesIn("", listOf(Ingredient(name = "Garlic"))))
        assertEquals(emptyList<Int>(), StepIngredients.indicesIn("Add the garlic", emptyList()))
        assertEquals(emptyList<Int>(), StepIngredients.indicesIn("Add the garlic", listOf(Ingredient(name = ""), Ingredient(name = "  "))))
    }

    @Test
    fun indicesPointIntoTheListAsGiven() {
        val ingredients = listOf(Ingredient(name = "Flour"), Ingredient(name = "Sugar"), Ingredient(name = "Butter"))
        assertEquals(listOf(2, 0), StepIngredients.indicesIn("Rub the butter into the flour", ingredients))
    }

    @Test
    fun singularFormsOnlyNeedToAgreeWithEachOther() {
        listOf("onions" to "onion", "tomatoes" to "tomato", "peaches" to "peach", "berries" to "berry",
            "leaves" to "leaf", "pies" to "pie", "eggs" to "egg", "radishes" to "radish").forEach { (a, b) ->
            assertEquals("$a / $b", StepIngredients.singular(b), StepIngredients.singular(a))
        }
        listOf("asparagus", "hummus", "couscous", "swiss", "gas").forEach { assertEquals(it, StepIngredients.singular(it)) }
    }

    @Test
    fun wordsDropAccentsApostrophesAndPunctuation() {
        assertEquals(listOf("chef", "jalapeno", "all", "purpose"), StepIngredients.words("Chef’s jalapeño, all-purpose!"))
    }
}
