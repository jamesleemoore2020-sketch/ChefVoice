package com.chefvoice.app.util

import com.chefvoice.app.model.Ingredient
import kotlin.math.abs
import kotlin.math.roundToInt

/** Which measurement system a scaled ingredient list is shown in. */
enum class MeasurementSystem { AS_WRITTEN, METRIC, IMPERIAL }

/**
 * Serving scaling and unit conversion for **display only**.
 *
 * Nothing here is ever written back into a recipe. A chef who narrated "two cups of
 * flour" said two cups, and the saved recipe keeps saying two cups no matter what the
 * servings stepper is set to -- same rule the parser and Second Pass follow, for the
 * same reason: the chef's own words are the record, and a derived view must not
 * quietly become the record.
 *
 * Both operations fail soft. A quantity this cannot parse ("a pinch", "to taste", an
 * empty string) is passed through completely untouched rather than dropped or guessed
 * at, so scaling a list can never lose an ingredient or invent a number for one.
 */
object IngredientScaling {
    private val vulgarFractions = mapOf(
        '½' to 0.5, '⅓' to 1.0 / 3, '⅔' to 2.0 / 3, '¼' to 0.25, '¾' to 0.75,
        '⅕' to 0.2, '⅖' to 0.4, '⅗' to 0.6, '⅘' to 0.8, '⅙' to 1.0 / 6,
        '⅚' to 5.0 / 6, '⅛' to 0.125, '⅜' to 0.375, '⅝' to 0.625, '⅞' to 0.875
    )

    private val numberWords = mapOf(
        "one" to 1.0, "two" to 2.0, "three" to 3.0, "four" to 4.0, "five" to 5.0,
        "six" to 6.0, "seven" to 7.0, "eight" to 8.0, "nine" to 9.0, "ten" to 10.0,
        "eleven" to 11.0, "twelve" to 12.0, "a" to 1.0, "an" to 1.0, "half" to 0.5
    )

    /**
     * Scales every quantity by [factor], leaving unparseable ones exactly as they are.
     *
     * A factor of 1 returns the list unchanged, so the common case of "servings not
     * touched" costs nothing and cannot introduce rounding drift.
     */
    fun scale(ingredients: List<Ingredient>, factor: Double): List<Ingredient> {
        if (factor == 1.0 || factor <= 0.0 || factor.isNaN()) return ingredients
        return ingredients.map { item ->
            val amount = parseQuantity(item.quantity) ?: return@map item
            item.copy(quantity = formatQuantity(amount * factor))
        }
    }

    /** The multiplier for moving a recipe from [baseServings] to [targetServings]. */
    fun servingFactor(baseServings: Int, targetServings: Int): Double {
        if (baseServings <= 0 || targetServings <= 0) return 1.0
        return targetServings.toDouble() / baseServings.toDouble()
    }

    /**
     * Rewrites quantity and unit into [system], leaving anything it does not recognise
     * alone.
     *
     * Conversions are only offered for units with a single unambiguous definition.
     * Volume-to-weight is never attempted: a cup of flour and a cup of honey do not
     * weigh the same, and guessing which one a chef meant is exactly the kind of
     * invention this codebase avoids.
     */
    fun convert(ingredients: List<Ingredient>, system: MeasurementSystem): List<Ingredient> {
        if (system == MeasurementSystem.AS_WRITTEN) return ingredients
        return ingredients.map { item ->
            val amount = parseQuantity(item.quantity) ?: return@map item
            val converted = convertMeasure(amount, item.unit, system) ?: return@map item
            item.copy(quantity = formatQuantity(converted.amount), unit = converted.unit)
        }
    }

    private data class Measure(val amount: Double, val unit: String)

    private fun convertMeasure(amount: Double, unit: String, system: MeasurementSystem): Measure? {
        val key = unit.trim().lowercase().trimEnd('.').removeSuffix("s")
        val base = when (system) {
            MeasurementSystem.METRIC -> when (key) {
                "cup" -> Measure(amount * 236.588, "ml")
                "tablespoon", "tbsp" -> Measure(amount * 14.787, "ml")
                "teaspoon", "tsp" -> Measure(amount * 4.929, "ml")
                "fluid ounce", "fl oz" -> Measure(amount * 29.574, "ml")
                "pint" -> Measure(amount * 473.176, "ml")
                "quart" -> Measure(amount * 946.353, "ml")
                "ounce", "oz" -> Measure(amount * 28.350, "g")
                "pound", "lb" -> Measure(amount * 453.592, "g")
                else -> null
            }
            MeasurementSystem.IMPERIAL -> when (key) {
                "milliliter", "millilitre", "ml" -> Measure(amount / 29.574, "fl oz")
                "liter", "litre", "l" -> Measure(amount * 1000 / 29.574, "fl oz")
                "gram", "g" -> Measure(amount / 28.350, "oz")
                "kilogram", "kg" -> Measure(amount * 1000 / 28.350, "oz")
                else -> null
            }
            MeasurementSystem.AS_WRITTEN -> null
        } ?: return null
        return stepUp(base)
    }

    /**
     * Moves a converted amount into the larger unit once it is big enough to deserve
     * one, so 454 g reads "1 lb" rather than "16 oz" and 1000 ml reads "1 l".
     *
     * This is presentation, not a second conversion: the quantity is the same amount
     * either way, and the thresholds are the exact definitions of the larger unit, so
     * nothing is rounded into existence.
     */
    private fun stepUp(measure: Measure): Measure = when (measure.unit) {
        "ml" -> if (measure.amount >= 1000) Measure(measure.amount / 1000, "l") else measure
        "g" -> if (measure.amount >= 1000) Measure(measure.amount / 1000, "kg") else measure
        "oz" -> if (measure.amount >= 16) Measure(measure.amount / 16, "lb") else measure
        "fl oz" -> if (measure.amount >= 8) Measure(measure.amount / 8, "cups") else measure
        else -> measure
    }

    /**
     * Reads a chef-written quantity into a number.
     *
     * Handles "2", "1.5", "1/2", "1 1/2", "1½", "½", "two". Returns null for anything
     * else, which is the signal to leave that ingredient completely alone.
     */
    fun parseQuantity(raw: String): Double? {
        val clean = raw.trim().lowercase()
        if (clean.isEmpty()) return null

        var total = 0.0
        var sawNumber = false
        // A vulgar fraction can be glued to a number ("1½") or stand alone ("½").
        val expanded = buildString {
            clean.forEach { char ->
                if (vulgarFractions.containsKey(char)) append(' ').append(char).append(' ')
                else append(char)
            }
        }
        expanded.split(Regex("\\s+")).filter { it.isNotBlank() }.forEach { token ->
            val value = when {
                token.length == 1 && vulgarFractions.containsKey(token[0]) -> vulgarFractions[token[0]]
                numberWords.containsKey(token) -> numberWords[token]
                token.contains('/') -> {
                    val parts = token.split('/')
                    val numerator = parts.getOrNull(0)?.trim()?.toDoubleOrNull()
                    val denominator = parts.getOrNull(1)?.trim()?.toDoubleOrNull()
                    if (parts.size == 2 && numerator != null && denominator != null && denominator != 0.0) {
                        numerator / denominator
                    } else null
                }
                else -> token.toDoubleOrNull()
            } ?: return null // A token this cannot read makes the whole quantity unsafe.
            total += value
            sawNumber = true
        }
        return if (sawNumber && total > 0.0) total else null
    }

    /**
     * Writes a number back the way a cook would: whole numbers stay whole, common
     * kitchen fractions come back as fractions rather than 0.33, and everything else
     * gets at most two decimals.
     */
    fun formatQuantity(value: Double): String {
        if (value.isNaN() || value.isInfinite() || value <= 0.0) return ""
        val whole = Math.floor(value).toInt()
        val remainder = value - whole

        val fraction = nearestKitchenFraction(remainder)
        if (fraction != null) {
            return when {
                whole == 0 -> fraction
                else -> "$whole $fraction"
            }
        }
        if (remainder < 0.005) return whole.toString()
        // Large amounts do not need decimal precision a kitchen cannot measure.
        if (value >= 100) return value.roundToInt().toString()
        return "%.2f".format(value).trimEnd('0').trimEnd('.')
    }

    private fun nearestKitchenFraction(remainder: Double): String? {
        if (remainder < 0.005) return null
        val candidates = listOf(
            0.125 to "1/8", 0.25 to "1/4", 1.0 / 3 to "1/3", 0.375 to "3/8",
            0.5 to "1/2", 0.625 to "5/8", 2.0 / 3 to "2/3", 0.75 to "3/4", 0.875 to "7/8"
        )
        // Only snap when the value is genuinely one of these, never to force one.
        val best = candidates.minByOrNull { abs(it.first - remainder) } ?: return null
        return if (abs(best.first - remainder) <= 0.02) best.second else null
    }
}
