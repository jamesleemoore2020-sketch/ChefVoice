package com.chefvoice.app.util

/**
 * A cooking duration found verbatim in a finished method step.
 *
 * [label] is the text exactly as the chef said it, so a timer offered for
 * "simmer for 10 to 12 minutes" reads "10 to 12 minutes" rather than a number the
 * chef never used.
 */
data class StepTimer(
    val label: String,
    val totalSeconds: Int,
    val startIndex: Int
)

/**
 * Finds the durations already present in a method step so the cook-along screen can
 * offer them as timers.
 *
 * This is a **read-only extractor over finished step text**. It is deliberately not
 * part of `CookingSessionParser`: it never edits a step, never contributes to what is
 * saved, and running it or not running it cannot change a single row of
 * `shared/golden-cooking-corpus.tsv`. The parser's own duration handling stays where
 * it is and is not reused here, because that code sums one duration per step for the
 * prep/cook estimate, while a timer needs every duration in the step along with where
 * in the text it sits.
 *
 * It is as literal as the rest of the pipeline. A duration is only recognised when
 * the chef actually stated a number and a time unit; nothing is inferred from a verb,
 * and an unrecognised phrase simply yields no timer rather than a guessed one. Being
 * wrong here means a kitchen timer that ends at the wrong moment, so the bar for
 * matching is high and the failure mode is always "no timer offered".
 */
object StepTimers {
    private val numberWords = mapOf(
        "one" to 1.0, "two" to 2.0, "three" to 3.0, "four" to 4.0, "five" to 5.0,
        "six" to 6.0, "seven" to 7.0, "eight" to 8.0, "nine" to 9.0, "ten" to 10.0,
        "eleven" to 11.0, "twelve" to 12.0, "thirteen" to 13.0, "fourteen" to 14.0,
        "fifteen" to 15.0, "sixteen" to 16.0, "seventeen" to 17.0, "eighteen" to 18.0,
        "nineteen" to 19.0, "twenty" to 20.0, "thirty" to 30.0, "forty" to 40.0,
        "fifty" to 50.0, "sixty" to 60.0, "ninety" to 90.0,
        "half" to 0.5, "quarter" to 0.25
    )

    private const val NUMBER = "\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?|one|two|three|four|five|six|seven|" +
        "eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|" +
        "twenty|thirty|forty|fifty|sixty|ninety|half|quarter"

    /**
     * Matches "20 minutes", "10 to 12 minutes", "1 1/2 hours", "half an hour".
     *
     * The optional second number is what makes a range work. A chef who says a range
     * is describing a window, not one instant, and the timer uses the **lower** bound
     * (see [rangeUsesLowerBound]) so it goes off while there is still something to
     * check rather than after the food is past it.
     */
    private val durationPattern = Regex(
        "(?i)\\b(" + NUMBER + ")" +
            "(?:\\s+(\\d+\\s*/\\s*\\d+))?" +
            "(?:\\s*(?:-|–|to|or)\\s*(" + NUMBER + "))?" +
            "\\s*(?:an?\\s+)?" +
            "(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b"
    )

    /**
     * A range timer counts the lower bound. "Simmer 10 to 12 minutes" should call the
     * chef back at 10 so they can look at the pan, not at 12 when the decision has
     * already been made for them.
     */
    const val rangeUsesLowerBound = true

    /** Every duration in [step], in the order the chef said them. */
    fun timersIn(step: String): List<StepTimer> {
        if (step.isBlank()) return emptyList()
        return durationPattern.findAll(step).mapNotNull { match ->
            val whole = match.groupValues[1]
            val fraction = match.groupValues[2]
            val rangeEnd = match.groupValues[3]
            val unit = match.groupValues[4]

            val base = amountOf(whole) ?: return@mapNotNull null
            // "1 1/2 hours" -- a whole number followed by a bare fraction.
            val amount = if (fraction.isNotBlank()) base + (amountOf(fraction) ?: 0.0) else base
            // A range keeps the lower of the two, which for a well-formed range is
            // the first. A reversed range ("12 to 10") is still read as lower-first
            // rather than reordered, because reordering would be interpreting.
            val effective = if (rangeEnd.isNotBlank() && !rangeUsesLowerBound) {
                amountOf(rangeEnd) ?: amount
            } else {
                amount
            }

            val seconds = secondsFor(effective, unit) ?: return@mapNotNull null
            if (seconds <= 0) return@mapNotNull null
            // Nothing in a kitchen is usefully timed beyond a day, and a match that
            // long is far more likely to be a misread number than a real instruction.
            if (seconds > 24 * 60 * 60) return@mapNotNull null

            StepTimer(
                label = match.value.trim(),
                totalSeconds = seconds,
                startIndex = match.range.first
            )
        }.toList()
    }

    /** The first duration in [step], or null when the chef stated none. */
    fun firstTimerIn(step: String): StepTimer? = timersIn(step).firstOrNull()

    private fun amountOf(token: String): Double? {
        val clean = token.trim().lowercase()
        if (clean.isEmpty()) return null
        numberWords[clean]?.let { return it }
        // "1/2", "3 / 4"
        if (clean.contains('/')) {
            val parts = clean.split('/')
            if (parts.size != 2) return null
            val numerator = parts[0].trim().toDoubleOrNull() ?: return null
            val denominator = parts[1].trim().toDoubleOrNull() ?: return null
            if (denominator == 0.0) return null
            return numerator / denominator
        }
        return clean.toDoubleOrNull()
    }

    private fun secondsFor(amount: Double, unit: String): Int? {
        val lower = unit.lowercase()
        val multiplier = when {
            lower.startsWith("sec") -> 1.0
            lower.startsWith("min") -> 60.0
            lower.startsWith("hour") || lower.startsWith("hr") -> 3600.0
            else -> return null
        }
        val seconds = amount * multiplier
        if (seconds.isNaN() || seconds.isInfinite()) return null
        return Math.round(seconds).toInt()
    }

    /** "1:05:00", "20:00", "0:45" -- how a running timer reads on screen. */
    fun formatClock(totalSeconds: Int): String {
        val safe = totalSeconds.coerceAtLeast(0)
        val hours = safe / 3600
        val minutes = (safe % 3600) / 60
        val seconds = safe % 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds)
        else "%d:%02d".format(minutes, seconds)
    }
}
