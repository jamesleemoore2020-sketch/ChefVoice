package com.chefvoice.app.ui

import androidx.activity.ComponentActivity
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
import org.junit.Assert.assertEquals
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
    @Config(qualifiers = "+night")
    fun blackoutSwitchedOffBeforeThisSettingStaysLightOnADarkPhone() {
        prefs().edit().putBoolean("blackout", false).commit()
        start()
        assertEquals(false, darkScreens.last())
        openAppearance()
        option("Light").assertIsSelected()
    }
}
