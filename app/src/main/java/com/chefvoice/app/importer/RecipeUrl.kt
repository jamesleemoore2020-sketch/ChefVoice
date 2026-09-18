package com.chefvoice.app.importer

import java.net.URI
import java.net.URISyntaxException

sealed class UrlResult {
    data class Ok(val url: String) : UrlResult()
    data class Rejected(val message: String) : UrlResult()
}

/**
 * Turns whatever the chef pasted into one clean https address, or says why it cannot.
 *
 * The same rules are applied to every redirect the fetch follows, not just the first
 * address, so a link cannot be bounced somewhere the chef could not have typed directly.
 */
object RecipeUrl {
    private const val MAX_LENGTH = 2048
    private const val NOT_A_LINK = "Paste the web address of a recipe page, like https://example.com/best-chili."
    private const val NOT_PUBLIC = "That address isn't a public web page ChefVoice can import from."

    /** A share sheet hands over "Great chili! https://..." -- the link is what matters. */
    private val linkInText = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val trackingParameter = Regex("""^(?:utm_[a-z_]+|fbclid|gclid|igshid|mc_cid|mc_eid|msclkid)$""", RegexOption.IGNORE_CASE)
    private val ipv4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")
    private val localSuffixes = listOf(".local", ".localdomain", ".internal", ".lan", ".home", ".corp", ".intranet")

    fun normalize(input: String): UrlResult {
        val text = input.trim()
        if (text.isEmpty()) return UrlResult.Rejected(NOT_A_LINK)

        var candidate = (linkInText.find(text)?.value ?: text.trim('"', '\'', '<', '>', ' '))
            .trimEnd('.', ',', ';', '!')
        if (!candidate.contains("://")) {
            if (candidate.any { it.isWhitespace() }) return UrlResult.Rejected(NOT_A_LINK)
            candidate = "https://$candidate"
        }

        val uri = try {
            URI(candidate)
        } catch (e: URISyntaxException) {
            return UrlResult.Rejected(NOT_A_LINK)
        }
        val scheme = uri.scheme?.lowercase() ?: return UrlResult.Rejected(NOT_A_LINK)
        // http is upgraded rather than refused: Android blocks cleartext traffic, and
        // nearly every recipe site redirects http to https anyway.
        if (scheme != "http" && scheme != "https") {
            return UrlResult.Rejected("Only web addresses starting with https:// can be imported.")
        }
        if (uri.userInfo != null) return UrlResult.Rejected(NOT_A_LINK)
        val host = uri.host?.lowercase() ?: return UrlResult.Rejected(NOT_A_LINK)
        if (!isPublicHost(host)) return UrlResult.Rejected(NOT_PUBLIC)
        if (uri.port != -1 && uri.port != 80 && uri.port != 443) return UrlResult.Rejected(NOT_PUBLIC)

        val query = uri.rawQuery
            ?.split('&')
            ?.filter { it.isNotEmpty() && !trackingParameter.matches(it.substringBefore('=')) }
            ?.joinToString("&")
            .orEmpty()
        val path = uri.rawPath.orEmpty().ifEmpty { "/" }
        val normalized = "https://$host$path" + if (query.isNotEmpty()) "?$query" else ""
        if (normalized.length > MAX_LENGTH) return UrlResult.Rejected(NOT_A_LINK)
        return UrlResult.Ok(normalized)
    }

    /** The site name to show a chef: the host without a leading "www.". */
    fun displayHost(url: String): String =
        runCatching { URI(url).host.orEmpty().removePrefix("www.") }.getOrDefault("").ifEmpty { url }

    /**
     * Keeps the import to the public web. A phone that follows a pasted link to
     * 192.168.1.1 or localhost is poking at its own network, which is never what
     * "import a recipe" means.
     */
    private fun isPublicHost(host: String): Boolean {
        if (host.contains(':') || host.contains('[')) return false // IPv6 literals
        if (!host.contains('.')) return false
        if (host == "localhost" || localSuffixes.any { host.endsWith(it) }) return false
        val octets = ipv4.matchEntire(host)?.groupValues?.drop(1)?.map { it.toInt() } ?: return true
        val (a, b) = octets[0] to octets[1]
        return !(a == 0 || a == 10 || a == 127 ||
            (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 168) ||
            (a == 100 && b in 64..127) ||
            a >= 224)
    }
}
