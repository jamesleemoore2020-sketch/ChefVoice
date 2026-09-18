package com.chefvoice.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A wrong timer is worse than no timer: it calls the chef back to the pan at the wrong
 * moment and they trust it. So the rule these tests pin is that a duration is only
 * recognised when the chef actually stated a number and a time unit, and anything else
 * yields nothing at all rather than a guess.
 */
class StepTimersTest {
    @Test
    fun readsAPlainMinuteDuration() {
        val timer = StepTimers.firstTimerIn("Simmer for 20 minutes until thickened")
        assertEquals(20 * 60, timer?.totalSeconds)
        assertEquals("20 minutes", timer?.label)
    }

    @Test
    fun readsSecondsAndHours() {
        assertEquals(45, StepTimers.firstTimerIn("Blanch for 45 seconds")?.totalSeconds)
        assertEquals(2 * 3600, StepTimers.firstTimerIn("Roast for 2 hours")?.totalSeconds)
    }

    @Test
    fun readsTheAbbreviationsChefsActuallySay() {
        assertEquals(10 * 60, StepTimers.firstTimerIn("Rest 10 mins")?.totalSeconds)
        assertEquals(90, StepTimers.firstTimerIn("Pulse for 90 secs")?.totalSeconds)
        assertEquals(3600, StepTimers.firstTimerIn("Chill for 1 hr")?.totalSeconds)
    }

    @Test
    fun readsSpokenNumberWords() {
        // The parser leaves number words verbatim when that is what was said, so a
        // timer has to understand them too or the feature silently misses half the
        // real transcripts.
        assertEquals(15 * 60, StepTimers.firstTimerIn("Bake for fifteen minutes")?.totalSeconds)
    }

    @Test
    fun aRangeTimesTheLowerBound() {
        // "10 to 12 minutes" should call the chef back at 10, while there is still a
        // decision to make, rather than at 12 when it has been made for them.
        val timer = StepTimers.firstTimerIn("Saute for 10 to 12 minutes")
        assertEquals(10 * 60, timer?.totalSeconds)
        // The label still shows the whole range the chef said.
        assertEquals("10 to 12 minutes", timer?.label)
    }

    @Test
    fun readsHyphenatedRanges() {
        assertEquals(5 * 60, StepTimers.firstTimerIn("Fry for 5-7 minutes")?.totalSeconds)
    }

    @Test
    fun readsMixedFractions() {
        assertEquals((1.5 * 3600).toInt(), StepTimers.firstTimerIn("Braise for 1 1/2 hours")?.totalSeconds)
        assertEquals(30 * 60, StepTimers.firstTimerIn("Rest for 1/2 hour")?.totalSeconds)
        assertEquals(30 * 60, StepTimers.firstTimerIn("Prove for half an hour")?.totalSeconds)
    }

    @Test
    fun findsEveryDurationInAStepNotJustTheFirst() {
        // The prep/cook estimate in the parser only needs one duration per step. A
        // cook-along screen needs all of them, which is why this is separate code.
        val timers = StepTimers.timersIn("Sear for 3 minutes, then simmer for 25 minutes")
        assertEquals(2, timers.size)
        assertEquals(3 * 60, timers[0].totalSeconds)
        assertEquals(25 * 60, timers[1].totalSeconds)
        assertTrue(timers[0].startIndex < timers[1].startIndex)
    }

    @Test
    fun offersNothingWhenTheChefStatedNoDuration() {
        assertNull(StepTimers.firstTimerIn("Season generously with salt and pepper"))
        assertNull(StepTimers.firstTimerIn("Cook until the onions are soft"))
        assertNull(StepTimers.firstTimerIn(""))
    }

    @Test
    fun aBareNumberWithNoTimeUnitIsNotATimer() {
        // "2 cups" and "350 degrees" are not durations. Treating any number as one
        // would put a bogus timer on nearly every step.
        assertNull(StepTimers.firstTimerIn("Add 2 cups of flour"))
        assertNull(StepTimers.firstTimerIn("Preheat the oven to 350 degrees"))
        assertNull(StepTimers.firstTimerIn("Cut into 4 pieces"))
    }

    @Test
    fun rejectsDurationsNoKitchenWouldUse() {
        // A match this long is far more likely to be a misread number than a real
        // instruction, and a 40-hour countdown helps nobody.
        assertNull(StepTimers.firstTimerIn("Ferment for 400 hours"))
    }

    @Test
    fun clockFormatsTheWayATimerReads() {
        assertEquals("20:00", StepTimers.formatClock(20 * 60))
        assertEquals("0:45", StepTimers.formatClock(45))
        assertEquals("1:05:00", StepTimers.formatClock(3900))
        assertEquals("0:00", StepTimers.formatClock(0))
        // A countdown that overshoots must not render a negative clock.
        assertEquals("0:00", StepTimers.formatClock(-30))
    }
}
