package com.chefvoice.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasScrollToNodeAction
import com.chefvoice.app.model.ChefNotification
import com.chefvoice.app.model.ShoppingItem
import com.google.firebase.FirebaseApp
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The first UI safety net on Android (audit F2): the real ChefVoiceApp composable, driven
 * through its bottom bar on the JVM. Firebase is never initialised under Robolectric, so the
 * app runs in its demo mode -- local recipes, the demo Community feed, signed out -- and
 * nothing here can reach the production project.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class NavigationSmokeTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var appState: ChefAppState

    @Before
    fun startApp() {
        assertTrue("Firebase must stay uninitialised in these tests", FirebaseApp.getApps(compose.activity).isEmpty())
        compose.setContent {
            ChefVoiceApp(createAppState = { context -> ChefAppState(context).also { appState = it } })
        }
        // The brand cover holds the screen for 800 ms before the app appears.
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    private fun tab(label: String) =
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab) and hasContentDescription(label, substring = true))

    private fun openTab(label: String) {
        tab(label).performClick()
        compose.waitForIdle()
    }

    private fun pressBack() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    @Test
    fun everyTabOpensItsScreen() {
        tab("Recipes").assertIsSelected()
        compose.onNodeWithText("Your recipes, your cookbook.").assertIsDisplayed()

        openTab("Create")
        tab("Create").assertIsSelected()
        compose.onNodeWithText("Create recipe").assertIsDisplayed()

        openTab("Community")
        tab("Community").assertIsSelected()
        compose.onNodeWithText("CHEFVOICE COMMUNITY").assertIsDisplayed()

        openTab("Live")
        tab("Live").assertIsSelected()
        compose.onNodeWithText("ChefVoice Live").assertIsDisplayed()

        openTab("Profile")
        tab("Profile").assertIsSelected()
        compose.onNodeWithText("Chef Profile").assertIsDisplayed()
    }

    @Test
    fun createOpensOnTheCaptureStep() {
        openTab("Create")
        compose.onNodeWithText("🎙 Start cooking capture").assertIsDisplayed()
        compose.onNodeWithText("Cook, talk, and let ChefVoice build the first draft while keeping the creator's real voice.")
            .assertIsDisplayed()
    }

    @Test
    fun backReturnsThroughTheTabsVisited() {
        openTab("Community")
        openTab("Live")
        pressBack()
        tab("Community").assertIsSelected()
        pressBack()
        tab("Recipes").assertIsSelected()
    }

    @Test
    fun messagesAndNotificationsOpenFromCommunityAndKeepItLit() {
        openTab("Community")
        compose.onNodeWithContentDescription("Messages").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sign in to message chefs").assertIsDisplayed()
        tab("Community").assertIsSelected()

        pressBack()
        compose.onNodeWithText("CHEFVOICE COMMUNITY").assertIsDisplayed()

        compose.onNodeWithContentDescription("Notifications").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Sign in for notifications").assertIsDisplayed()
        tab("Community").assertIsSelected()
    }

    @Test
    fun communityTabCarriesTheUnreadCount() {
        tab("Community").assert(hasContentDescription("Community"))
        compose.runOnUiThread {
            appState.notifications.add(ChefNotification(id = "n1", type = "like", title = "A chef liked your recipe"))
            appState.notifications.add(ChefNotification(id = "n2", type = "follow", title = "A new follower"))
        }
        compose.waitForIdle()
        tab("Community").assert(hasContentDescription("Community, 2 unread"))
        // The badge is drawn inside the icon, which Material hides from TalkBack; the count
        // is read from the tab's description instead, never twice.
        compose.onNode(hasText("2"), useUnmergedTree = true).assertIsDisplayed()

        compose.runOnUiThread {
            for (i in appState.notifications.indices) {
                appState.notifications[i] = appState.notifications[i].copy(readAt = 1L)
            }
        }
        compose.waitForIdle()
        tab("Community").assert(hasContentDescription("Community"))
    }

    @Test
    fun feedActionsSayWhatTheyDoAndWhetherTheyAreOn() {
        openTab("Community")
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasContentDescription("Share recipe"))
        // Demo mode likes locally, so the state flips while the demo count stays put.
        fun firstLike() = compose.onAllNodesWithContentDescription("Like, ", substring = true).onFirst()
        firstLike().assert(stateIs("Not liked")).assert(hasNoText())
        firstLike().performClick()
        compose.waitForIdle()
        firstLike().assert(stateIs("Liked"))

        compose.onAllNodesWithContentDescription("Save to cookbook").onFirst()
            .assert(stateIs("Not saved")).assert(hasNoText())
        compose.onAllNodesWithContentDescription("Share recipe").onFirst().assert(hasNoText())
        compose.onAllNodesWithContentDescription("Open recipe and comments", substring = true).onFirst().assert(hasNoText())
    }

    @Test
    fun aShoppingLineIsOneSwitchThatSaysWhatItTicks() {
        compose.runOnUiThread {
            appState.shoppingItems.add(ShoppingItem(id = "s1", name = "onions", quantity = "2"))
        }
        compose.onNodeWithText("🛒 Shopping list · 1 to buy").performClick()
        compose.waitForIdle()
        val line = compose.onNode(hasText("2 onions") and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Switch))
        line.assertIsOff().assert(stateIs("To buy"))
        line.performClick()
        compose.waitForIdle()
        line.assertIsOn().assert(stateIs("In the basket"))
    }

    private fun stateIs(expected: String) =
        SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, expected)

    private fun hasNoText() =
        SemanticsMatcher("has no drawn text read aloud") { SemanticsProperties.Text !in it.config }
}
