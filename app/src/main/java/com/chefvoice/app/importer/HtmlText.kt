package com.chefvoice.app.importer

/**
 * Turns the markup-flavoured strings a recipe page embeds in its data -- "Fold in the
 * egg&#39;s yolk<br>then chill" -- into plain text.
 *
 * Recipe plugins routinely leave HTML entities and stray tags inside their structured
 * data, so nearly every text field goes through here before it reaches a recipe.
 */
internal object HtmlText {
    private val namedEntities = mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'",
        "nbsp" to " ", "ensp" to " ", "emsp" to " ", "thinsp" to " ",
        "ndash" to "–", "mdash" to "—", "hellip" to "…",
        "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”",
        "deg" to "°", "times" to "×", "middot" to "·", "bull" to "•",
        "frac12" to "½", "frac14" to "¼", "frac34" to "¾",
        "eacute" to "é", "egrave" to "è", "ecirc" to "ê", "agrave" to "à",
        "acirc" to "â", "ccedil" to "ç", "ntilde" to "ñ", "uuml" to "ü",
        "ouml" to "ö", "auml" to "ä", "iacute" to "í", "oacute" to "ó",
        "aacute" to "á", "uacute" to "ú", "reg" to "®", "trade" to "™"
    )

    private val entity = Regex("&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);")

    /** Line-ending tags become newlines so "step one<br>step two" stays two lines. */
    private val lineBreakTag = Regex("(?i)<br\\s*/?>|</(?:p|li|div|h[1-6]|tr)\\s*>")

    /**
     * Only `<` followed by a letter, `/` or `!` opens a tag. A bare "<" in "bake < 20
     * minutes" is text, and treating it as a tag would swallow everything up to the next
     * ">" on the page.
     */
    private val anyTag = Regex("<(?:!--.*?--|/?[A-Za-z][^>]*)>", RegexOption.DOT_MATCHES_ALL)

    fun decodeEntities(input: String): String {
        var text = input
        // Twice, because some sites encode an already-encoded string ("&amp;#39;").
        repeat(2) {
            if (!text.contains('&')) return text
            text = entity.replace(text) { match ->
                val body = match.groupValues[1]
                val decoded = when {
                    body.startsWith("#x") || body.startsWith("#X") -> codePoint(body.substring(2).toIntOrNull(16))
                    body.startsWith("#") -> codePoint(body.substring(1).toIntOrNull())
                    else -> namedEntities[body]
                }
                decoded ?: match.value
            }
        }
        return text
    }

    private fun codePoint(value: Int?): String? {
        if (value == null || value <= 0 || value > 0x10FFFF) return null
        if (value in 0xD800..0xDFFF) return null
        return String(Character.toChars(value))
    }

    /** Trimmed, non-empty lines of plain text. Markup is stripped and entities decoded. */
    fun lines(input: String): List<String> {
        val withBreaks = lineBreakTag.replace(input, "\n")
        val noTags = anyTag.replace(withBreaks, "")
        return decodeEntities(noTags)
            .replace("\r\n", "\n")
            .replace('\r', '\n')
            .split('\n')
            .map { it.replace(' ', ' ').replace(Regex("[ \\t]+"), " ").trim() }
            .filter { it.isNotEmpty() }
    }

    /** [lines] flattened into a single line. */
    fun line(input: String): String = lines(input).joinToString(" ")
}
