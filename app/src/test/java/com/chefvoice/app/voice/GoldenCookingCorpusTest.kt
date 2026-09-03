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

        assertEquals("Golden corpus row count changed unexpectedly", 52, rows.size)
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

}
