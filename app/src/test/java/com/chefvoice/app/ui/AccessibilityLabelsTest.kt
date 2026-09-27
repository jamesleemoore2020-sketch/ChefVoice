package com.chefvoice.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chefvoice.app.model.ChefNotification
import com.chefvoice.app.model.LiveSession
import com.chefvoice.app.model.NotificationPreferences
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Controls the demo app cannot reach -- a signed-in notification list, a viewer's reactions in a
 * running Live -- drawn on their own, checking what TalkBack is told (audit F12).
 */
@RunWith(RobolectricTestRunner::class)
class AccessibilityLabelsTest {
    @get:Rule
    val compose = createComposeRule()

    private fun hasNoText() =
        SemanticsMatcher("has no drawn text read aloud") { SemanticsProperties.Text !in it.config }

    @Test
    fun notificationRowsClearWithALabelledButtonAndDoNotReadTheGlyph() {
        val dismissed = mutableListOf<String>()
        var preferences by mutableStateOf(NotificationPreferences())
        compose.setContent {
            MaterialTheme {
                NotificationsScreen(
                    notifications = listOf(ChefNotification(id = "n1", type = "message", title = "New message from Ana", body = "Is the oven hot?")),
                    isSignedIn = true,
                    loading = false,
                    errorMessage = "",
                    unreadCount = 1,
                    preferences = preferences,
                    preferencesReady = true,
                    preferencesError = "",
                    onPreferencesChange = { preferences = it },
                    onOpen = {},
                    onDismiss = { dismissed += it.id },
                    onMarkAllRead = {},
                    onClearRead = {}
                )
            }
        }
        compose.onNodeWithContentDescription("Clear notification").assert(hasNoText()).performClick()
        assertEquals(listOf("n1"), dismissed)
        // The envelope glyph is drawn but never read: the title says what arrived.
        compose.onAllNodesWithText("✉").assertCountEquals(0)

        // Each alert preference is one switch that carries its own name.
        compose.onNodeWithText("Notification settings").performClick()
        val messages = compose.onNode(hasText("Messages") and hasRole(Role.Switch))
        messages.assertIsOn().performClick()
        messages.assertIsOff()
    }

    @Test
    fun liveReactionsSayWhatTheySend() {
        val sent = mutableListOf<String>()
        compose.setContent {
            MaterialTheme {
                LiveReactionButtons(LiveSession(heartCount = 3, fireCount = 1, clapCount = 0), onReact = { sent += it })
            }
        }
        compose.onNodeWithContentDescription("Send a heart, 3 hearts").assert(hasNoText()).performClick()
        compose.onNodeWithContentDescription("Send fire, 1 fire reaction").assert(hasNoText()).performClick()
        compose.onNodeWithContentDescription("Send applause, 0 claps").assert(hasNoText()).performClick()
        assertEquals(listOf("heart", "fire", "clap"), sent)
    }

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)
}
