package com.chefvoice.app.importer

import org.junit.Assert.assertEquals
import org.junit.Test

class HtmlTextTest {
    @Test
    fun decodesNamedAndNumericEntities() {
        assertEquals("Fish & chips", HtmlText.decodeEntities("Fish &amp; chips"))
        assertEquals("the egg's yolk", HtmlText.decodeEntities("the egg&#39;s yolk"))
        assertEquals("the egg's yolk", HtmlText.decodeEntities("the egg&#x27;s yolk"))
        assertEquals("½ cup", HtmlText.decodeEntities("&frac12; cup"))
        assertEquals("350°F", HtmlText.decodeEntities("350&deg;F"))
    }

    @Test
    fun decodesTextThatWasEncodedTwice() {
        assertEquals("the egg's yolk", HtmlText.decodeEntities("the egg&amp;#39;s yolk"))
    }

    @Test
    fun leavesAnUnknownEntityAsWritten() {
        assertEquals("a &bogus; b", HtmlText.decodeEntities("a &bogus; b"))
    }

    @Test
    fun stripsTagsAndTurnsLineEndingsIntoLines() {
        assertEquals(listOf("Chop the onion", "Fry until soft"), HtmlText.lines("<p>Chop the <b>onion</b></p><p>Fry until soft</p>"))
        assertEquals(listOf("one", "two", "three"), HtmlText.lines("one<br>two<br/>three"))
    }

    @Test
    fun aBareLessThanSignIsTextNotATag() {
        assertEquals("Bake < 20 minutes, then cool", HtmlText.line("Bake < 20 minutes, then cool"))
    }

    @Test
    fun collapsesWhitespaceAndDropsEmptyLines() {
        assertEquals(listOf("a b", "c"), HtmlText.lines("  a    b \n\n\r\n c  "))
    }

    @Test
    fun anEncodedTagIsTextNotMarkup() {
        // Tags are stripped before entities are decoded, so this stays literal text.
        assertEquals("use <b> for bold", HtmlText.line("use &lt;b&gt; for bold"))
    }
}
