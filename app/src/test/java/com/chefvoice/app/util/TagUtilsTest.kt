package com.chefvoice.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TagUtilsTest {
    @Test
    fun knownSpellingVariantsCollapseToOneCanonicalTag() {
        assertEquals("bbq", canonicalTag("BBQ"))
        assertEquals("bbq", canonicalTag("#BBQ"))
        assertEquals("bbq", canonicalTag("Barbecue"))
        assertEquals("bbq", canonicalTag("barbeque"))
        assertEquals("bbq", canonicalTag("Bar-B-Q"))
    }

    @Test
    fun distinctConceptsAreNotMerged() {
        assertEquals("vegan", canonicalTag("vegan"))
        assertEquals("vegetarian", canonicalTag("vegetarian"))
    }

    @Test
    fun parseTagsInputSplitsDedupesAndCaps() {
        val tags = parseTagsInput("#BBQ, camping   Camping bbq")
        assertEquals(listOf("bbq", "camping"), tags)
    }

    @Test
    fun parseTagsInputCapsAtMaxTags() {
        val raw = (1..12).joinToString(" ") { "tag$it" }
        assertEquals(8, parseTagsInput(raw).size)
    }

    @Test
    fun tagMatchesQueryHandlesAliasesAndPartials() {
        assertTrue(tagMatchesQuery("bbq", "barbecue"))
        assertTrue(tagMatchesQuery("bbq", "#bbq"))
        assertTrue(tagMatchesQuery("bbq", "bb"))
        assertFalse(tagMatchesQuery("bbq", "camping"))
    }
}
