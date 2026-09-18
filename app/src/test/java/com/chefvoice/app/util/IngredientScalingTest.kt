package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * The governing rule is that scaling is a **view**. Nothing here may lose an
 * ingredient, invent a number for one it cannot read, or produce a result that gets
 * written back over what the chef said.
 */
class IngredientScalingTest {
    private fun ing(quantity: String, unit: String = "", name: String = "flour") =
        Ingredient(quantity = quantity, unit = unit, name = name)

    @Test
    fun doublingDoublesAWholeNumber() {
        val scaled = IngredientScaling.scale(listOf(ing("2", "cups")), 2.0)
        assertEquals("4", scaled.single().quantity)
    }

    @Test
    fun halvingProducesAKitchenFractionNotADecimal() {
        // "0.5 cups" is not how anyone writes a recipe.
        assertEquals("1/2", IngredientScaling.scale(listOf(ing("1", "cup")), 0.5).single().quantity)
        assertEquals("1 1/2", IngredientScaling.scale(listOf(ing("3", "cups")), 0.5).single().quantity)
    }

    @Test
    fun scalesQuantitiesTheChefWroteAsFractions() {
        assertEquals("1", IngredientScaling.scale(listOf(ing("1/2", "cup")), 2.0).single().quantity)
        assertEquals("3", IngredientScaling.scale(listOf(ing("1 1/2", "cups")), 2.0).single().quantity)
        assertEquals("1", IngredientScaling.scale(listOf(ing("½", "cup")), 2.0).single().quantity)
    }

    @Test
    fun anUnreadableQuantityIsPassedThroughUntouched() {
        // "a pinch" cannot be doubled without inventing a number. Dropping the line
        // would be worse still: the chef would go to cook and the salt would be gone.
        val pinch = ing("a pinch", "", "salt")
        val scaled = IngredientScaling.scale(listOf(pinch), 2.0)
        assertEquals("a pinch", scaled.single().quantity)
        assertEquals("salt", scaled.single().name)
    }

    @Test
    fun anIngredientWithNoQuantityAtAllSurvives() {
        val toTaste = ing("", "", "black pepper")
        val scaled = IngredientScaling.scale(listOf(toTaste), 3.0)
        assertEquals(1, scaled.size)
        assertEquals("black pepper", scaled.single().name)
        assertEquals("", scaled.single().quantity)
    }

    @Test
    fun scalingNeverDropsALine() {
        val list = listOf(ing("2", "cups"), ing("a pinch", "", "salt"), ing("", "", "pepper"))
        assertEquals(list.size, IngredientScaling.scale(list, 2.5).size)
    }

    @Test
    fun aFactorOfOneReturnsTheSameListUntouched() {
        // Not merely equal -- the same instance, so the common case cannot introduce
        // rounding drift by round-tripping every quantity through the formatter.
        val list = listOf(ing("1/3", "cup"))
        assertSame(list, IngredientScaling.scale(list, 1.0))
    }

    @Test
    fun servingFactorIsTargetOverBase() {
        assertEquals(2.0, IngredientScaling.servingFactor(2, 4), 0.0001)
        assertEquals(0.5, IngredientScaling.servingFactor(4, 2), 0.0001)
        // A recipe with no stated servings must not divide by zero.
        assertEquals(1.0, IngredientScaling.servingFactor(0, 4), 0.0001)
        assertEquals(1.0, IngredientScaling.servingFactor(2, 0), 0.0001)
    }

    @Test
    fun convertsVolumeAndWeightWithinASystem() {
        val metric = IngredientScaling.convert(listOf(ing("1", "cup")), MeasurementSystem.METRIC).single()
        assertEquals("ml", metric.unit)
        assertEquals(236.588, IngredientScaling.parseQuantity(metric.quantity)!!, 1.0)

        val imperial = IngredientScaling.convert(listOf(ing("113", "g")), MeasurementSystem.IMPERIAL).single()
        assertEquals("oz", imperial.unit)
        assertEquals(4.0, IngredientScaling.parseQuantity(imperial.quantity)!!, 0.05)
    }

    @Test
    fun stepsUpToTheLargerUnitOnceTheAmountDeservesOne() {
        // 454 g is 16 oz, but nobody writes a recipe that way.
        val pound = IngredientScaling.convert(listOf(ing("454", "g")), MeasurementSystem.IMPERIAL).single()
        assertEquals("lb", pound.unit)
        assertEquals(1.0, IngredientScaling.parseQuantity(pound.quantity)!!, 0.02)

        val litre = IngredientScaling.convert(listOf(ing("5", "cups")), MeasurementSystem.METRIC).single()
        assertEquals("l", litre.unit)
        assertEquals(1.18, IngredientScaling.parseQuantity(litre.quantity)!!, 0.02)

        val kilo = IngredientScaling.convert(listOf(ing("3", "lb")), MeasurementSystem.METRIC).single()
        assertEquals("kg", kilo.unit)
        assertEquals(1.36, IngredientScaling.parseQuantity(kilo.quantity)!!, 0.02)
    }

    @Test
    fun stayingBelowTheThresholdKeepsTheSmallerUnit() {
        val grams = IngredientScaling.convert(listOf(ing("1", "lb")), MeasurementSystem.METRIC).single()
        assertEquals("g", grams.unit)
        assertEquals(453.592, IngredientScaling.parseQuantity(grams.quantity)!!, 1.0)
    }

    @Test
    fun neverConvertsVolumeIntoWeight() {
        // A cup of flour and a cup of honey do not weigh the same. Guessing which the
        // chef meant is exactly the invention this codebase refuses to do, so a cup
        // converts to millilitres and never to grams.
        val metric = IngredientScaling.convert(listOf(ing("1", "cup", "honey")), MeasurementSystem.METRIC).single()
        assertEquals("ml", metric.unit)
    }

    @Test
    fun anUnknownUnitIsLeftExactlyAsWritten() {
        val handful = ing("2", "handfuls", "spinach")
        val converted = IngredientScaling.convert(listOf(handful), MeasurementSystem.METRIC).single()
        assertEquals("handfuls", converted.unit)
        assertEquals("2", converted.quantity)
    }

    @Test
    fun asWrittenChangesNothing() {
        val list = listOf(ing("1", "cup"))
        assertSame(list, IngredientScaling.convert(list, MeasurementSystem.AS_WRITTEN))
    }

    @Test
    fun parseQuantityReadsWhatChefsWriteAndRefusesTheRest() {
        assertEquals(2.0, IngredientScaling.parseQuantity("2")!!, 0.0001)
        assertEquals(1.5, IngredientScaling.parseQuantity("1.5")!!, 0.0001)
        assertEquals(0.5, IngredientScaling.parseQuantity("1/2")!!, 0.0001)
        assertEquals(1.5, IngredientScaling.parseQuantity("1 1/2")!!, 0.0001)
        assertEquals(0.75, IngredientScaling.parseQuantity("¾")!!, 0.0001)
        assertEquals(2.0, IngredientScaling.parseQuantity("two")!!, 0.0001)
        assertNull(IngredientScaling.parseQuantity("a pinch"))
        assertNull(IngredientScaling.parseQuantity("to taste"))
        assertNull(IngredientScaling.parseQuantity(""))
        // A half-readable quantity is not half-usable: one unreadable token makes the
        // whole thing unsafe to scale.
        assertNull(IngredientScaling.parseQuantity("2 or so"))
    }

    @Test
    fun formatQuantityWritesNumbersBackTheWayACookWouldReadThem() {
        assertEquals("2", IngredientScaling.formatQuantity(2.0))
        assertEquals("1/2", IngredientScaling.formatQuantity(0.5))
        assertEquals("1 1/4", IngredientScaling.formatQuantity(1.25))
        assertEquals("1/3", IngredientScaling.formatQuantity(1.0 / 3))
        // Amounts a kitchen scale cannot resolve do not need decimals.
        assertEquals("237", IngredientScaling.formatQuantity(236.588))
        assertEquals("", IngredientScaling.formatQuantity(0.0))
    }
}
