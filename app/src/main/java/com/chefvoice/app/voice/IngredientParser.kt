package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient

/**
 * Parses an ingredient phrase after speech recognition or manual entry.
 *
 * The parser intentionally normalizes common ASR spellings such as
 * "tea spoons" -> "teaspoons" and "to teaspoons" -> "2 teaspoons".
 */
object IngredientParser {
    private val unitAliases = linkedMapOf(
        "tablespoonfuls" to "tbsp", "tablespoonful" to "tbsp", "tablespoons" to "tbsp", "tablespoon" to "tbsp", "tbsp" to "tbsp", "tbs" to "tbsp",
        "teaspoonfuls" to "tsp", "teaspoonful" to "tsp", "teaspoons" to "tsp", "teaspoon" to "tsp", "tsp" to "tsp",
        "kilograms" to "kg", "kilogram" to "kg", "kg" to "kg",
        "milligrams" to "mg", "milligram" to "mg", "mg" to "mg",
        "grams" to "g", "gram" to "g", "g" to "g",
        "liters" to "L", "liter" to "L", "litres" to "L", "litre" to "L", "l" to "L",
        "milliliters" to "ml", "milliliter" to "ml", "millilitres" to "ml", "millilitre" to "ml", "ml" to "ml",
        "fluid ounces" to "fl oz", "fluid ounce" to "fl oz", "fl oz" to "fl oz",
        "ounces" to "oz", "ounce" to "oz", "oz" to "oz",
        "pounds" to "lb", "pound" to "lb", "lbs" to "lb", "lb" to "lb",
        "cupfuls" to "cup", "cupful" to "cup", "cups" to "cup", "cup" to "cup",
        "chunks" to "chunk", "chunk" to "chunk",
        "cloves" to "clove", "clove" to "clove",
        "cans" to "can", "can" to "can",
        "pinches" to "pinch", "pinch" to "pinch",
        "dashes" to "dash", "dash" to "dash",
        "handfuls" to "handful", "handful" to "handful",
        "slices" to "slice", "slice" to "slice",
        "pieces" to "piece", "piece" to "piece",
        "sticks" to "stick", "stick" to "stick",
        "sprigs" to "sprig", "sprig" to "sprig",
        "bunches" to "bunch", "bunch" to "bunch",
        "heads" to "head", "head" to "head",
        "packages" to "package", "package" to "package", "packets" to "packet", "packet" to "packet",
        "jars" to "jar", "jar" to "jar", "bottles" to "bottle", "bottle" to "bottle",
        "boxes" to "box", "box" to "box", "bags" to "bag", "bag" to "bag"
    )

    private val numberWords = mapOf(
        "zero" to "0", "one" to "1", "two" to "2", "three" to "3", "four" to "4",
        "five" to "5", "six" to "6", "seven" to "7", "eight" to "8", "nine" to "9",
        "ten" to "10", "eleven" to "11", "twelve" to "12", "thirteen" to "13",
        "fourteen" to "14", "fifteen" to "15", "sixteen" to "16", "seventeen" to "17",
        "eighteen" to "18", "nineteen" to "19", "twenty" to "20",
        "couple" to "2", "dozen" to "12", "half" to "1/2", "quarter" to "1/4",
        "a" to "1", "an" to "1"
    )


    private val measurementEvidence = Regex(
        "(?i)\\b(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|a|an)\\s+(?:tablespoon(?:ful)?s?|teaspoon(?:ful)?s?|tbsp|tsp|cups?|chunks?|grams?|kilograms?|milligrams?|ounces?|pounds?|lbs?|cloves?|cans?|pinches?|dashes?|handfuls?|slices?|pieces?|sticks?|sprigs?|bunches?|heads?|packages?|packets?|jars?|bottles?|boxes?|bags?)\\b"
    )

    fun containsMeasurementEvidence(raw: String): Boolean =
        measurementEvidence.containsMatchIn(normalizeSpeechText(raw))

    fun measurementEvidenceCount(raw: String): Int =
        measurementEvidence.findAll(normalizeSpeechText(raw)).count()

    /** Normalizes speech-recognition variants without changing recipe meaning. */
    fun normalizeSpeechText(raw: String): String {
        return raw
            .replace('’', '\'')
            .replace("½", " 1/2 ")
            .replace("¼", " 1/4 ")
            .replace("¾", " 3/4 ")
            .replace("⅓", " 1/3 ")
            .replace("⅔", " 2/3 ")
            .replace(Regex("(?i)\\b1?\\s*⁄\\s*2\\b"), " 1/2 ")
            .replace(Regex("(?i)\\btea[ -]?spoon(?:ful)?s?\\b"), "teaspoon")
            .replace(Regex("(?i)\\btable[ -]?spoon(?:ful)?s?\\b"), "tablespoon")
            .replace(Regex("(?i)\\bt[ .-]?spoons?\\b"), "teaspoon")
            .replace(Regex("(?i)\\btb[ .-]?spoons?\\b"), "tablespoon")
            .replace(Regex("(?i)\\bfl[ .-]?ounces?\\b"), "fluid ounce")
            .replace(Regex("(?i)\\bcup\\s*ful(?:l)?s?\\b"), "cup")
            .replace(Regex("(?i)\\bcup\\s+fulls?\\b"), "cup")
            .replace(Regex("(?i)\\ba\\s+(half|quarter)\\s+a\\b")) { "${it.groupValues[1]} a" }
            .replace(Regex("(?i)\\b(tbsp|tsp|tablespoons?|teaspoons?)\\s+spoons?\\b"), "$1")
            // Number homophones are corrected only when directly before a measurement unit.
            .replace(Regex("(?i)\\b(?:to|too)\\s+(?=(?:tablespoons?|teaspoons?|tbsp|tsp|cups?|chunks?|grams?|kilograms?|ounces?|pounds?|lbs?|cloves?|cans?|pinches?|slices?|pieces?)\\b)"), "2 ")
            .replace(Regex("(?i)\\bwon\\s+(?=(?:tablespoons?|teaspoons?|cups?|chunks?|grams?|ounces?|pounds?|cloves?|cans?|pinches?)\\b)"), "1 ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    fun parse(raw: String): Ingredient {
        val cleaned = normalizeSpeechText(raw)
            .lowercase()
            .trim(' ', ',', '.', ';', ':')
            .replace(Regex("\\s+"), " ")
        if (cleaned.isBlank()) return Ingredient()

        val tokens = cleaned.split(" ").toMutableList()
        val quantityResult = parseQuantity(tokens)
        val quantity = quantityResult.first
        repeat(quantityResult.second) { if (tokens.isNotEmpty()) tokens.removeAt(0) }

        var unit = ""
        if (tokens.isNotEmpty()) {
            val twoWord = tokens.take(2).joinToString(" ").trim(',', '.')
            val oneWord = tokens.first().trim(',', '.')
            when {
                tokens.size >= 2 && unitAliases.containsKey(twoWord) -> {
                    unit = unitAliases.getValue(twoWord)
                    repeat(2) { tokens.removeAt(0) }
                }
                unitAliases.containsKey(oneWord) -> {
                    unit = unitAliases.getValue(oneWord)
                    tokens.removeAt(0)
                }
            }
        }

        var name = tokens.joinToString(" ")
            .replace(Regex("^(?:of\\s+)+(?:the\\s+)?"), "")
            .trim(' ', ',', '.', ';', ':')

        // Remove standalone preparation items that are not ingredients.
        if (Regex("(?i)^\\d+\\s+patties?$" ).matches(name) || Regex("(?i)^patties?$" ).matches(name)) {
            name = ""
        }

        // Remove stray measurement words accidentally captured in the name.
        name = name
            .replace(Regex("(?i)\\b(?:teaspoons?|tsp|tablespoons?|tbsp)\\b"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

        return Ingredient(quantity = quantity, unit = unit, name = name)
    }

    private fun parseQuantity(tokens: List<String>): Pair<String, Int> {
        if (tokens.isEmpty()) return "" to 0
        val first = tokens[0].trim(',', '.')

        // Common spoken fraction forms: "half a cup", "quarter of a cup".
        if (first in setOf("half", "quarter") && tokens.size >= 2) {
            if (tokens[1] == "a") return (if (first == "half") "1/2" else "1/4") to 2
            if (tokens.size >= 3 && tokens[1] == "of" && tokens[2] == "a") {
                return (if (first == "half") "1/2" else "1/4") to 3
            }
        }

        // Numeric forms: 2, 2.5, 1/2, 2 1/2.
        if (first.matches(Regex("\\d+(?:\\.\\d+)?|\\d+/\\d+"))) {
            if (tokens.size >= 2 && tokens[1].matches(Regex("\\d+/\\d+"))) {
                return "$first ${tokens[1]}" to 2
            }
            if (tokens.size >= 4 && tokens[1] == "and" && tokens[2] in setOf("a", "one") && tokens[3] in setOf("half", "quarter")) {
                return "$first ${if (tokens[3] == "half") "1/2" else "1/4"}" to 4
            }
            if (tokens.size >= 3 && tokens[1] == "and" && tokens[2] in setOf("half", "quarter")) {
                return "$first ${if (tokens[2] == "half") "1/2" else "1/4"}" to 3
            }
            return first to 1
        }

        // "three quarters" / "two thirds".
        if (tokens.size >= 2) {
            val numerator = numberWords[first]?.toIntOrNull()
            val fractionWord = tokens[1].trim(',', '.')
            val denominator = when (fractionWord) {
                "halves", "half" -> 2
                "third", "thirds" -> 3
                "quarter", "quarters", "fourth", "fourths" -> 4
                else -> null
            }
            if (numerator != null && denominator != null && numerator in 1 until denominator) {
                return "$numerator/$denominator" to 2
            }
        }

        val base = numberWords[first] ?: return "" to 0
        if (tokens.size >= 4 && tokens[1] == "and" && tokens[2] in setOf("a", "one") && tokens[3] in setOf("half", "quarter")) {
            return "$base ${if (tokens[3] == "half") "1/2" else "1/4"}" to 4
        }
        if (tokens.size >= 3 && tokens[1] == "and" && tokens[2] in setOf("half", "quarter")) {
            return "$base ${if (tokens[2] == "half") "1/2" else "1/4"}" to 3
        }
        return base to 1
    }
}
