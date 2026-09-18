package com.chefvoice.app.util

import java.util.Locale

/**
 * What a chef can say to drive the cook-along screen with their hands in a bowl.
 *
 * [safeFromPartial] marks the commands that may fire on a partial recognition result.
 * Moving between steps is cheap and instantly reversible, so acting early feels
 * responsive. Anything that stops something -- the timer, hands-free itself -- waits
 * for a final result, because acting on a half-heard "stop" is the one mistake a chef
 * cannot undo by just saying the word again.
 */
enum class CookCommand(val safeFromPartial: Boolean) {
    NEXT(true),
    PREVIOUS(true),
    /** Says the current step once. Does not turn continuous reading on or off. */
    REPEAT(true),
    /** Turns continuous step reading on, which is what "read out loud" means. */
    READ_ALOUD(true),
    STOP_READING(false),
    START_TIMER(false),
    STOP_TIMER(false),
    STOP_LISTENING(false)
}

/**
 * Matches heard speech against a small, fixed command vocabulary.
 *
 * Deliberately literal, in the same spirit as the parser: a phrase either *is* one of
 * these commands or it is nothing. There is no fuzzy matching and no "closest
 * command", because a kitchen is full of speech that is not addressed to the phone,
 * and the cost of a false positive -- the screen jumping to another step mid-recipe --
 * is much higher than the cost of a chef having to repeat themselves.
 */
object CookCommands {
    private val exact: Map<String, CookCommand> = buildMap {
        listOf("next", "next step", "next one", "go next", "forward", "continue", "done")
            .forEach { put(it, CookCommand.NEXT) }
        listOf("back", "go back", "previous", "previous step", "last step", "back up")
            .forEach { put(it, CookCommand.PREVIOUS) }
        listOf("repeat", "repeat that", "say again", "say that again", "again", "what was that")
            .forEach { put(it, CookCommand.REPEAT) }
        // Turning reading on is its own command. "Repeat" used to double as the way to
        // switch it on, which meant the chef had to say a word that means "again" to
        // start something that had not happened yet.
        listOf(
            "read out loud", "read it out loud", "read aloud", "read this out loud",
            "read the steps", "read the step", "start reading", "read it to me", "read"
        ).forEach { put(it, CookCommand.READ_ALOUD) }
        listOf("stop reading", "stop reading out loud", "stop talking", "quiet", "be quiet")
            .forEach { put(it, CookCommand.STOP_READING) }
        listOf("start timer", "set timer", "start the timer", "timer", "start timer please")
            .forEach { put(it, CookCommand.START_TIMER) }
        listOf("stop timer", "cancel timer", "stop the timer", "reset timer")
            .forEach { put(it, CookCommand.STOP_TIMER) }
        listOf("stop listening", "hands free off", "stop hands free", "chef voice stop")
            .forEach { put(it, CookCommand.STOP_LISTENING) }
    }

    /** Words fed to the recognizer as biasing hints, so it favours the vocabulary. */
    val biasingWords: List<String> = exact.keys.toList()

    /**
     * Returns the command in [heard], or null when the chef was talking about
     * something else.
     *
     * A phrase matches when, stripped of punctuation and filler, it *is* a command.
     * A command buried in a longer sentence is ignored on purpose: "the next thing you
     * want to do is add the garlic" contains "next" but is narration, not an
     * instruction to the phone.
     */
    fun match(heard: String): CookCommand? {
        val clean = normalize(heard)
        if (clean.isEmpty()) return null
        exact[clean]?.let { return it }
        // One leading politeness marker is tolerated, since it is how people
        // actually address a device, but nothing longer.
        val stripped = clean
            .removePrefix("chef voice ")
            .removePrefix("chefvoice ")
            .removePrefix("ok ")
            .removePrefix("okay ")
            .removePrefix("please ")
            .trim()
        return exact[stripped]
    }

    private fun normalize(raw: String): String = raw
        .lowercase(Locale.ROOT)
        .filter { it.isLetterOrDigit() || it.isWhitespace() }
        .replace(Regex("\\s+"), " ")
        .trim()
}
