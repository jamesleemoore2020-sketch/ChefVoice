package com.chefvoice.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The expensive mistake here is a false positive. A kitchen is full of speech that is
 * not addressed to the phone, and a screen that jumps to another step mid-recipe is
 * far worse than one that makes the chef say "next" twice. These tests pin the
 * matching as literal, and pin the specific narration phrases that must *not* fire.
 */
class CookCommandsTest {
    @Test
    fun matchesTheCommandsAChefWouldActuallySay() {
        assertEquals(CookCommand.NEXT, CookCommands.match("next"))
        assertEquals(CookCommand.NEXT, CookCommands.match("next step"))
        assertEquals(CookCommand.PREVIOUS, CookCommands.match("go back"))
        assertEquals(CookCommand.REPEAT, CookCommands.match("say that again"))
        assertEquals(CookCommand.START_TIMER, CookCommands.match("start timer"))
        assertEquals(CookCommand.STOP_TIMER, CookCommands.match("cancel timer"))
        assertEquals(CookCommand.STOP_LISTENING, CookCommands.match("stop listening"))
    }

    @Test
    fun ignoresCaseAndPunctuation() {
        assertEquals(CookCommand.NEXT, CookCommands.match("Next!"))
        assertEquals(CookCommand.NEXT, CookCommands.match("  NEXT  STEP  "))
        assertEquals(CookCommand.REPEAT, CookCommands.match("Repeat, that."))
    }

    @Test
    fun toleratesOneLeadingPolitenessMarker() {
        assertEquals(CookCommand.NEXT, CookCommands.match("ok next"))
        assertEquals(CookCommand.NEXT, CookCommands.match("chef voice next step"))
        assertEquals(CookCommand.PREVIOUS, CookCommands.match("please go back"))
    }

    @Test
    fun ignoresACommandWordBuriedInNarration() {
        // This is the whole reason the match is literal. A chef explaining the recipe
        // out loud uses every one of these words, and none of them are instructions.
        assertNull(CookCommands.match("the next thing you want to do is add the garlic"))
        assertNull(CookCommands.match("back in the pan with the onions"))
        assertNull(CookCommands.match("repeat this with the second batch"))
        assertNull(CookCommands.match("give the timer another few minutes"))
    }

    @Test
    fun ignoresEverydayKitchenSpeech() {
        assertNull(CookCommands.match("can you pass me the salt"))
        assertNull(CookCommands.match("that smells amazing"))
        assertNull(CookCommands.match(""))
        assertNull(CookCommands.match("   "))
    }

    @Test
    fun onlyReversibleCommandsMayFireOnAPartialResult() {
        // Stepping is instantly undoable, so firing early feels responsive. Stopping
        // something is not, so a half-heard "stop" must wait for a final result.
        assertTrue(CookCommand.NEXT.safeFromPartial)
        assertTrue(CookCommand.PREVIOUS.safeFromPartial)
        assertTrue(CookCommand.REPEAT.safeFromPartial)
        assertFalse(CookCommand.START_TIMER.safeFromPartial)
        assertFalse(CookCommand.STOP_TIMER.safeFromPartial)
        assertFalse(CookCommand.STOP_LISTENING.safeFromPartial)
    }

    @Test
    fun everyCommandHasBiasingWords() {
        // The recognizer is told what to expect. A command with no hint is one the
        // recognizer will reliably mishear.
        CookCommand.values().forEach { command ->
            assertTrue(
                "no biasing phrase maps to $command",
                CookCommands.biasingWords.any { CookCommands.match(it) == command }
            )
        }
    }
}
