package com.chefvoice.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.util.RecipeView
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Not a check: a way to look at the Android screens without a phone. Skipped unless
 * CHEFVOICE_SCREENSHOTS names a folder, then writes a PNG per main tab in light and in Blackout,
 * drawn by Robolectric's native graphics at a 393 x 851 dp phone size:
 *
 *   set CHEFVOICE_SCREENSHOTS=C:\somewhere\shots
 *   gradlew.bat :app:testDebugUnitTest --tests "com.chefvoice.app.ui.RenderScreensTest"
 *
 * The window is drawn to a software canvas: captureToImage() waits for a hardware frame that
 * Robolectric's paused looper never produces.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w393dp-h851dp-xxhdpi")
class RenderScreensTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val outDir: String? = System.getenv("CHEFVOICE_SCREENSHOTS")

    @Before
    fun onlyWhenAsked() = assumeTrue("set CHEFVOICE_SCREENSHOTS to render screens", !outDir.isNullOrBlank())

    private fun snap(name: String) {
        compose.waitForIdle()
        val view = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        val dir = File(outDir!!).apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun render(appearance: String, prefix: String) {
        compose.activity.getSharedPreferences("chefvoice_appearance", 0).edit().putString("appearance", appearance).commit()
        lateinit var appState: ChefAppState
        compose.setContent { ChefVoiceApp(createAppState = { context -> ChefAppState(context).also { appState = it } }) }
        compose.mainClock.advanceTimeBy(1_000)
        for (tab in listOf("Recipes", "Create", "Community", "Live", "Profile")) {
            compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab) and hasContentDescription(tab, substring = true))
                .performClick()
            snap("$prefix-${tab.lowercase()}")
        }
        // The cook-along (audit F21), scaled to four servings, on a step that names an ingredient.
        val pasta = Recipe(
            id = "render-cook-along",
            title = "Weeknight tomato pasta",
            servings = 2,
            ingredients = listOf(
                Ingredient(quantity = "200", unit = "g", name = "spaghetti"),
                Ingredient(quantity = "2", unit = "tbsp", name = "olive oil"),
                Ingredient(quantity = "2", unit = "clove", name = "garlic")
            ),
            steps = listOf("Boil the pasta for 10 minutes.", "Warm the olive oil in a wide pan and add the garlic for 1 minute.", "Toss the pasta through.")
        )
        compose.runOnUiThread {
            appState.recipeView = RecipeView(pasta.id, servings = 4)
            appState.cookingRecipe = pasta
        }
        snap("$prefix-cook-along-1")
        compose.onNodeWithText("Next step").performClick()
        snap("$prefix-cook-along-2")
    }

    @Test
    fun light() = render("light", "light")

    @Test
    fun blackout() = render("blackout", "blackout")
}
