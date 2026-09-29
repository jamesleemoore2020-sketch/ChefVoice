package com.chefvoice.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Chef search (audit F10). `shared/chef-search-words.tsv` is how the backend and both apps read
 * text into words: the backend builds each chef's tokens with it, and this reads a typed search.
 */
class ChefSearchTest {
    private fun fixtureFile(): File {
        var dir = File(System.getProperty("user.dir") ?: ".")
        repeat(6) {
            val candidate = File(dir, "shared/chef-search-words.tsv")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        error("Could not find shared/chef-search-words.tsv from ${System.getProperty("user.dir")}")
    }

    @Test
    fun everySharedRowReadsTheSameOnAndroid() {
        val rows = fixtureFile().readLines().filter { it.isNotEmpty() && !it.startsWith("#") }
        assertTrue("only ${rows.size} rows", rows.size >= 17)
        val failures = rows.mapNotNull { line ->
            val columns = line.split("\t")
            val expected = if (columns[2] == "-") emptyList() else columns[2].split(" ;; ")
            val actual = ChefSearch.searchWords(columns[1])
            if (actual == expected) null else "[${columns[0]}] expected=$expected actual=$actual"
        }
        assertTrue("Android chef-search failures:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    @Test
    fun theKeyIsTheLongestWordAndSingleLettersAreNeverSearched() {
        assertEquals(listOf("mary", "berry"), ChefSearch.queryWords("Mary  BERRY mary"))
        assertEquals("berry", ChefSearch.queryKey(ChefSearch.queryWords("Mary Berry")))
        assertEquals("ab", ChefSearch.queryKey(ChefSearch.queryWords("ab cd")))
        assertEquals("", ChefSearch.queryKey(emptyList()))
        assertTrue(ChefSearch.queryWords("a b").isEmpty())
        assertEquals(listOf("extraordinarilylongc"), ChefSearch.queryWords("Extraordinarilylongchefnamethatgoeson"))
    }

    @Test
    fun everyWordHasToMatch() {
        val tokens = listOf("da", "pl", "plu", "plug", "dap", "dapl", "daplu", "daplug")
        assertTrue(ChefSearch.matchesAll(tokens, ChefSearch.queryWords("Da Plug")))
        assertTrue(ChefSearch.matchesAll(tokens, ChefSearch.queryWords("DAPLUG")))
        assertFalse(ChefSearch.matchesAll(tokens, ChefSearch.queryWords("da plugz")))
        assertFalse(ChefSearch.matchesAll(tokens, ChefSearch.queryWords("lug")))
    }

    @Test
    fun chefsFoundByNameComeFirst() {
        val words = ChefSearch.queryWords("mango")
        assertTrue(ChefSearch.nameMatches("Mango Mike", words))
        assertFalse(ChefSearch.nameMatches("Ana", words))
        val ordered = ChefSearch.byNameFirst(listOf("Ana", "Mango Mike", "Mangosteen Mo"), words) { it }
        assertEquals(listOf("Mango Mike", "Mangosteen Mo", "Ana"), ordered)
    }
}
