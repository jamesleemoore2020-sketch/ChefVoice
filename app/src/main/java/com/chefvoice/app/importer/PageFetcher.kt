package com.chefvoice.app.importer

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.Charset
import javax.net.ssl.SSLException

data class FetchedPage(
    /** Where the page actually came from, after any redirects. This is what gets credited. */
    val finalUrl: String,
    val html: String
)

/** [message] is written for the chef, so callers can show it as it stands. */
class FetchException(message: String) : Exception(message)

/** Fetches one web page. Blocking -- never call it from the main thread. */
interface PageFetcher {
    @Throws(FetchException::class)
    fun fetch(url: String): FetchedPage
}

/**
 * A plain HTTP GET with no cookies, no login and no JavaScript, so it only ever sees
 * what a search engine would. Nothing here is a way around a site's own access rules:
 * a site that refuses the request is reported as refusing it.
 */
class HttpPageFetcher(private val userAgent: String = DEFAULT_USER_AGENT) : PageFetcher {
    override fun fetch(url: String): FetchedPage {
        var current = url
        try {
            repeat(MAX_REDIRECTS + 1) {
                val connection = URL(current).openConnection() as HttpURLConnection
                try {
                    // Redirects are followed by hand so that every hop goes back through
                    // RecipeUrl's rules, and an http hop is upgraded rather than refused.
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = CONNECT_TIMEOUT_MS
                    connection.readTimeout = READ_TIMEOUT_MS
                    connection.requestMethod = "GET"
                    connection.setRequestProperty("User-Agent", userAgent)
                    connection.setRequestProperty("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
                    connection.setRequestProperty("Accept-Language", "en-US,en;q=0.8")

                    val code = connection.responseCode
                    when {
                        code in 300..399 -> {
                            val location = connection.getHeaderField("Location")
                                ?: throw FetchException(BAD_REDIRECT)
                            current = resolveRedirect(current, location)
                        }
                        code == 200 -> {
                            val type = connection.contentType?.lowercase()
                            if (type != null && !isReadableType(type)) throw FetchException(NOT_A_PAGE)
                            val bytes = connection.inputStream.use { readCapped(it, MAX_BYTES) }
                            return FetchedPage(current, String(bytes, charsetOf(connection.contentType)))
                        }
                        else -> throw FetchException(messageForStatus(code))
                    }
                } finally {
                    connection.disconnect()
                }
            }
            throw FetchException("That link redirects too many times to follow.")
        } catch (e: FetchException) {
            throw e
        } catch (e: UnknownHostException) {
            throw FetchException("ChefVoice couldn't reach that site. Check the address and your connection.")
        } catch (e: SocketTimeoutException) {
            throw FetchException("That site took too long to respond. Try again in a moment.")
        } catch (e: SSLException) {
            throw FetchException("ChefVoice couldn't make a secure connection to that site.")
        } catch (e: IOException) {
            throw FetchException("ChefVoice couldn't load that page. Check your connection and try again.")
        }
    }

    companion object {
        const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Mobile Safari/537.36 ChefVoice"

        private const val MAX_REDIRECTS = 5
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 15_000
        const val MAX_BYTES = 5 * 1024 * 1024
        private const val BAD_REDIRECT = "That link redirects somewhere ChefVoice can't open."
        private const val NOT_A_PAGE = "That link isn't a web page ChefVoice can read."

        internal fun isReadableType(contentType: String): Boolean =
            contentType.startsWith("text/") || contentType.contains("html") || contentType.contains("xml")

        internal fun messageForStatus(code: Int): String = when (code) {
            401, 403 -> "That site wouldn't let ChefVoice read the page. Some sites block apps; try another link."
            404, 410 -> "That page wasn't found. Check the address."
            429 -> "That site is limiting requests right now. Try again in a little while."
            in 500..599 -> "That site had a problem loading the page. Try again later."
            else -> "That site returned an unexpected response ($code)."
        }

        /** Resolves a relative or absolute Location header and re-applies the URL rules. */
        internal fun resolveRedirect(base: String, location: String): String {
            val resolved = try {
                URI(base).resolve(location.trim()).toString()
            } catch (e: Exception) {
                throw FetchException(BAD_REDIRECT)
            }
            return when (val checked = RecipeUrl.normalize(resolved)) {
                is UrlResult.Ok -> checked.url
                is UrlResult.Rejected -> throw FetchException(BAD_REDIRECT)
            }
        }

        /** Reads at most [maxBytes]; a page bigger than that is truncated, not refused. */
        internal fun readCapped(stream: InputStream, maxBytes: Int): ByteArray {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                val room = maxBytes - total
                if (read >= room) {
                    out.write(buffer, 0, room)
                    break
                }
                out.write(buffer, 0, read)
                total += read
            }
            return out.toByteArray()
        }

        private val charsetParameter = Regex("charset\\s*=\\s*\"?([A-Za-z0-9_.:-]+)", RegexOption.IGNORE_CASE)

        /** The charset the server declared, or UTF-8 when it declared none or an unknown one. */
        internal fun charsetOf(contentType: String?): Charset {
            val name = contentType?.let { charsetParameter.find(it)?.groupValues?.get(1) } ?: return Charsets.UTF_8
            return runCatching { Charset.forName(name) }.getOrDefault(Charsets.UTF_8)
        }
    }
}
