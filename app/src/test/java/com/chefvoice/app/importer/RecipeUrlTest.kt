package com.chefvoice.app.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RecipeUrlTest {
    private fun ok(input: String): String {
        val result = RecipeUrl.normalize(input)
        if (result !is UrlResult.Ok) fail("expected \"$input\" to be accepted but got $result")
        return (result as UrlResult.Ok).url
    }

    private fun rejected(input: String) {
        val result = RecipeUrl.normalize(input)
        assertTrue("expected \"$input\" to be rejected but got $result", result is UrlResult.Rejected)
    }

    @Test
    fun acceptsAnOrdinaryRecipeLink() {
        assertEquals("https://www.example.com/best-chili", ok("https://www.example.com/best-chili"))
    }

    @Test
    fun addsHttpsToABareAddress() {
        assertEquals("https://example.com/chili", ok("example.com/chili"))
    }

    @Test
    fun upgradesHttpBecauseAndroidBlocksCleartextTraffic() {
        assertEquals("https://example.com/x", ok("http://example.com/x"))
    }

    @Test
    fun takesTheLinkOutOfSharedText() {
        assertEquals("https://example.com/chili?id=7", ok("Great chili! https://example.com/chili?utm_source=share&id=7#comments thanks"))
    }

    @Test
    fun dropsTrackingParametersButKeepsOnesThatChooseThePage() {
        assertEquals("https://example.com/chili", ok("https://example.com/chili?utm_source=a&utm_medium=b&fbclid=zz"))
        assertEquals("https://example.com/recipe?id=42", ok("https://example.com/recipe?id=42&utm_campaign=x"))
    }

    @Test
    fun ignoresPunctuationThatEndsASentence() {
        assertEquals("https://example.com/chili", ok("See https://example.com/chili."))
    }

    @Test
    fun normalisesCaseInTheSchemeAndHostOnly() {
        assertEquals("https://example.com/Chili", ok("HTTPS://Example.COM/Chili"))
    }

    @Test
    fun dropsTheDefaultPort() {
        assertEquals("https://example.com/x", ok("https://example.com:443/x"))
    }

    @Test
    fun rejectsAnythingThatIsNotALink() {
        rejected("")
        rejected("   ")
        rejected("hello world")
    }

    @Test
    fun rejectsSchemesOtherThanWeb() {
        rejected("ftp://example.com/x")
        rejected("file:///sdcard/recipe.html")
        rejected("javascript:alert(1)")
        rejected("content://com.android.providers/x")
    }

    @Test
    fun rejectsLocalAndPrivateAddresses() {
        rejected("https://localhost/x")
        rejected("https://127.0.0.1/x")
        rejected("https://10.0.0.1/")
        rejected("https://192.168.1.10/x")
        rejected("https://172.16.5.5/x")
        rejected("https://169.254.169.254/latest/meta-data")
        rejected("https://[::1]/x")
        rejected("https://intranet/x")
        rejected("https://printer.local/x")
    }

    @Test
    fun acceptsAPublicIpAddressAndTheEdgesOfThePrivateRanges() {
        assertEquals("https://8.8.8.8/", ok("https://8.8.8.8/"))
        assertEquals("https://172.32.0.1/", ok("https://172.32.0.1/"))
    }

    @Test
    fun rejectsCredentialsInTheLinkAndUnusualPorts() {
        rejected("https://user:secret@example.com/x")
        rejected("https://example.com:8080/x")
    }

    @Test
    fun rejectsAnAbsurdlyLongLink() {
        rejected("https://example.com/" + "a".repeat(2100))
    }

    @Test
    fun namesTheSiteWithoutWww() {
        assertEquals("example.com", RecipeUrl.displayHost("https://www.example.com/x"))
        assertEquals("cooking.example.org", RecipeUrl.displayHost("https://cooking.example.org/x"))
    }
}
