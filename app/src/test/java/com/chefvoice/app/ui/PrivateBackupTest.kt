package com.chefvoice.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.Recipe
import com.google.firebase.FirebaseApp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * Private backup and restore (audit F11): the Profile card and the Library's offer, drawn on
 * their own because both need a signed-in account the demo app does not have; and the two
 * places the saved copy of a recipe has to win over a screen's older one.
 */
@RunWith(RobolectricTestRunner::class)
class PrivateBackupTest {
    @get:Rule
    val compose = createComposeRule()

    private val backupSwitch = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Switch)
    private val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    private fun card(isPro: Boolean, emailVerified: Boolean = true, panel: () -> BackupPanel, calls: MutableList<String> = mutableListOf()) {
        compose.setContent {
            MaterialTheme {
                PrivateBackupCard(
                    isPro = isPro,
                    emailVerified = emailVerified,
                    panel = panel(),
                    onEnabledChange = { calls += "switch:$it" },
                    onBackUpNow = { calls += "back up" },
                    onRestore = { calls += "restore" },
                    onCheckRestore = { calls += "check" }
                )
            }
        }
    }

    @Test
    fun withoutProTheSwitchShowsWhatProIncludesAndKeepsWhatIsThere() {
        val calls = mutableListOf<String>()
        // Turned on while Pro, then Pro lapsed: it reads as off, and the account keeps it all.
        card(isPro = false, panel = { BackupPanel(enabled = true, pendingCount = 4, restoreChecked = true) }, calls = calls)
        compose.onNode(backupSwitch).assertIsOff().performClick()
        assertEquals(listOf("switch:true"), calls)
        compose.onNodeWithText("Part of ChefVoice Pro. Anything already in your account stays there", substring = true).assertExists()
        compose.onNodeWithText("Back up now").assertDoesNotExist()
    }

    @Test
    fun onItSaysWhatIsWaitingAndBacksUpWhenAsked() {
        val calls = mutableListOf<String>()
        var panel by mutableStateOf(BackupPanel(enabled = true, pendingCount = 2, restoreChecked = true))
        card(isPro = true, panel = { panel }, calls = calls)
        compose.onNode(backupSwitch).assertIsOn()
        compose.onNodeWithText("2 recipes waiting to back up.").assertExists()
        compose.onNodeWithText("Back up now").performClick()
        assertEquals(listOf("back up"), calls)

        panel = panel.copy(running = true)
        compose.onNodeWithText("Backing up…").assertExists()
        compose.onNodeWithText("Back up now").assertIsNotEnabled()

        panel = panel.copy(running = false, pendingCount = 1, status = "One photo/video stayed local (quota).")
        compose.onNodeWithText("1 recipe waiting to back up.").assertExists()
        compose.onNodeWithText("One photo/video stayed local (quota).").assertExists()

        panel = panel.copy(pendingCount = 0, status = "")
        compose.onNodeWithText("Everything on this phone is backed up.").assertExists()
        compose.onNodeWithText("Back up now").assertDoesNotExist()

        compose.onNode(backupSwitch).performClick()
        assertEquals(listOf("back up", "switch:false"), calls)
    }

    @Test
    fun offItSaysPublishedRecipesAreInTheAccountAnyway() {
        card(isPro = true, panel = { BackupPanel(enabled = false, pendingCount = 3, restoreChecked = true) })
        compose.onNode(backupSwitch).assertIsOff()
        compose.onNodeWithText("Off. Recipes you publish are in your account either way.").assertExists()
        compose.onNodeWithText("Back up now").assertDoesNotExist()
    }

    @Test
    fun anUnverifiedEmailIsTheOneThingItAsksFor() {
        card(isPro = true, emailVerified = false, panel = { BackupPanel(enabled = true, pendingCount = 3, restoreChecked = true) })
        compose.onNodeWithText("Verify your email to start backing up", substring = true).assertExists()
        compose.onNodeWithText("3 recipes waiting to back up.").assertDoesNotExist()
        compose.onNodeWithText("Back up now").assertDoesNotExist()
    }

    @Test
    fun restoreIsForEveryChefAndSaysWhatTheAccountHolds() {
        val calls = mutableListOf<String>()
        var panel by mutableStateOf(BackupPanel())
        card(isPro = false, panel = { panel }, calls = calls)
        compose.onNodeWithText("Checking your account…").assertExists()
        compose.onNodeWithText("Check my account again").assertDoesNotExist()

        panel = BackupPanel(restoreChecked = true, restorableCount = 3)
        compose.onNodeWithText("3 recipes in your account aren't on this phone.").assertExists()
        compose.onNodeWithText("Wi-Fi is best", substring = true).assertExists()
        compose.onNodeWithText("Restore to this phone").performClick()

        panel = panel.copy(restoreRunning = true, restoreStatus = "Restoring 2 of 3…")
        compose.onNodeWithText("Restoring 2 of 3…").assertExists()
        compose.onNodeWithText("Restore to this phone").assertDoesNotExist()

        panel = BackupPanel(restoreChecked = true, restorableCount = 1, restoreStatus = "2 restored. The original audio for “Stew” could not be downloaded")
        compose.onNodeWithText("1 recipe in your account isn't on this phone.").assertExists()
        compose.onNodeWithText("The original audio for “Stew” could not be downloaded", substring = true).assertExists()

        panel = BackupPanel(restoreChecked = true, restoreStatus = "3 recipes restored to this phone.")
        compose.onNodeWithText("3 recipes restored to this phone.").assertExists()
        compose.onNodeWithText("Check my account again").performClick()

        panel = BackupPanel(restoreChecked = true)
        compose.onNodeWithText("Every recipe in your account is on this phone.").assertExists()
        assertEquals(listOf("restore", "check"), calls)
    }

    @Test
    fun theLibraryOfferCanBeTakenOrPutOff() {
        val calls = mutableListOf<String>()
        var running by mutableStateOf(false)
        compose.setContent {
            MaterialTheme {
                RestoreOfferCard(
                    count = 1,
                    running = running,
                    status = "Restoring 1 of 1…",
                    onRestore = { calls += "restore" },
                    onDismiss = { calls += "not now" }
                )
            }
        }
        compose.onNode(hasText("In your ChefVoice account") and heading).assertExists()
        compose.onNodeWithText("1 recipe in your account isn't on this phone.", substring = true).assertExists()
        compose.onNodeWithText("Restore").performClick()
        compose.onNodeWithText("Not now").performClick()
        assertEquals(listOf("restore", "not now"), calls)

        running = true
        compose.onNodeWithText("Restoring 1 of 1…").assertExists()
        compose.onNodeWithText("Restore").assertDoesNotExist()
        compose.onNodeWithText("Not now").assertDoesNotExist()
    }

    private fun appState(): ChefAppState {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("chefvoice", 0).edit().clear().commit()
        return ChefAppState(context).also {
            assertTrue("Firebase must stay uninitialised in these tests", FirebaseApp.getApps(context).isEmpty())
        }
    }

    @Test
    fun aCopySavedFromBeforeABackupKeepsWhatTheAccountHolds() {
        val state = appState()
        val inAccount = Recipe(
            id = "r-kept", title = "Soup", authorId = "chef-1", updatedAt = 10L, backedUpAt = 10L, backedUpAudioId = "s",
            media = listOf(MediaAttachment(id = "a", path = "/files/media/a.jpg", remoteUrl = "https://storage/a"))
        )
        state.saveRecipe(inAccount)
        // The editor opened it before the backup finished: no owner, no upload, no audio id.
        state.saveRecipe(inAccount.copy(title = "Better soup", updatedAt = 11L, authorId = "", backedUpAt = 0L, backedUpAudioId = "",
            media = listOf(MediaAttachment(id = "a", path = "/files/media/a.jpg"))))
        val saved = state.recipes.single { it.id == "r-kept" }
        assertEquals("Better soup", saved.title)
        assertEquals("chef-1", saved.authorId)
        assertEquals(10L, saved.backedUpAt)
        assertEquals("s", saved.backedUpAudioId)
        assertEquals("https://storage/a", saved.media.single().remoteUrl)
        state.close()
    }

    @Test
    fun deletingGoesByTheSavedCopySoABackedUpRecipeIsNotOnlyRemovedHere() {
        val state = appState()
        state.saveRecipe(Recipe(id = "r-del", title = "Stew", authorId = "chef-1", backedUpAt = 5L, updatedAt = 5L))
        // The screen's copy predates the backup. Taken at its word, the delete would remove the
        // recipe from this phone only and leave the backup behind to be offered back.
        state.deleteRecipe(Recipe(id = "r-del", title = "Stew"))
        assertTrue(state.recipes.any { it.id == "r-del" })
        assertTrue(state.cloudMessage, state.cloudMessage.contains("Connect to Firebase"))
        state.close()
    }
}
