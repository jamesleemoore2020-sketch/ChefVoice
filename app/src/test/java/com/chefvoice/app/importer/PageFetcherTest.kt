package com.chefvoice.app.importer

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

/** The network call itself is thin; everything with a decision in it is tested here. */
class PageFetcherTest {
    @Test
    fun readsAWholeStreamThatIsUnderTheCap() {
        val data = ByteArray(100) { it.toByte() }
        assertArrayEquals(data, HttpPageFetcher.readCapped(ByteArrayInputStream(data), 1000))
    }

    @Test
    fun truncatesAStreamThatIsOverTheCapInsteadOfRefusingIt() {
        val data = ByteArray(100) { it.toByte() }
        assertArrayEquals(data.copyOf(10), HttpPageFetcher.readCapped(ByteArrayInputStream(data), 10))
    }

    @Test
    fun truncatesAcrossBufferBoundaries() {
        val data = ByteArray(40_000) { (it % 251).toByte() }
        val read = HttpPageFetcher.readCapped(ByteArrayInputStream(data), 20_000)
        assertEquals(20_000, read.size)
        assertArrayEquals(data.copyOf(20_000), read)
    }

    @Test
    fun readsAnEmptyStream() {
        assertEquals(0, HttpPageFetcher.readCapped(ByteArrayInputStream(ByteArray(0)), 10).size)
    }

    @Test
    fun usesTheDeclaredCharsetOrFallsBackToUtf8() {
        assertEquals(Charsets.UTF_8, HttpPageFetcher.charsetOf(null))
        assertEquals(Charsets.UTF_8, HttpPageFetcher.charsetOf("text/html"))
        assertEquals(Charsets.ISO_8859_1, HttpPageFetcher.charsetOf("text/html; charset=ISO-8859-1"))
        assertEquals(Charsets.UTF_8, HttpPageFetcher.charsetOf("text/html; charset=\"utf-8\""))
        assertEquals(Charsets.UTF_8, HttpPageFetcher.charsetOf("text/html; charset=not-a-real-charset"))
    }

    @Test
    fun onlyReadsPagesNotFilesOrImages() {
        assertTrue(HttpPageFetcher.isReadableType("text/html; charset=utf-8"))
        assertTrue(HttpPageFetcher.isReadableType("application/xhtml+xml"))
        assertFalse(HttpPageFetcher.isReadableType("application/pdf"))
        assertFalse(HttpPageFetcher.isReadableType("image/jpeg"))
        assertFalse(HttpPageFetcher.isReadableType("application/octet-stream"))
    }

    @Test
    fun explainsEachKindOfHttpFailureInPlainLanguage() {
        assertTrue(HttpPageFetcher.messageForStatus(404).contains("wasn't found"))
        assertTrue(HttpPageFetcher.messageForStatus(403).contains("wouldn't let"))
        assertTrue(HttpPageFetcher.messageForStatus(429).contains("limiting requests"))
        assertTrue(HttpPageFetcher.messageForStatus(503).contains("problem"))
        assertTrue(HttpPageFetcher.messageForStatus(418).contains("418"))
    }

    @Test
    fun followsRelativeAndAbsoluteRedirects() {
        assertEquals("https://example.com/recipes/1", HttpPageFetcher.resolveRedirect("https://example.com/a/b", "/recipes/1"))
        assertEquals("https://other.com/x", HttpPageFetcher.resolveRedirect("https://example.com/a", "https://other.com/x"))
    }

    @Test
    fun upgradesAnHttpRedirectToHttps() {
        assertEquals("https://other.com/x", HttpPageFetcher.resolveRedirect("https://example.com/a", "http://other.com/x"))
    }

    @Test
    fun refusesARedirectToSomewhereTheChefCouldNotHaveTypedDirectly() {
        assertThrows(FetchException::class.java) { HttpPageFetcher.resolveRedirect("https://example.com/a", "https://localhost/x") }
        assertThrows(FetchException::class.java) { HttpPageFetcher.resolveRedirect("https://example.com/a", "https://192.168.1.1/admin") }
        assertThrows(FetchException::class.java) { HttpPageFetcher.resolveRedirect("https://example.com/a", "file:///sdcard/x") }
    }
}
