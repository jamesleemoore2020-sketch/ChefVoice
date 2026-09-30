package com.chefvoice.app.ui

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import com.chefvoice.app.media.AudioPlayer
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.VoiceClip
import com.google.firebase.FirebaseApp
import java.io.IOException
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource

/**
 * A chef's original recording can be stopped (found on a device with 0.11.20): the full cooking
 * session had a Play button and nothing else, and leaving the recipe left it playing, so a
 * restored hour-long session ran until the app was killed. Demo mode, as in NavigationSmokeTest:
 * Firebase is never initialised. Robolectric's MediaPlayer plays only recordings it has been told
 * about, so each test registers a ten-minute one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class VoicePlaybackTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var appState: ChefAppState

    private val session = "/data/user/0/com.chefvoice.app/files/voice/session-voice-playback-test.m4a"
    private val beans = Recipe(
        id = "voice-playback-test",
        title = "Slow-cooked beans",
        servings = 4,
        steps = listOf("Soak the beans overnight.", "Simmer them for two hours."),
        voiceClips = listOf(VoiceClip(path = session, label = "Full cooking session"))
    )

    @Before
    fun startApp() {
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(session), ShadowMediaPlayer.MediaInfo(600_000, 0))
        assertTrue("Firebase must stay uninitialised in these tests", FirebaseApp.getApps(compose.activity).isEmpty())
        compose.setContent {
            ChefVoiceApp(createAppState = { context -> ChefAppState(context).also { appState = it } })
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    private fun openRecipe() {
        compose.runOnUiThread { appState.openRecipe(beans) }
        compose.waitForIdle()
    }

    private fun press(description: String) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasContentDescription(description))
        compose.onNodeWithContentDescription(description).performClick()
        compose.waitForIdle()
    }

    @Test
    fun aPlayingRecordingOffersStopAndStops() {
        openRecipe()
        press("Play Full cooking session")
        assertEquals(session, appState.playingVoice)
        compose.onNodeWithContentDescription("Stop Full cooking session").assertIsDisplayed().performClick()
        compose.waitForIdle()
        assertEquals("", appState.playingVoice)
        compose.onNodeWithContentDescription("Play Full cooking session").assertIsDisplayed()
    }

    @Test
    fun leavingTheRecipeStopsItsRecording() {
        openRecipe()
        press("Play Full cooking session")
        assertEquals(session, appState.playingVoice)
        compose.onNodeWithText("Back").performClick()
        compose.waitForIdle()
        assertEquals("", appState.playingVoice)
    }

    @Test
    fun openingTheCookAlongStopsTheRecipeScreensRecording() {
        openRecipe()
        press("Play Full cooking session")
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("🍳 Cook this recipe"))
        compose.onNodeWithText("🍳 Cook this recipe").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("STEP 1 OF 2").assertIsDisplayed()
        assertEquals("", appState.playingVoice)
    }

    @Test
    fun theCookAlongsVoiceStopsWithItsButtonAndWhenTheChefLeaves() {
        compose.runOnUiThread { appState.cookingRecipe = beans }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Play chef's voice").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(session, appState.playingVoice)
        compose.onNodeWithContentDescription("Stop chef's voice").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals("", appState.playingVoice)
        compose.onNodeWithContentDescription("Play chef's voice").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(session, appState.playingVoice)
        compose.onNodeWithText("Back").performClick()
        compose.waitForIdle()
        assertEquals("", appState.playingVoice)
    }

    @Test
    fun aRecordingThatPlaysToTheEndOffersPlayAgain() {
        openRecipe()
        press("Play Full cooking session")
        assertEquals(session, appState.playingVoice)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(11))
        compose.waitForIdle()
        assertEquals("", appState.playingVoice)
        compose.onNodeWithContentDescription("Play Full cooking session").assertIsDisplayed()
    }

    @Test
    fun aRecordingThatCannotBeOpenedNeitherCrashesNorClaimsToPlay() {
        val missing = "/data/user/0/com.chefvoice.app/files/voice/gone.m4a"
        ShadowMediaPlayer.addException(DataSource.toDataSource(missing), IOException("no such recording"))
        val reported = mutableListOf<String>()
        compose.runOnUiThread { AudioPlayer { reported += it }.play(missing) }
        assertEquals(emptyList<String>(), reported)
    }
}
