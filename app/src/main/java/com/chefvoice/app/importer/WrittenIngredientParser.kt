package com.chefvoice.app.importer

import com.chefvoice.app.model.Ingredient

/**
 * Splits an ingredient line as a website prints it -- "1 1/2 cups all-purpose flour,
 * sifted" -- into the amount / unit / name shape the rest of the app stores.
 *
 * This is deliberately not `voice.IngredientParser`. That parser is tuned for what speech
 * recognition produces and is pinned row by row by the golden corpus. A written line has
 * different failure modes -- unicode fractions, ranges, "(14 oz) can" -- and this needs
 * to be free to be wrong about them without ever being able to disturb a spoken one.
 *
 * It follows the same rule the scaling and shopping code do: **fail soft**. When an
 * amount cannot be read with confidence the whole line is kept as the name with no amount,
 * so importing can never invent a number or drop words. Units are written the way the
 * voice parser writes them ("cup", "tbsp", "clove") so that scaling, unit conversion and
 * shopping-list merging treat an imported recipe exactly like a narrated one.
 */
object WrittenIngredientParser {
    private val vulgarFractions = mapOf(
        '½' to "1/2", '⅓' to "1/3", '⅔' to "2/3", '¼' to "1/4", '¾' to "3/4",
        '⅕' to "1/5", '⅖' to "2/5", '⅗' to "3/5", '⅘' to "4/5", '⅙' to "1/6",
        '⅚' to "5/6", '⅛' to "1/8", '⅜' to "3/8", '⅝' to "5/8", '⅞' to "7/8"
    )

    private val numberWords = mapOf(
        "one" to "1", "two" to "2", "three" to "3", "four" to "4", "five" to "5", "six" to "6",
        "seven" to "7", "eight" to "8", "nine" to "9", "ten" to "10", "eleven" to "11", "twelve" to "12"
    )

    /** Written spelling -> the canonical spelling the voice parser also produces. */
    private val units: Map<String, String> = buildMap {
        fun add(canonical: String, vararg spellings: String) = spellings.forEach { put(it, canonical) }
        add("tbsp", "tablespoon", "tablespoons", "tbsp", "tbsps", "tbs", "tbl")
        add("tsp", "teaspoon", "teaspoons", "tsp", "tsps")
        add("cup", "cup", "cups")
        add("oz", "ounce", "ounces", "oz")
        add("fl oz", "fluid ounce", "fluid ounces", "fl oz", "fl. oz")
        add("lb", "pound", "pounds", "lb", "lbs")
        add("g", "gram", "grams", "g")
        add("kg", "kilogram", "kilograms", "kg", "kgs")
        add("mg", "milligram", "milligrams", "mg")
        add("ml", "milliliter", "milliliters", "millilitre", "millilitres", "ml")
        add("L", "liter", "liters", "litre", "litres", "l")
        add("pint", "pint", "pints", "pt")
        add("quart", "quart", "quarts", "qt")
        add("gallon", "gallon", "gallons", "gal")
        add("pinch", "pinch", "pinches")
        add("dash", "dash", "dashes")
        add("clove", "clove", "cloves")
        add("can", "can", "cans")
        add("tin", "tin", "tins")
        add("package", "package", "packages", "pkg", "pkgs")
        add("packet", "packet", "packets")
        add("jar", "jar", "jars")
        add("bottle", "bottle", "bottles")
        add("bag", "bag", "bags")
        add("box", "box", "boxes")
        add("bunch", "bunch", "bunches")
        add("head", "head", "heads")
        add("sprig", "sprig", "sprigs")
        add("stick", "stick", "sticks")
        add("slice", "slice", "slices")
        add("piece", "piece", "pieces")
        add("handful", "handful", "handfuls")
        add("stalk", "stalk", "stalks")
        add("rib", "rib", "ribs")
    }

    /**
     * Words that qualify a unit rather than the ingredient: how a measure is filled ("2
     * heaping tablespoons") or how big the container is ("1 large can", "4 medium
     * cloves"). They are kept, as a note after the name, because a heaping spoon is not a
     * level one -- but they are only lifted out when a unit follows, so "3 large eggs"
     * and "1 large onion" keep their words in place.
     */
    private val measureModifiers = setOf(
        "heaping", "heaped", "rounded", "level", "scant", "generous", "packed",
        "small", "medium", "large", "big"
    )

    /**
     * A unit that is a whole amount on its own: "Pinch of red pepper flakes" means one
     * pinch. Deliberately short -- "Cup of ..." and "Can of ..." are not written that way.
     */
    private val impliesOne = setOf("pinch", "dash", "handful", "sprig", "bunch")

    private const val NUM = """(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)"""
    private val leadingAmount = Regex("""^($NUM(?:\s*(?:-|to|or)\s*$NUM)?)""", RegexOption.IGNORE_CASE)
    private val sizeAdjective = Regex("^-[A-Za-z]")

    fun parse(raw: String): Ingredient {
        val line = normalize(raw)
        if (line.isEmpty()) return Ingredient()

        var quantity = ""
        var rest = line

        val amount = leadingAmount.find(line)
        if (amount != null) {
            val after = line.substring(amount.range.last + 1)
            // "1 1/2-inch piece fresh ginger": the number is the size of the thing, not
            // how much of it there is. Reading it as an amount would be a guess.
            if (!sizeAdjective.containsMatchIn(after)) {
                quantity = amount.value.replace(Regex("\\s*-\\s*"), "-").replace(Regex("\\s+"), " ").trim()
                rest = after.trim()
            }
        } else {
            wordAmount(line)?.let { (value, remainder) ->
                quantity = value
                rest = remainder
            }
            if (quantity.isEmpty()) {
                val match = matchUnit(line)
                val remainder = match?.let { line.substring(it.length).trim() }.orEmpty()
                if (match != null && match.canonical in impliesOne && remainder.isNotEmpty()) {
                    quantity = "1"
                    rest = line
                }
            }
        }

        val notes = mutableListOf<String>()
        var unit = ""
        if (quantity.isNotEmpty()) {
            rest = takeParentheticals(rest, notes)
            val modifier = rest.substringBefore(' ').lowercase()
            if (modifier in measureModifiers && matchUnit(rest.substringAfter(' ', "")) != null) {
                notes += "($modifier)"
                rest = rest.substringAfter(' ', "")
            }
            matchUnit(rest)?.let { match ->
                unit = match.canonical
                rest = rest.substring(match.length).trim()
                rest = takeParentheticals(rest, notes)
            }
        }

        var name = rest
            .replace(Regex("^of\\s+", RegexOption.IGNORE_CASE), "")
            .trim(' ', ',', '.', ';', ':')
        // "2 cups" on its own has no ingredient to attach an amount to. Keep the whole
        // line rather than silently dropping words.
        if (name.isEmpty()) return Ingredient(name = line.replaceFirstChar { it.uppercaseChar() })

        if (notes.isNotEmpty()) name = name + " " + notes.joinToString(" ")
        return Ingredient(quantity = quantity, unit = unit, name = name.replaceFirstChar { it.uppercaseChar() })
    }

    private fun normalize(raw: String): String {
        val text = buildString {
            raw.forEach { char ->
                val fraction = vulgarFractions[char]
                when {
                    fraction != null -> append(' ').append(fraction).append(' ')
                    char == '⁄' -> append('/')
                    char == ' ' || char == ' ' || char == ' ' -> append(' ')
                    else -> append(char)
                }
            }
        }
        return text
            .replace(Regex("(?<=\\d)\\s*[\\u2013\\u2014\\u2212]\\s*(?=\\d)"), "-")
            .replace(Regex("^[\\u2022*\\u25A2\\u2610\\u25A1\\u00B7]+\\s*"), "")
            .replace(Regex("^[-\\u2013\\u2014]\\s+"), "")
            .replace(Regex("\\s+"), " ")
            // Expanding a fraction inside "(½ to 1 lemon)" leaves "( 1/2", and sites
            // themselves write "chips , to serve". Neither space means anything.
            .replace(Regex("\\(\\s+"), "(")
            .replace(Regex("\\s+([,;)])"), "$1")
            .trim()
    }

    /** "one" .. "twelve", and "a"/"an" -- but only when a unit follows ("a pinch of salt"). */
    private fun wordAmount(line: String): Pair<String, String>? {
        val first = line.substringBefore(' ').lowercase()
        val remainder = line.substringAfter(' ', "").trim()
        numberWords[first]?.let { return it to remainder }
        if ((first == "a" || first == "an") && matchUnit(remainder) != null) return "1" to remainder
        return null
    }

    private data class UnitMatch(val canonical: String, val length: Int)

    private fun matchUnit(text: String): UnitMatch? {
        if (text.isEmpty()) return null
        val words = text.split(' ', limit = 3)
        if (words.size >= 2) {
            val two = (words[0] + " " + words[1]).lowercase().trimEnd('.', ',')
            units[two]?.let { return UnitMatch(it, words[0].length + 1 + words[1].length) }
        }
        val one = words[0].lowercase().trimEnd('.', ',')
        return units[one]?.let { UnitMatch(it, words[0].length) }
    }

    /**
     * Moves any leading "(14 oz)" groups out of the way, into [notes]. They describe the
     * package or an alternative measure, and belong after the name, where they stay
     * readable and keep two different can sizes from being merged into one shopping line.
     */
    private fun takeParentheticals(text: String, notes: MutableList<String>): String {
        var remaining = text.trimStart()
        while (remaining.startsWith("(")) {
            var depth = 0
            var close = -1
            for (index in remaining.indices) {
                when (remaining[index]) {
                    '(' -> depth++
                    ')' -> {
                        depth--
                        if (depth == 0) {
                            close = index
                            break
                        }
                    }
                }
            }
            if (close < 0) break
            notes += remaining.substring(0, close + 1)
            remaining = remaining.substring(close + 1).trimStart()
        }
        return remaining
    }
}
