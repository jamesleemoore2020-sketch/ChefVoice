package com.chefvoice.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.util.MeasurementSystem
import com.chefvoice.app.util.RecipeView
import com.google.firebase.FirebaseApp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The cook-along for a real kitchen (audit F21), on the JVM: one big Next that never scrolls
 * away, the amounts beside the step that uses them, and no tab bar to brush on the way past.
 * Demo mode, as in NavigationSmokeTest: Firebase is never initialised, nothing reaches production.
 *
 * Native graphics, because this screen's rules are about size and position. Robolectric's
 * default graphics measure every line of text a few pixels wide, so a long step is not long, a
 * clipped label is not clipped, and a scroll test has nothing to scroll.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class CookAlongTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var appState: ChefAppState

    private val pasta = Recipe(
        id = "cook-along-test",
        title = "Weeknight tomato pasta",
        servings = 2,
        ingredients = listOf(
            Ingredient(quantity = "200", unit = "g", name = "spaghetti"),
            Ingredient(quantity = "2", unit = "tbsp", name = "olive oil")
        ),
        steps = listOf("Boil the pasta for 10 minutes.", "Warm the oil in a pan.", "Toss the pasta through the oil.")
    )

    @Before
    fun startApp() {
        assertTrue("Firebase must stay uninitialised in these tests", FirebaseApp.getApps(compose.activity).isEmpty())
        compose.setContent {
            ChefVoiceApp(createAppState = { context -> ChefAppState(context).also { appState = it } })
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    private fun cook(recipe: Recipe = pasta, view: RecipeView? = null) {
        compose.runOnUiThread {
            if (view != null) appState.recipeView = view
            appState.cookingRecipe = recipe
        }
        compose.waitForIdle()
    }

    private fun tap(text: String) {
        compose.onNodeWithText(text).performClick()
        compose.waitForIdle()
    }

    private val tabs = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)

    @Test
    fun theTabBarIsGoneWhileCookingAndBackAfterwards() {
        cook()
        compose.onAllNodes(tabs).assertCountEquals(0)
        tap("Back")
        compose.onAllNodes(tabs).assertCountEquals(5)
    }

    @Test
    fun nextIsTheBiggestTargetAndStaysOnScreenUnderALongStep() {
        // Both long: a short second step would put the screen back at the top by itself.
        val long = "Stir the oil through the pasta slowly, scraping the bottom of the pan, until every strand is coated and glossy. ".repeat(8).trim()
        val alsoLong = "Warm the oil in a pan. " + "Keep the heat low and let it shimmer without smoking, tilting the pan so it pools evenly. ".repeat(8).trim()
        cook(pasta.copy(steps = listOf(long, alsoLong, "Serve.")))
        val next = compose.onNodeWithText("Next step").assertIsDisplayed().assertHeightIsAtLeast(64.dp)
        val previous = compose.onNodeWithText("Previous").assertIsDisplayed().assertIsNotEnabled()
        val nextWidth = next.fetchSemanticsNode().boundsInRoot.width
        val previousWidth = previous.fetchSemanticsNode().boundsInRoot.width
        assertTrue("Next ($nextWidth) should be much wider than Previous ($previousWidth)", nextWidth > previousWidth * 1.5f)
        // Everything below the long step is still reachable, and Next is still there over it.
        compose.onNodeWithText("🎙 Hands-free").performScrollTo().assertIsDisplayed()
        next.assertIsDisplayed()
        // A new step starts at its first word, not wherever the last one was scrolled to.
        tap("Next step")
        compose.onNodeWithText("STEP 2 OF 3").assertIsDisplayed()
        compose.onNodeWithText("🎙 Hands-free").performScrollTo()
        next.assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w360dp-h740dp-xhdpi")
    // "Previou" got past every test here while they ran on Robolectric's default graphics, and
    // was only seen in RenderScreensTest's drawing.
    fun bothStepButtonsShowTheirWholeLabelOnANarrowPhone() {
        cook()
        for (label in listOf("Previous", "Next step")) {
            val layout = textLayout(label)
            val natural = layout.multiParagraph.intrinsics.maxIntrinsicWidth
            val room = layout.layoutInput.constraints.maxWidth
            // Not hasVisualOverflow: it compares the label with the full width it was laid out
            // in, so a centred label narrower than its button counts as overflowing.
            assertTrue("$label needs ${natural}px and its button gives it ${room}px", natural <= room)
            assertEquals("$label wraps", 1, layout.lineCount)
        }
    }

    private fun textLayout(text: String): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        return results.single()
    }

    @Test
    fun theLastStepKeepsItsButtonDisabledRatherThanLeaving() {
        cook()
        tap("Next step")
        tap("Next step")
        compose.onNodeWithText("Toss the pasta through the oil.").assertIsDisplayed()
        compose.onNodeWithText("Last step").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText("Previous").assertIsEnabled()
    }

    @Test
    fun aStepShowsTheIngredientsItNamesAndTheRestAreATapAway() {
        cook()
        // "Boil the pasta" names nothing on the list, which says spaghetti.
        compose.onAllNodesWithText("In this step").assertCountEquals(0)
        tap("Next step")
        compose.onNodeWithText("In this step").assertIsDisplayed()
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        compose.onNodeWithText("• 2 tbsp olive oil").assertIsDisplayed()
        compose.onAllNodesWithText("spaghetti", substring = true).assertCountEquals(0)
        compose.onNodeWithText("All ingredients (2)")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Collapsed"))
        tap("All ingredients (2)")
        compose.onNodeWithText("• 200 g spaghetti").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("All ingredients (2)")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Expanded"))
    }

    @Test
    fun talkBackReadsTheNewStepUnlessItIsBeingReadAloud() {
        cook()
        compose.onNodeWithText("Boil the pasta for 10 minutes.")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        tap("🔊 Read steps aloud")
        compose.onNodeWithText("Boil the pasta for 10 minutes.")
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
    }

    @Test
    fun theViewTheChefSetCarriesIntoCookingAndSaysSo() {
        cook(view = RecipeView(pasta.id, servings = 4, system = MeasurementSystem.METRIC))
        tap("Next step")
        compose.onNodeWithText("• 59.15 ml olive oil").assertIsDisplayed()
        compose.onNodeWithText("Amounts for 4 servings (the chef cooked 2), in metric. The step reads as the chef said it.")
            .assertIsDisplayed()
        // The step itself is never rewritten.
        compose.onNodeWithText("Warm the oil in a pan.").assertIsDisplayed()
    }

    @Test
    fun theRecipeScreenStepperIsWhatTheCookAlongUsesAndItSurvivesCooking() {
        compose.runOnUiThread { appState.openRecipe(pasta) }
        compose.waitForIdle()
        val list = compose.onNode(hasScrollToNodeAction())
        list.performScrollToNode(hasContentDescription("More servings"))
        compose.onNodeWithContentDescription("More servings").performClick()
        compose.onNodeWithContentDescription("More servings").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Serves 4").assertIsDisplayed()
        list.performScrollToNode(hasText("🍳 Cook this recipe"))
        tap("🍳 Cook this recipe")
        tap("Next step")
        compose.onNodeWithText("• 4 tbsp olive oil").assertIsDisplayed()
        tap("Back")
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Serves 4"))
        compose.onNodeWithText("Serves 4").assertIsDisplayed()
    }
}
