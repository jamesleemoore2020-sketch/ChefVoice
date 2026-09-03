package com.chefvoice.app.voice

import com.chefvoice.app.model.Ingredient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecondPassReviewerTest {
    @Test
    fun realDeviceSecondPassCleansLegacyLiveArtifactsWithoutSilentRewrite() {
        val live = listOf(
            Ingredient(quantity = "1", unit = "cup", name = "Chicken broth gonna"),
            Ingredient(quantity = "2", unit = "tbsp", name = "Salt"),
            Ingredient(quantity = "2", unit = "tbsp", name = "Pepper You gonna"),
            Ingredient(quantity = "1", unit = "cup", name = "Full of chicken stock"),
            Ingredient(name = "Add")
        )
        val transcript = "All right, so you're going to add 1 cup of chicken broth. " +
            "You're going to add 2 tbsp of salt and pepper. " +
            "You're going to add 1 cupful of chicken stock."

        val result = SecondPassReviewer.fromCloudTranscript(
            liveIngredients = live,
            transcript = transcript,
            rawSegments = listOf(transcript)
        )

        assertEquals(
            listOf(
                listOf("1", "cup", "Chicken broth"),
                listOf("2", "tbsp", "Salt"),
                listOf("2", "tbsp", "Pepper"),
                listOf("1", "cup", "Chicken stock")
            ),
            result.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertEquals(3, result.issues.count { it.type == "ingredient-name-cleanup" })
        assertFalse(result.issues.any { it.type == "possible-missed-ingredient" })
        assertFalse(result.issues.any { it.detail.contains("heard Add", ignoreCase = true) })

        // Review remains explicit. Nothing changes until "Use second pass" is chosen.
        assertEquals("Chicken broth gonna", live[0].name)
        val firstCleanup = result.issues.first { it.type == "ingredient-name-cleanup" }
        val accepted = SecondPassReviewer.applySuggestion(live, firstCleanup)
        assertEquals("Chicken broth", accepted[firstCleanup.liveIndex].name)
    }

    @Test
    fun quantityDisagreementIsReviewOnlyUntilAccepted() {
        val live = listOf(Ingredient(quantity = "1", unit = "cup", name = "Chicken stock"))
        val second = listOf(Ingredient(quantity = "2", unit = "cup", name = "Chicken stock"))

        val review = SecondPassReviewer.buildReview(live, second)
        val issue = review.issues.single()

        // The emitted type is "quantity-change" and has been since the card title
        // became "Quantity changed". "measurement-disagreement" is the pre-rename
        // name, still accepted by applySuggestion for reviews saved by older builds.
        assertEquals("quantity-change", issue.type)
        assertEquals("1", live.single().quantity)
        assertEquals("2", SecondPassReviewer.applySuggestion(live, issue).single().quantity)
    }

    @Test
    fun strongSecondPassOnlyIngredientIsOfferedAsPossibleMiss() {
        val review = SecondPassReviewer.buildReview(
            liveIngredients = listOf(Ingredient(quantity = "1", unit = "cup", name = "Chicken broth")),
            secondIngredients = listOf(
                Ingredient(quantity = "1", unit = "cup", name = "Chicken broth"),
                Ingredient(quantity = "1", unit = "tsp", name = "Cumin")
            )
        )

        assertTrue(review.issues.any { it.type == "possible-missed-ingredient" && it.suggested?.name == "Cumin" })
    }

    @Test
    fun screenshotNarrationProducesFiveCleanSecondPassIngredients() {
        val transcript = "So today we going to make some Chef Boyardee. " +
            "So what you need to do is take 2 tbsp of paprika, 3 tbsp of wood fired garlic, oh shit we did have garlic. " +
            "Um, 2 tbsp of pepper and 1 tbsp spoon of salt. " +
            "And then you need to mix this with 1 lb of ground beef. " +
            "Mix it thoroughly, frying the ground beef out. " +
            "And then you cook the ground beef as if it was a burger patty. " +
            "You cook the ground beef for about 20 minutes making sure you flip it about 10 minutes in. " +
            "After that you let it rest for about 5 minutes and it's ready to go."

        val result = SecondPassReviewer.fromCloudTranscript(
            liveIngredients = emptyList(),
            transcript = transcript,
            rawSegments = listOf(transcript)
        )

        assertEquals(
            listOf(
                listOf("2", "tbsp", "Paprika"),
                listOf("3", "tbsp", "Wood fired garlic"),
                listOf("2", "tbsp", "Pepper"),
                listOf("1", "tbsp", "Salt"),
                listOf("1", "lb", "Ground beef")
            ),
            result.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
    }

    @Test
    fun obviousOldLiveParserGarbageGetsExplicitRemoveArtifactAction() {
        val live = listOf(
            Ingredient(quantity = "2", unit = "tbsp", name = "Paprika"),
            Ingredient(quantity = "3", unit = "tbsp", name = "Wood fired garlic"),
            Ingredient(quantity = "3", unit = "tbsp", name = "Wood fired garlic oh shit we did have fun um"),
            Ingredient(quantity = "1", unit = "tbsp", name = "Of"),
            Ingredient(name = "Today we're gonna make some So what you need to do"),
            Ingredient(quantity = "5", name = "Minutes and it's ready to go")
        )
        val second = listOf(
            Ingredient(quantity = "2", unit = "tbsp", name = "Paprika"),
            Ingredient(quantity = "3", unit = "tbsp", name = "Wood fired garlic")
        )

        val review = SecondPassReviewer.buildReview(live, second)
        val artifacts = review.issues.filter { it.type == "remove-live-artifact" }
        assertTrue(artifacts.size >= 4)

        val first = artifacts.first()
        val cleaned = SecondPassReviewer.applySuggestion(live, first)
        assertEquals(live.size - 1, cleaned.size)
    }

    @Test
    fun matchingMethodStepIsConfirmedWithoutRewrite() {
        val live = listOf("Mix the ground beef thoroughly.")
        val second = listOf("Mix ground beef thoroughly.")

        val review = SecondPassReviewer.buildMethodReview(live, second)

        assertEquals(1, review.confirmedCount)
        assertTrue(review.issues.isEmpty())
        assertEquals("Mix the ground beef thoroughly.", live.single())
    }

    @Test
    fun secondPassOnlyMethodStepIsExplicitPossibleMiss() {
        val live = listOf("Brown the ground beef.")
        val second = listOf("Brown the ground beef.", "Let it rest for 5 minutes.")

        val review = SecondPassReviewer.buildMethodReview(live, second)
        val issue = review.issues.single { it.type == "possible-missed-step" }

        assertEquals("Let it rest for 5 minutes.", issue.suggestedStep)
        assertEquals(1, live.size)
        val accepted = SecondPassReviewer.applyMethodSuggestion(live, issue)
        assertEquals(listOf("Brown the ground beef.", "Let it rest for 5 minutes."), accepted)
    }

    @Test
    fun materiallyDifferentMethodWordingRequiresReviewBeforeReplacement() {
        val live = listOf("Cook ground beef for 20 minutes.")
        val second = listOf("Cook ground beef for 20 minutes, flipping halfway.")

        val review = SecondPassReviewer.buildMethodReview(live, second)
        val issue = review.issues.single()

        assertEquals("method-wording-disagreement", issue.type)
        assertEquals("Cook ground beef for 20 minutes.", live.single())
        assertEquals("Cook ground beef for 20 minutes, flipping halfway.", SecondPassReviewer.applyMethodSuggestion(live, issue).single())
    }

    @Test
    fun liveOnlyMethodStepIsSurfacedWithoutDeleteAction() {
        val review = SecondPassReviewer.buildMethodReview(
            liveSteps = listOf("Season with salt."),
            secondSteps = emptyList()
        )

        val issue = review.issues.single()
        assertEquals("live-only-step", issue.type)
        assertEquals(null, issue.suggestedStep)
        assertEquals(listOf("Season with salt."), SecondPassReviewer.applyMethodSuggestion(listOf("Season with salt."), issue))
    }

    @Test
    fun expandedSecondPassMethodDetailPairsAsWordingReview() {
        val review = SecondPassReviewer.buildMethodReview(
            liveSteps = listOf("Cook the ground beef for 20 minutes."),
            secondSteps = listOf("Cook the ground beef for 20 minutes making sure you flip it about 10 minutes in.")
        )

        assertEquals(1, review.issues.size)
        assertEquals("method-wording-disagreement", review.issues.single().type)
    }

    @Test
    fun realDeviceActuallyMethodCorrectionOffersOnlyTheCorrectedStep() {
        val live = listOf(
            "Add chicken to the pan.",
            "Cook for 10 minutes Actually Cooked for 20 minutes the flip halfway."
        )
        val second = listOf(
            "Add chicken to the pan.",
            "Cook for 10 minutes.",
            "Cook for 20 minutes and flip halfway."
        )

        val review = SecondPassReviewer.buildMethodReview(live, second)

        assertEquals(1, review.confirmedCount)
        assertEquals(1, review.issues.size)
        val issue = review.issues.single()
        assertEquals("method-wording-disagreement", issue.type)
        assertEquals("Check corrected method", issue.title)
        assertEquals(1, issue.liveIndex)
        assertEquals(2, issue.secondIndex)
        assertEquals("Cook for 20 minutes and flip halfway.", issue.suggestedStep)
        assertFalse(review.issues.any { it.type == "possible-missed-step" })
        assertEquals(
            listOf("Add chicken to the pan.", "Cook for 20 minutes and flip halfway."),
            SecondPassReviewer.applyMethodSuggestion(live, issue)
        )
    }


    @Test
    fun acceptedRealDeviceMethodCorrectionDoesNotResurrectSupersededStep() {
        val transcript = "Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway."
        val live = listOf(
            "Add chicken to the pan.",
            "Cook for 10 minutes Actually Cooked for 20 minutes the flip halfway."
        )
        val second = listOf(
            "Add chicken to the pan.",
            "Cook for 10 minutes.",
            "Cook for 20 minutes and flip halfway."
        )

        val initial = SecondPassReviewer.buildMethodReview(live, second, transcript)
        val accepted = SecondPassReviewer.applyMethodSuggestion(live, initial.issues.single())
        assertEquals(
            listOf("Add chicken to the pan.", "Cook for 20 minutes and flip halfway."),
            accepted
        )

        val rebuilt = SecondPassReviewer.buildMethodReview(accepted, second, transcript)
        assertEquals(2, rebuilt.confirmedCount)
        assertTrue(rebuilt.issues.isEmpty())
    }

    @Test
    fun rerunAfterAcceptedMethodCorrectionStaysClean() {
        val transcript = "Add chicken to the pan and cook for 10 minutes. Actually, cook for 20 minutes and flip halfway."
        val acceptedLive = listOf(
            "Add chicken to the pan.",
            "Cook for 20 minutes and flip halfway."
        )
        val second = listOf(
            "Add chicken to the pan.",
            "Cook for 10 minutes.",
            "Cook for 20 minutes and flip halfway."
        )

        val rerun = SecondPassReviewer.buildMethodReview(acceptedLive, second, transcript)
        assertEquals(2, rerun.confirmedCount)
        assertTrue(rerun.issues.isEmpty())
    }


    @Test
    fun temperatureFactIsNeverOfferedAsPossibleIngredient() {
        val review = SecondPassReviewer.buildReview(
            liveIngredients = emptyList(),
            secondIngredients = listOf(Ingredient(name = "375°"))
        )

        assertTrue(review.issues.isEmpty())
        assertEquals(0, review.confirmedCount)
    }

    @Test
    fun realDevice0912AlignsCompositeSecondPassMethodToNeighboringLiveSteps() {
        val live = listOf(
            "Make four burger patties.",
            "Split them evenly.",
            "Shake them.",
            "Pat them down.",
            "Season both sides with two tablespoon of salt one tablespoon of pepper one tablespoon of garlic one tablespoon of lemon pepper.",
            "Cook them at 375 degrees for 20 minutes.",
            "In between.",
            "Let them rest for five minutes before serving."
        )
        val second = listOf(
            "Make four burger patties.",
            "Split them evenly.",
            "Shape them, and pack them down.",
            "Season both sides with 2 tbsp of salt, 1 tbsp of pepper, 1 tbsp of garlic, and 1 tbsp of lemon pepper.",
            "Cook them at 375 degrees for 20 minutes.",
            "Flip them in between.",
            "Let them rest for 5 minutes before serving."
        )

        val review = SecondPassReviewer.buildMethodReview(live, second)

        assertFalse(review.issues.any { it.type == "live-only-step" && it.liveIndex == 2 })
        val shape = review.issues.single { it.liveIndex == 2 }
        assertEquals("method-wording-disagreement", shape.type)
        assertEquals("Shape them.", shape.suggestedStep)
        val pack = review.issues.single { it.liveIndex == 3 }
        assertEquals("Pack them down.", pack.suggestedStep)
        assertFalse(review.issues.any { (it.suggestedStep ?: "").contains("Let them rest", ignoreCase = true) })
        assertFalse(review.issues.any { (it.suggestedStep ?: "").contains("Season both sides", ignoreCase = true) })
        val flip = review.issues.single { it.liveIndex == 6 }
        assertEquals("Flip them in between.", flip.suggestedStep)
    }

    @Test
    fun accepted0912NeighboringMethodCorrectionsRebuildCleanly() {
        val second = listOf(
            "Make four burger patties.",
            "Split them evenly.",
            "Shape them, and pack them down.",
            "Season both sides with 2 tbsp of salt, 1 tbsp of pepper, 1 tbsp of garlic, and 1 tbsp of lemon pepper.",
            "Cook them at 375 degrees for 20 minutes.",
            "Flip them in between.",
            "Let them rest for 5 minutes before serving."
        )
        var live = listOf(
            "Make four burger patties.",
            "Split them evenly.",
            "Shake them.",
            "Pat them down.",
            "Season both sides with two tablespoon of salt one tablespoon of pepper one tablespoon of garlic one tablespoon of lemon pepper.",
            "Cook them at 375 degrees for 20 minutes.",
            "In between.",
            "Let them rest for five minutes before serving."
        )
        val initial = SecondPassReviewer.buildMethodReview(live, second)
        for (liveIndex in listOf(2, 3, 6)) {
            val issue = initial.issues.single { it.liveIndex == liveIndex }
            live = SecondPassReviewer.applyMethodSuggestion(live, issue)
        }
        val rebuilt = SecondPassReviewer.buildMethodReview(live, second)
        assertEquals(8, rebuilt.confirmedCount)
        assertTrue(rebuilt.issues.isEmpty())
    }

}
