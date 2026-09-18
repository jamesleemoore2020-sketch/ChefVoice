package com.chefvoice.app.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The review ceiling is a cost control, not a feature flag: cloud speech is billed per
 * minute of audio, so this constant is what decides what one ChefVoice Review costs.
 * Nothing in the app breaks if it creeps back up, the bill just grows, which is exactly
 * the kind of regression that goes unnoticed without a test.
 *
 * The matching PWA assertions live in web/tests/second-pass-cost.test.mjs, which also
 * checks this file so the two clients cannot drift apart.
 */
class SecondPassLimitsTest {
    @Test
    fun oneReviewSendsAtMostFiveMinutesOfAudio() {
        assertEquals(5L * 60L * 1000L, SecondPassLimits.MAX_REVIEW_DURATION_MS)
    }

    @Test
    fun theMinuteLabelIsDerivedFromTheCeilingItDescribes() {
        // Recipe and paywall copy quote this. Hard-coding the number in the copy is how
        // a lowered cap ends up advertised at its old value.
        assertEquals(5L, SecondPassLimits.MAX_REVIEW_MINUTES)
        assertEquals(SecondPassLimits.MAX_REVIEW_DURATION_MS / 60_000L, SecondPassLimits.MAX_REVIEW_MINUTES)
    }

    @Test
    fun theReviewCeilingIsNotATierLever() {
        // Free and Pro differ in how many reviews a chef may run, never in how much
        // audio one review may send, so there is a single ceiling and no Pro variant.
        assertTrue(FreeTierLimits.SECOND_PASS_PER_MONTH < ProTierLimits.SECOND_PASS_PER_MONTH)
    }

    @Test
    fun theReviewCeilingIsFarBelowTheStorageCeiling() {
        // The private cloud copy written at publish time is still allowed 90 minutes.
        // Collapsing the two back into one number would either make reviews expensive
        // again or stop long sessions being published at all.
        val publishStorageCeilingMs = 90L * 60L * 1000L
        assertTrue(SecondPassLimits.MAX_REVIEW_DURATION_MS < publishStorageCeilingMs)
    }
}
