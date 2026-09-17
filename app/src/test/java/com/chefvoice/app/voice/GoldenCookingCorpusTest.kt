package com.chefvoice.app.voice

import com.chefvoice.app.model.TranscriptSegment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class GoldenCookingCorpusTest {
    private fun corpusFile(): File {
        var dir = File(System.getProperty("user.dir"))
        repeat(6) {
            val candidate = File(dir, "shared/golden-cooking-corpus.tsv")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        error("Could not find shared/golden-cooking-corpus.tsv from ${System.getProperty("user.dir")}")
    }

    private fun expectedIngredients(raw: String): List<List<String>> {
        if (raw == "-") return emptyList()
        return raw.split(" ;; ").map { row ->
            val parts = row.split("^")
            listOf(
                parts.getOrElse(0) { "" },
                parts.getOrElse(1) { "" },
                parts.getOrElse(2) { "" }
            )
        }
    }

    @Test
    fun sharedGoldenCookingCorpusPassesOnAndroid() {
        val failures = mutableListOf<String>()
        val rows = corpusFile().readLines()
            .filter { it.isNotBlank() && !it.startsWith("#") }

        rows.forEach { line ->
            val columns = line.split("\t")
            require(columns.size >= 5) { "Malformed golden corpus row: $line" }
            val id = columns[0]
            val segments = columns[2].split(" || ").mapIndexed { index, text ->
                TranscriptSegment(elapsedMs = index * 1000L, text = text)
            }
            val expected = expectedIngredients(columns[3])
            val expectedStepFragments = if (columns[4] == "-") emptyList() else columns[4].split(" ;; ")
            val draft = CookingSessionParser.parse(segments)
            val actual = draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
            val missingSteps = expectedStepFragments.filterNot { fragment ->
                draft.steps.any { step -> step.contains(fragment, ignoreCase = true) }
            }

            if (actual != expected || missingSteps.isNotEmpty()) {
                failures += buildString {
                    append("[$id] expected ingredients=$expected actual=$actual")
                    if (missingSteps.isNotEmpty()) append(" missing step fragments=$missingSteps actual steps=${draft.steps}")
                }
            }
        }

        assertEquals("Golden corpus row count changed unexpectedly", 60, rows.size)
        assertTrue("Android golden corpus failures:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    @Test
    fun realBurgerFixturePreservesTemperatureDurationsAndChronologicalMethodOrder() {
        val text = "Okay, so today we're making hamburgers. We're going to take a pound of ground beef and you're going to make four different burger patties. " +
            "Split them all evenly, shape them well, and pat them down. Then we're going to take 2 tsp of salt and we're going to take 1 tsp of pepper. " +
            "Then take 1 tsp of garlic and 1 tsp of lemon pepper. And you're going to season your ground beef patties. " +
            "After you season your ground beef patties on both sides, then you're going to throw them on the oven at 375°. " +
            "You let it sit and cook for 20 minutes, flipping it in between. And when it's done, you let it sit and settle for 5 minutes and it's ready to eat."

        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = text)))

        assertEquals(
            listOf(
                listOf("1", "lb", "Ground beef"),
                listOf("2", "tsp", "Salt"),
                listOf("1", "tsp", "Pepper"),
                listOf("1", "tsp", "Garlic"),
                listOf("1", "tsp", "Lemon pepper")
            ),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertTrue(draft.ingredients.none { "${it.quantity} ${it.unit} ${it.name}".contains("375") || it.name.contains("°") })
        assertEquals("Hamburgers", draft.title)
        assertEquals(20, draft.cookMinutes)
        assertEquals(null, draft.prepMinutes)

        val expected = listOf(
            "make four different burger patties",
            "split them all evenly",
            "shape them well",
            "pat them down",
            "season your ground beef patties",
            "throw them on the oven at 375°",
            "cook for 20 minutes",
            "you let it sit and settle for 5 minutes"
        )
        var cursor = -1
        expected.forEach { fragment ->
            val next = draft.steps.indices.firstOrNull { index ->
                index > cursor && draft.steps[index].contains(fragment, ignoreCase = true)
            } ?: -1
            assertTrue(
                "Expected chronological step fragment '$fragment' after index $cursor; got ${draft.steps}",
                next > cursor
            )
            cursor = next
        }
    }

    @Test
    fun realTimestampedBurgerCaptureKeepsMethodBoundariesAndNormalizesTemperaturePreposition() {
        val segments = listOf(
            TranscriptSegment(elapsedMs = 5_000L, text = "Take one pound of ground beef"),
            TranscriptSegment(elapsedMs = 8_000L, text = "Make four burger patties"),
            TranscriptSegment(elapsedMs = 12_000L, text = "Split them evenly shape them"),
            TranscriptSegment(elapsedMs = 14_000L, text = "Pat them down"),
            TranscriptSegment(elapsedMs = 17_000L, text = "Season both sides"),
            TranscriptSegment(elapsedMs = 20_000L, text = "With two teaspoon of salt"),
            TranscriptSegment(elapsedMs = 23_000L, text = "One teaspoon of pepper"),
            TranscriptSegment(elapsedMs = 25_000L, text = "One teaspoon of garlic"),
            TranscriptSegment(elapsedMs = 28_000L, text = "And one teaspoon of lemon pepper"),
            TranscriptSegment(elapsedMs = 36_000L, text = "Cook them for 375 degrees for 20 minutes"),
            TranscriptSegment(elapsedMs = 39_000L, text = "Foot them in between"),
            TranscriptSegment(elapsedMs = 43_000L, text = "Let them rest with five we feel serving")
        )

        val draft = CookingSessionParser.parse(segments)

        assertEquals(
            listOf(
                listOf("1", "lb", "Ground beef"),
                listOf("2", "tsp", "Salt"),
                listOf("1", "tsp", "Pepper"),
                listOf("1", "tsp", "Garlic"),
                listOf("1", "tsp", "Lemon pepper")
            ),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertEquals(
            listOf(
                "Make four burger patties.",
                "Split them evenly.",
                "Shape them.",
                "Pat them down.",
                "Season both sides with two teaspoon of salt one teaspoon of pepper one teaspoon of garlic and one teaspoon of lemon pepper.",
                "Cook them at 375 degrees for 20 minutes.",
                "Foot them in between.",
                "Let them rest with five we feel serving."
            ),
            draft.steps
        )
        assertTrue(draft.steps.none { Regex("(?i)20 minutes.*(?:foot|rest)|foot.*rest").containsMatchIn(it) })
        assertEquals(
            "no opening announcement in this fixture -- must not invent one from \"Make four burger patties\"",
            "",
            draft.title
        )
        assertEquals(20, draft.cookMinutes)
    }


    @Test
    fun realIntraSegmentBurgerCaptureSplitsUnknownPredicatesAndTrimsIngredientNarrationTail() {
        val segments = listOf(
            TranscriptSegment(elapsedMs = 14_000L, text = "Say one pound of ground beef and make four burger patties split them evenly shape them and pet them down see them both sides with two tablespoon of salt"),
            TranscriptSegment(elapsedMs = 16_000L, text = "One tablespoon of pepper"),
            TranscriptSegment(elapsedMs = 21_000L, text = "Two tablespoon of garlic I want a tablespoon of lemon pepper"),
            TranscriptSegment(elapsedMs = 26_000L, text = "Cook them at 375 degrees for 20 minutes"),
            TranscriptSegment(elapsedMs = 28_000L, text = "In between"),
            TranscriptSegment(elapsedMs = 31_000L, text = "Let them rest for five minutes before serving")
        )

        val draft = CookingSessionParser.parse(segments)

        assertEquals(
            listOf(
                listOf("1", "lb", "Ground beef"),
                listOf("2", "tbsp", "Salt"),
                listOf("1", "tbsp", "Pepper"),
                listOf("2", "tbsp", "Garlic"),
                listOf("1", "tbsp", "Lemon pepper")
            ),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertEquals(
            listOf(
                "Make four burger patties.",
                "Split them evenly.",
                "Shape them.",
                "Pet them down.",
                "See them both sides with two tablespoon of salt.",
                "Cook them at 375 degrees for 20 minutes.",
                "In between.",
                "Let them rest for five minutes before serving."
            ),
            draft.steps
        )
        assertTrue(draft.ingredients.none { it.name.contains("i want", ignoreCase = true) })
        assertTrue(draft.steps.none { it.contains("pat them", ignoreCase = true) || it.contains("season both", ignoreCase = true) })
    }

    @Test
    fun realDurationContinuationAttachesAndIngredientArtifactsAreRejected() {
        val segments = listOf(
            TranscriptSegment(elapsedMs = 12_000L, text = "It took and make four burger patties split them evenly shaped them"),
            TranscriptSegment(elapsedMs = 17_000L, text = "Impact them down season both sides with two teaspoon of salt"),
            TranscriptSegment(elapsedMs = 20_000L, text = "One teaspoon of pepper"),
            TranscriptSegment(elapsedMs = 22_000L, text = "One teaspoon of garlic"),
            TranscriptSegment(elapsedMs = 25_000L, text = "And one tablespoon of lemon pepper"),
            TranscriptSegment(elapsedMs = 31_000L, text = "Cook them for 350 cook them at 375 degrees"),
            TranscriptSegment(elapsedMs = 33_000L, text = "For 20 minutes"),
            TranscriptSegment(elapsedMs = 35_000L, text = "Flipped in between"),
            TranscriptSegment(elapsedMs = 39_000L, text = "Let them rest for five minutes before serving")
        )
        val draft = CookingSessionParser.parse(segments)
        assertTrue(draft.steps.contains("Cook them for 350."))
        assertTrue(draft.steps.contains("Cook them at 375 degrees for 20 minutes."))
        assertTrue(draft.steps.none { it.startsWith("For 20 minutes", ignoreCase = true) })

        val grab = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 4_000L, text = "Take one grab")))
        assertTrue(grab.ingredients.isEmpty())

        val beef = CookingSessionParser.parse(listOf(
            TranscriptSegment(elapsedMs = 6_000L, text = "Take one pound of ground beef it took"),
            TranscriptSegment(elapsedMs = 9_000L, text = "One pound of ground beef")
        ))
        assertEquals(
            listOf(listOf("1", "lb", "Ground beef")),
            beef.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
    }

    /**
     * Real Android capture, 0909. Three ingredients were declared as
     * "you're going to need some X" and were being lost entirely.
     *
     * The second half of this fixture is the regression guard: a declaration segment
     * must not be swallowed into the preceding method step. "Sprinkle" arms the
     * ingredient-continuation branch in collectSegmentAwareSteps, which exists so
     * "season the patties" + "with salt and pepper" join up. A new declaration is not
     * a continuation of anything, and appending it produced the step
     * "Sprinkle it on top of your nachos then you're going to need some sour cream
     * need some hot sauce need some jalapenos."
     */
    @Test
    fun realNachosFixtureKeepsIngredientDeclarationsOutOfMethodSteps() {
        val segments = listOf(
            "Okay, today we're going to make some nachos",
            "One pack should feed at least two people, maybe three",
            "Then you're going to need 1 lb of ground beef",
            "Mix in 1 tsp of salt and pepper, 1 tsp of lemon pepper",
            "Then you take your ground beef and you sprinkle it on top of your nachos",
            "Then you're going to need some sour cream",
            "You're going to need some hot sauce",
            "You're going to need some jalapenos",
            "And it's ready to serve and eat"
        ).mapIndexed { index, text -> TranscriptSegment(elapsedMs = index * 3_000L, text = text) }

        val draft = CookingSessionParser.parse(segments)

        assertEquals(
            listOf(
                listOf("1", "lb", "Ground beef"),
                listOf("1", "tsp", "Salt and pepper"),
                listOf("1", "tsp", "Lemon pepper"),
                listOf("", "", "Sour cream"),
                listOf("", "", "Hot sauce"),
                listOf("", "", "Jalapenos")
            ),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )

        assertTrue(
            "sprinkle step should stand alone, got: ${draft.steps}",
            draft.steps.contains("Sprinkle it on top of your nachos.")
        )
        assertTrue(
            "no method step may absorb an ingredient declaration, got: ${draft.steps}",
            draft.steps.none { it.contains("need some", ignoreCase = true) }
        )
        assertEquals(
            "title announcement is split across segments 0 and 1 by ASR -- must not run on into \"One pack should feed...\"",
            "Nachos",
            draft.title
        )
    }

    // ---- Recipe title ---------------------------------------------------------

    @Test
    fun extractsTitleFromTodayImMakingX() {
        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = "today I'm making my famous chili")))
        assertEquals("Famous chili", draft.title)
    }

    // A chef dropping the copula ("we going to make") still announces a title, but
    // only for "make": without the auxiliary, "we going to cook X for 10 mins" is an
    // ordinary instruction, and taking it as the title would delete that step too.
    @Test
    fun droppedCopulaAnnouncesATitleOnlyForMake() {
        val announced = CookingSessionParser.parse(
            listOf(TranscriptSegment(elapsedMs = 0L, text = "so today we going to make my famous top ramen meal"))
        )
        assertEquals("Famous top ramen meal", announced.title)

        // Chefs say "do" for a dish just as readily as "make".
        val announcedWithDo = CookingSessionParser.parse(
            listOf(TranscriptSegment(elapsedMs = 0L, text = "so today we going to do my famous top ramen"))
        )
        assertEquals("Famous top ramen", announcedWithDo.title)

        val instruction = CookingSessionParser.parse(
            listOf(TranscriptSegment(elapsedMs = 0L, text = "we going to cook our ground beef for 10 mins"))
        )
        assertEquals("", instruction.title)
    }

    @Test
    fun extractsTitleFromThisIsMyRecipeForX() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "we took one pound of beef"),
                TranscriptSegment(elapsedMs = 3_000L, text = "this is my recipe for spicy chili")
            )
        )
        assertEquals("Spicy chili", draft.title)
    }

    @Test
    fun extractsTitleFromThisRecipeIsX() {
        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = "this recipe is grandma's meatloaf")))
        assertEquals("Grandma's meatloaf", draft.title)
    }

    @Test
    fun doesNotMistakeABareImperativeMakeXForATitle() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "take one pound of ground beef"),
                TranscriptSegment(elapsedMs = 3_000L, text = "make four burger patties")
            )
        )
        assertEquals("", draft.title)
    }

    @Test
    fun doesNotMistakeALaterWereGoingToCookXForATitle() {
        val draft = CookingSessionParser.parse(
            listOf(
                "we took one pound of ground beef",
                "we chopped some onions",
                "we mixed the onions with the beef",
                "we're going to cook the beef now"
            ).mapIndexed { index, text -> TranscriptSegment(elapsedMs = index * 3_000L, text = text) }
        )
        assertEquals("", draft.title)
    }

    @Test
    fun noAnnouncementLeavesTitleEmpty() {
        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = "add two cups flour")))
        assertEquals("", draft.title)
    }

    @Test
    fun titleDoesNotSwallowTheNextInstructionInTheSameSegment() {
        val draft = CookingSessionParser.parse(
            listOf(TranscriptSegment(elapsedMs = 0L, text = "today I'm making chili and we're going to start with the veggies"))
        )
        assertEquals("Chili", draft.title)
    }

    // ---- Prep/cook time estimate -----------------------------------------------

    @Test
    fun estimatesPrepAndCookMinutesFromChopCookVerbsWithStatedDurations() {
        val draft = CookingSessionParser.parse(
            listOf(
                "we going to chop up our veggies thats going to be 5 mins",
                "we going to cook our ground beef for 10 mins",
                "than stir and cook for another 10 mins and serve"
            ).mapIndexed { index, text -> TranscriptSegment(elapsedMs = index * 3_000L, text = text) }
        )
        assertEquals(5, draft.prepMinutes)
        assertEquals(20, draft.cookMinutes)
    }

    @Test
    fun aStepNamingNoDurationLeavesBothTimesUnknown() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "chop the onions"),
                TranscriptSegment(elapsedMs = 3_000L, text = "cook the beef")
            )
        )
        assertEquals(null, draft.prepMinutes)
        assertEquals(null, draft.cookMinutes)
    }

    @Test
    fun convertsAnHourDurationToMinutes() {
        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = "simmer for one hour")))
        assertEquals(60, draft.cookMinutes)
    }

    @Test
    fun aSpokenPrepTimeCookTimeStatementIsTakenDirectlyAndNeverBecomesAStep() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "prep time five minutes"),
                TranscriptSegment(elapsedMs = 3_000L, text = "cook time twenty minutes")
            )
        )
        assertEquals(5, draft.prepMinutes)
        assertEquals(20, draft.cookMinutes)
        assertEquals(emptyList<String>(), draft.steps)
    }

    @Test
    fun aStatedCookTimeOverridesTheInferredVerbBasedEstimate() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "cook time five minutes"),
                TranscriptSegment(elapsedMs = 3_000L, text = "cook the beef for twenty minutes")
            )
        )
        assertEquals(5, draft.cookMinutes)
    }

    // ---- Real bugs from a live chili capture (see PWA_TITLE_PREP_COOK_ESTIMATE_0.5.5.md) ---

    @Test
    fun aBareCutStateModifierSplitFromItsNounIsNotItsOwnIngredient() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "we need one pound of ground"),
                TranscriptSegment(elapsedMs = 3_000L, text = "beef")
            )
        )
        assertEquals(
            listOf(listOf("1", "lb", "Ground beef")),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
    }

    @Test
    fun aBareOrLeftDanglingBySegmentBreakIsNotItsOwnIngredient() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "we need one teaspoon of salt or"),
                TranscriptSegment(elapsedMs = 3_000L, text = "pepper")
            )
        )
        assertTrue(draft.ingredients.none { it.name.equals("or", ignoreCase = true) })
    }

    @Test
    fun aRunOnIntoTheNextSentenceIsTrimmedOffAnIngredientName() {
        val draft = CookingSessionParser.parse(
            listOf(
                TranscriptSegment(elapsedMs = 0L, text = "we need one teaspoon of salt or"),
                TranscriptSegment(elapsedMs = 3_000L, text = "pepper and you're going to let it cook")
            )
        )
        assertTrue(
            "got: ${draft.ingredients}",
            draft.ingredients.none { Regex("(?i)going to let it").containsMatchIn(it.name) }
        )
    }

    // Real Android Chrome capture, 2026-09-16. A plain present-tense "and you let
    // it cook for 2 minutes" bled into the preceding ingredient name ("1 tsp
    // Pepper, and you let it"); the earlier rule only covered "going to let it".
    @Test
    fun realTopRamenCaptureDoesNotBleedPlainLetItClauseIntoLastIngredient() {
        val text = "So today we going to make my famous top ramen meal. What you going to need to start with is one top ramen, " +
            "1 tsp of salt, 1 tsp of pepper, and you let it cook for 2 minutes, then it's finished."

        val draft = CookingSessionParser.parse(listOf(TranscriptSegment(elapsedMs = 0L, text = text)))

        assertEquals(
            listOf(
                listOf("1", "", "Top ramen"),
                listOf("1", "tsp", "Salt"),
                listOf("1", "tsp", "Pepper")
            ),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertTrue(
            "got: ${draft.ingredients}",
            draft.ingredients.none { Regex("(?i)let it").containsMatchIn(it.name) }
        )
        assertEquals(2, draft.cookMinutes)
        assertEquals(null, draft.prepMinutes)
        assertEquals("Famous top ramen meal", draft.title)
        assertTrue(
            "the title announcement must not also stand as a method step, got: ${draft.steps}",
            draft.steps.none { it.contains("famous top ramen meal", ignoreCase = true) }
        )
    }

    /**
     * Real Android device capture, 0916, release build. Two separate losses, both
     * caused by the recognizer rather than by the chef:
     *
     * 1. "you add" came back as "you had". "had" is not a step-start verb, so the
     *    segment never opened a step of its own and instead ran on from the title
     *    announcement. The announcement check only matched a step that was
     *    *entirely* the title, so the whole run-on survived as
     *    "Make my famous top romantle you had two tablespoon of salt." Only the
     *    announcement prefix may be dropped -- the instruction after it is the
     *    chef's content.
     * 2. "then sauté the garlic" came back as "then so I tell you the garlic".
     *    With no recognizable verb, ingredient or continuation cue, the whole
     *    segment was discarded silently. A segment naming a concrete duration is
     *    kept verbatim instead, which is what the parser promises everywhere else:
     *    an uncertain phrase is left for the chef to review, never deleted.
     */
    @Test
    fun realDeviceRunOnTitleAnnouncementKeepsTheInstructionAndTheStrandedDurationSegment() {
        val segments = listOf(
            "I'm going to make my famous top romantle",
            "You had two tablespoon of salt",
            "Then so I tell you the garlic for five minutes",
            "Let it cook for 10 minutes"
        ).mapIndexed { index, text -> TranscriptSegment(elapsedMs = index * 3_000L, text = text) }

        val draft = CookingSessionParser.parse(segments)

        assertEquals("Famous top romantle", draft.title)
        assertEquals(10, draft.cookMinutes)
        assertEquals(
            listOf(listOf("2", "tbsp", "Salt")),
            draft.ingredients.map { listOf(it.quantity, it.unit, it.name) }
        )
        assertEquals(
            listOf(
                "You had two tablespoon of salt.",
                "Then so I tell you the garlic for five minutes.",
                "Cook for 10 minutes."
            ),
            draft.steps
        )
        assertTrue(
            "only the announcement prefix may be stripped, never the instruction after it, got: ${draft.steps}",
            draft.steps.none { it.contains("famous top romantle", ignoreCase = true) }
        )
    }
}
