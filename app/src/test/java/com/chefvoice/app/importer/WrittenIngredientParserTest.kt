package com.chefvoice.app.importer

import com.chefvoice.app.util.IngredientScaling
import com.chefvoice.app.util.MeasurementSystem
import com.chefvoice.app.util.ShoppingList
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A wrong amount on an imported recipe is worse than a missing one: the chef trusts the
 * number and cooks from it. So these pin the parser as fail-soft -- an amount is only
 * read when it is unambiguous, and everything else keeps its words.
 */
class WrittenIngredientParserTest {
    private fun assertParsed(line: String, quantity: String, unit: String, name: String) {
        val parsed = WrittenIngredientParser.parse(line)
        assertEquals("quantity of \"$line\"", quantity, parsed.quantity)
        assertEquals("unit of \"$line\"", unit, parsed.unit)
        assertEquals("name of \"$line\"", name, parsed.name)
    }

    @Test
    fun splitsTheCommonAmountUnitNameShape() {
        assertParsed("1 1/2 cups all-purpose flour, sifted", "1 1/2", "cup", "All-purpose flour, sifted")
        assertParsed("2 tablespoons olive oil", "2", "tbsp", "Olive oil")
        assertParsed("1 lb ground beef", "1", "lb", "Ground beef")
        assertParsed("3 cloves garlic, minced", "3", "clove", "Garlic, minced")
        assertParsed("200g flour", "200", "g", "Flour")
        assertParsed("1 fl oz brandy", "1", "fl oz", "Brandy")
        assertParsed("8 fluid ounces water", "8", "fl oz", "Water")
    }

    @Test
    fun readsUnicodeAndGluedFractions() {
        assertParsed("½ teaspoon salt", "1/2", "tsp", "Salt")
        assertParsed("1½ cups milk", "1 1/2", "cup", "Milk")
        assertParsed("⅛ cup sugar", "1/8", "cup", "Sugar")
    }

    @Test
    fun keepsRangesAsWrittenSoTheyAreNeverScaledOrSummed() {
        assertParsed("1-2 tablespoons honey", "1-2", "tbsp", "Honey")
        assertParsed("1 to 2 tablespoons honey", "1 to 2", "tbsp", "Honey")
        assertParsed("1–2 tbsp oil", "1-2", "tbsp", "Oil")
    }

    @Test
    fun movesPackageSizesAfterTheNameSoDifferentSizesStayApart() {
        assertParsed("1 (14.5 ounce) can diced tomatoes, undrained", "1", "can", "Diced tomatoes, undrained (14.5 ounce)")
        assertParsed("2 (14 oz) cans crushed tomatoes", "2", "can", "Crushed tomatoes (14 oz)")
        assertParsed("1/2 cup (1 stick) unsalted butter", "1/2", "cup", "Unsalted butter (1 stick)")
    }

    @Test
    fun keepsHowAMeasureIsFilled() {
        assertParsed("2 heaping tablespoons sugar", "2", "tbsp", "Sugar (heaping)")
    }

    // -- lines seen on real recipe sites (the first live-page validation of the importer) ----

    @Test
    fun liftsASizeWordOutOfTheWayOnlyWhenAUnitFollows() {
        assertParsed("1 large can (28 ounces) diced tomatoes, lightly drained", "1", "can", "Diced tomatoes, lightly drained (large) (28 ounces)")
        assertParsed("4 medium cloves garlic, minced", "4", "clove", "Garlic, minced (medium)")
        // No unit follows, so the words stay exactly where the page put them.
        assertParsed("1 large onion, finely minced (about 8 ounces; 225g)", "1", "", "Large onion, finely minced (about 8 ounces; 225g)")
        assertParsed("3 large eggs", "3", "", "Large eggs")
    }

    @Test
    fun readsRibsAsAUnit() {
        assertParsed("4 ribs celery, finely chopped (about 8 ounces; 225g)", "4", "rib", "Celery, finely chopped (about 8 ounces; 225g)")
    }

    @Test
    fun readsABareLeadingPinchAsOnePinch() {
        assertParsed("Pinch of red pepper flakes", "1", "pinch", "Red pepper flakes")
        assertParsed("Pinch freshly ground black pepper", "1", "pinch", "Freshly ground black pepper")
        assertParsed("Dash hot sauce", "1", "dash", "Hot sauce")
        // A unit word on its own is not a line to invent an amount for...
        assertParsed("Pinch", "", "", "Pinch")
        // ...and only inherently whole amounts are read this way.
        assertParsed("Cup of tea", "", "", "Cup of tea")
    }

    @Test
    fun cleansUpSpacingThatTheSourceOrTheFractionExpansionLeavesBehind() {
        assertParsed(
            "1 to 2 tablespoons lemon juice (½ to 1 medium lemon), to taste",
            "1 to 2", "tbsp", "Lemon juice (1/2 to 1 medium lemon), to taste"
        )
        assertParsed("Tortilla chips , to serve", "", "", "Tortilla chips, to serve")
    }

    @Test
    fun aSizeIsNotAnAmount() {
        // "1 1/2-inch" describes the ginger; reading it as 1 1/2 of something would be a guess.
        assertParsed("1 1/2-inch piece fresh ginger", "", "", "1 1/2-inch piece fresh ginger")
        assertParsed("5-spice powder", "", "", "5-spice powder")
    }

    @Test
    fun linesWithNoAmountKeepEveryWord() {
        assertParsed("Salt and pepper, to taste", "", "", "Salt and pepper, to taste")
        assertParsed("Fresh basil leaves for garnish", "", "", "Fresh basil leaves for garnish")
    }

    @Test
    fun understandsWordAmounts() {
        assertParsed("a pinch of salt", "1", "pinch", "Salt")
        assertParsed("two eggs", "2", "", "Eggs")
        // "a" is only an amount when a unit follows, or "a little salt" would become 1.
        assertParsed("a little salt", "", "", "A little salt")
    }

    @Test
    fun dropsAnOfAfterTheUnitAndPunctuationAfterAnAbbreviation() {
        assertParsed("1 cup of milk", "1", "cup", "Milk")
        assertParsed("2 tsp. vanilla extract", "2", "tsp", "Vanilla extract")
    }

    @Test
    fun stripsListMarkers() {
        assertParsed("• 2 cups flour", "2", "cup", "Flour")
        assertParsed("▢1 cup sugar", "1", "cup", "Sugar")
    }

    @Test
    fun neverLosesWordsWhenThereIsNothingToAttachTheAmountTo() {
        assertParsed("2 cups", "", "", "2 cups")
    }

    @Test
    fun blankLinesGiveAnEmptyIngredient() {
        assertParsed("", "", "", "")
        assertParsed("   ", "", "", "")
    }

    // -- an imported recipe must behave like a narrated one everywhere downstream --------

    @Test
    fun parsedAmountsScaleLikeNarratedOnes() {
        val scaled = IngredientScaling.scale(listOf(WrittenIngredientParser.parse("1 1/2 cups flour")), 2.0)
        assertEquals("3", scaled.single().quantity)
        assertEquals("cup", scaled.single().unit)
    }

    @Test
    fun parsedUnitsConvertBetweenSystems() {
        val metric = IngredientScaling.convert(
            listOf(WrittenIngredientParser.parse("2 cups milk")),
            MeasurementSystem.METRIC
        )
        assertEquals("ml", metric.single().unit)
        assertEquals("473", metric.single().quantity)
    }

    @Test
    fun rangesAreLeftAloneByScalingRatherThanInvented() {
        val scaled = IngredientScaling.scale(listOf(WrittenIngredientParser.parse("1-2 tbsp honey")), 2.0)
        assertEquals("1-2", scaled.single().quantity)
    }

    @Test
    fun parsedLinesMergeOnTheShoppingListWithNarratedOnes() {
        val fromImport = ShoppingList.itemsFor("a", "Imported", listOf(WrittenIngredientParser.parse("2 cups flour")))
        val fromVoice = ShoppingList.itemsFor(
            "b", "Narrated",
            listOf(com.chefvoice.app.voice.IngredientParser.parse("1 cup flour"))
        )
        val merged = ShoppingList.merge(fromImport, fromVoice)
        assertEquals(1, merged.size)
        assertEquals("3", merged.single().quantity)
    }
}
