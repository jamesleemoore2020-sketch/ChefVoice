package com.chefvoice.app.ui

import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.chefvoice.app.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Audit F26: Blackout follows the phone's dark theme until the chef picks one, and a choice
 * made before this setting existed is kept. `darkScreens` records what the app tells
 * MainActivity, which is what the status bar icons and window background follow.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class AppearanceTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val darkScreens = mutableListOf<Boolean>()

    private fun prefs() = compose.activity.getSharedPreferences("chefvoice_appearance", 0)

    private fun start() {
        compose.setContent { ChefVoiceApp(onDarkThemeChange = { darkScreens += it }) }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    private fun openAppearance() {
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab) and hasContentDescription("Profile"))
            .performClick()
        compose.waitForIdle()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Appearance"))
    }

    private fun option(label: String) =
        compose.onNode(hasText(label) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))

    @Test
    @Config(qualifiers = "+night")
    fun aDarkPhoneOpensInBlackoutUntilTheChefChooses() {
        start()
        // Dark over the brand cover, and still dark once the app itself is showing.
        assertEquals(true, darkScreens.last())
        openAppearance()
        option("Auto").assertIsSelected()
        compose.onNodeWithText("Blackout while your phone is in dark theme").assertIsDisplayed()

        option("Light").performClick()
        compose.waitForIdle()
        assertEquals(false, darkScreens.last())
        compose.onNodeWithText("Always light").assertIsDisplayed()
        assertEquals("light", prefs().getString("appearance", null))
    }

    @Test
    fun aLightPhoneOpensLightAfterTheBlackCover() {
        start()
        assertEquals(listOf(true, false), darkScreens)
        openAppearance()
        option("Auto").assertIsSelected()
        compose.onNodeWithText("Light while your phone is in light theme").assertIsDisplayed()

        option("Blackout").performClick()
        compose.waitForIdle()
        assertEquals(true, darkScreens.last())
        assertEquals("blackout", prefs().getString("appearance", null))
    }

    @Test
    fun blackoutSwitchedOnBeforeThisSettingIsKept() {
        prefs().edit().putBoolean("blackout", true).commit()
        start()
        assertEquals(true, darkScreens.last())
        openAppearance()
        option("Blackout").assertIsSelected()
    }

    @Test
    fun aDarkThemeSwitchWhileOpenRethemesWithoutRebuildingTheApp() {
        // What the activity receives once it handles uiMode itself: a new configuration, in
        // place. Rebuilding ChefAppState would mean the activity had been recreated, and with
        // it the Create screen, which stops a cooking capture.
        val light = Configuration(compose.activity.resources.configuration)
        val night = Configuration(light).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
        }
        var configuration by mutableStateOf(light)
        var statesBuilt = 0
        compose.setContent {
            CompositionLocalProvider(LocalConfiguration provides configuration) {
                ChefVoiceApp(
                    onDarkThemeChange = { darkScreens += it },
                    createAppState = { context -> statesBuilt++; ChefAppState(context) }
                )
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        assertEquals(false, darkScreens.last())

        compose.runOnUiThread { configuration = night }
        compose.waitForIdle()
        assertEquals(true, darkScreens.last())
        assertEquals(1, statesBuilt)
    }

    @Test
    fun mainActivityHandlesADarkThemeSwitchItself() {
        // Read from the merged manifest without starting MainActivity, whose App Check
        // bootstrap would initialise Firebase against production.
        val info = compose.activity.packageManager.getActivityInfo(
            ComponentName(compose.activity, MainActivity::class.java), 0
        )
        assertTrue("MainActivity must declare uiMode in configChanges", (info.configChanges and ActivityInfo.CONFIG_UI_MODE) != 0)
    }

    @Test
    @Config(qualifiers = "+night")
    fun blackoutSwitchedOffBeforeThisSettingStaysLightOnADarkPhone() {
        prefs().edit().putBoolean("blackout", false).commit()
        start()
        assertEquals(false, darkScreens.last())
        openAppearance()
        option("Light").assertIsSelected()
    }
}
