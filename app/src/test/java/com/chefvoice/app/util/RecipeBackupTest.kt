package com.chefvoice.app.util

import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.VoiceClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Private backup's decisions (audit F11), with the Firebase left out. */
class RecipeBackupTest {
    private val uid = "chef-1"
    private val onDisk = setOf("/files/media/a.jpg", "/files/media/b.jpg", "/files/voice/session.wav", "/files/voice/second.wav")
    private val exists: (String) -> Boolean = { it in onDisk }

    private fun photo(id: String, path: String, url: String = "") = MediaAttachment(id = id, path = path, remoteUrl = url)
    private fun session(id: String, path: String, createdAt: Long = 1L) =
        VoiceClip(id = id, path = path, label = "Full cooking session", createdAt = createdAt)

    @Test
    fun onlyThePrivateRecipesOfTheSignedInChefThatChangedNeedABackup() {
        val fresh = Recipe(id = "r1", title = "Soup", updatedAt = 10L)
        assertTrue(RecipeBackup.needsBackup(fresh, uid))
        assertTrue(RecipeBackup.needsBackup(fresh.copy(authorId = uid), uid))
        assertFalse("nobody signed in", RecipeBackup.needsBackup(fresh, ""))
        assertFalse("published: Community holds it", RecipeBackup.needsBackup(fresh.copy(isPublic = true), uid))
        assertFalse("another chef's", RecipeBackup.needsBackup(fresh.copy(authorId = "chef-2"), uid))
        assertFalse("already backed up as it stands", RecipeBackup.needsBackup(fresh.copy(backedUpAt = 10L), uid))
        assertTrue("edited since", RecipeBackup.needsBackup(fresh.copy(backedUpAt = 9L), uid))
    }

    @Test
    fun theAccountOffersWhatThisPhoneDoesNotHaveNewestFirst() {
        val local = listOf(Recipe(id = "here", updatedAt = 50L))
        val cloud = listOf(
            Recipe(id = "old", updatedAt = 1L),
            Recipe(id = "here", updatedAt = 99L),
            Recipe(id = "new", updatedAt = 30L, isPublic = true)
        )
        assertEquals(listOf("new", "old"), RecipeBackup.restorable(cloud, local).map { it.id })
    }

    @Test
    fun theRecordingKeptIsTheNewestSessionStillOnThePhone() {
        val recipe = Recipe(
            voiceClips = listOf(
                session("old", "/files/voice/session.wav", createdAt = 1L),
                session("gone", "/files/voice/deleted.wav", createdAt = 9L),
                VoiceClip(id = "note", path = "/files/voice/second.wav", label = "Chef voice", createdAt = 5L),
                session("new", "/files/voice/second.wav", createdAt = 3L)
            )
        )
        assertEquals("new", RecipeBackup.sessionClip(recipe, exists)?.id)
        assertEquals(null, RecipeBackup.sessionClip(Recipe(), exists))
    }

    @Test
    fun aBackupIsCompleteWhenEveryPhotoAndTheRecordingAreInTheAccount() {
        val snapshot = Recipe(
            media = listOf(photo("a", "/files/media/a.jpg"), photo("b", "/files/media/b.jpg")),
            voiceClips = listOf(session("s", "/files/voice/session.wav"))
        )
        val everything = snapshot.copy(
            media = snapshot.media.map { it.copy(remoteUrl = "https://storage/${it.id}") },
            backedUpAudioId = "s"
        )
        assertTrue(RecipeBackup.complete(snapshot, everything, exists))
        assertFalse(
            "a photo stayed on the phone",
            RecipeBackup.complete(snapshot, everything.copy(media = listOf(everything.media[0], snapshot.media[1])), exists)
        )
        assertFalse("the recording did not go up", RecipeBackup.complete(snapshot, everything.copy(backedUpAudioId = ""), exists))
        assertFalse("an older recording is what the account holds", RecipeBackup.complete(snapshot, everything.copy(backedUpAudioId = "older"), exists))
    }

    @Test
    fun whatCannotBeSentDoesNotHoldABackupOpen() {
        // A photo whose file is gone, and one past the account's 24 slots, can never go up.
        val slots = (0 until RecipeBackup.MEDIA_SLOTS).map { photo("p$it", "", url = "https://storage/p$it") }
        val snapshot = Recipe(media = slots + photo("extra", "/files/media/a.jpg") + photo("gone", "/files/media/deleted.jpg"))
        assertTrue(RecipeBackup.complete(snapshot, snapshot, exists))
        assertTrue("no recording on the phone", RecipeBackup.complete(Recipe(), Recipe(), exists))
        // A photo whose file this phone no longer has, well within the slots.
        val lost = Recipe(media = listOf(photo("gone", "/files/media/deleted.jpg"), photo("a", "/files/media/a.jpg")))
        val sent = lost.copy(media = listOf(lost.media[0], photo("a", "/files/media/a.jpg", url = "https://storage/a")))
        assertTrue(RecipeBackup.complete(lost, sent, exists))
        assertFalse("a photo still here does hold it open", RecipeBackup.complete(lost, lost, exists))
    }

    @Test
    fun editsMadeWhileTheUploadRanAreKeptAndStillWaitForTheNextBackup() {
        val snapshot = Recipe(
            id = "r1", title = "Soup", updatedAt = 10L,
            media = listOf(photo("a", "/files/media/a.jpg")),
            voiceClips = listOf(session("s", "/files/voice/session.wav"))
        )
        val uploaded = snapshot.copy(
            authorId = uid, authorName = "Chef One", updatedAt = 12L,
            media = listOf(photo("a", "/files/media/a.jpg", url = "https://storage/a")),
            backedUpAudioId = "s"
        )
        val edited = snapshot.copy(title = "Better soup", updatedAt = 11L, media = snapshot.media + photo("b", "/files/media/b.jpg"))

        val merged = RecipeBackup.afterBackup(edited, snapshot, uploaded, complete = true)
        assertEquals("Better soup", merged.title)
        assertEquals(listOf("https://storage/a", ""), merged.media.map { it.remoteUrl })
        assertEquals(uid, merged.authorId)
        assertEquals("Chef One", merged.authorName)
        assertEquals("s", merged.backedUpAudioId)
        assertEquals("the version that went up, not the upload time", 10L, merged.backedUpAt)
        assertTrue("the edit is not in the account yet", RecipeBackup.needsBackup(merged, uid))
        assertFalse(
            "unedited, it is backed up",
            RecipeBackup.needsBackup(RecipeBackup.afterBackup(snapshot, snapshot, uploaded, complete = true), uid)
        )
    }

    @Test
    fun aBackupDoneInPartKeepsWhatWentUpAndStillWaits() {
        val snapshot = Recipe(id = "r1", updatedAt = 10L, backedUpAt = 4L, media = listOf(photo("a", "/files/media/a.jpg")))
        val uploaded = snapshot.copy(authorId = uid, media = listOf(photo("a", "/files/media/a.jpg", url = "https://storage/a")))
        val merged = RecipeBackup.afterBackup(snapshot, snapshot, uploaded, complete = false)
        assertEquals(4L, merged.backedUpAt)
        assertEquals("https://storage/a", merged.media.single().remoteUrl)
        assertTrue(RecipeBackup.needsBackup(merged, uid))
    }

    @Test
    fun aCopySavedFromBeforeABackupFinishedKeepsWhatTheBackupLearned() {
        val stored = Recipe(
            id = "r1", title = "Soup", authorId = uid, backedUpAt = 10L, backedUpAudioId = "s",
            media = listOf(photo("a", "/files/media/a.jpg", url = "https://storage/a")),
            voiceClips = listOf(VoiceClip(id = "v", path = "/files/voice/note.m4a", remoteUrl = "https://storage/v"))
        )
        val stale = stored.copy(
            title = "Soup, edited", authorId = "", backedUpAt = 0L, backedUpAudioId = "",
            media = listOf(photo("a", "/files/media/a.jpg"), photo("b", "/files/media/b.jpg")),
            voiceClips = listOf(VoiceClip(id = "v", path = "/files/voice/note.m4a"))
        )
        val kept = RecipeBackup.keepBookkeeping(stored, stale)
        assertEquals("Soup, edited", kept.title)
        assertEquals(uid, kept.authorId)
        assertEquals(10L, kept.backedUpAt)
        assertEquals("s", kept.backedUpAudioId)
        assertEquals(listOf("https://storage/a", ""), kept.media.map { it.remoteUrl })
        assertEquals("https://storage/v", kept.voiceClips.single().remoteUrl)
    }

    @Test
    fun aReplacedFileDoesNotInheritTheOldUpload() {
        val stored = Recipe(media = listOf(photo("a", "/files/media/a.jpg", url = "https://storage/a")))
        val replaced = Recipe(media = listOf(photo("a", "/files/media/b.jpg")))
        assertEquals("", RecipeBackup.keepBookkeeping(stored, replaced).media.single().remoteUrl)
    }

    @Test
    fun whatTheNewVersionKnowsWins() {
        val stored = Recipe(authorId = uid, backedUpAt = 5L, backedUpAudioId = "old")
        val newer = Recipe(authorId = uid, backedUpAt = 9L, backedUpAudioId = "new")
        val kept = RecipeBackup.keepBookkeeping(stored, newer)
        assertEquals(9L, kept.backedUpAt)
        assertEquals("new", kept.backedUpAudioId)
    }

    @Test
    fun aRestoredRecipeComesBackWithItsRecordingAndIsAlreadyBackedUp() {
        val cloud = Recipe(id = "r1", title = "Stew", authorId = uid, createdAt = 3L, updatedAt = 40L, communityUpdatePending = true,
            voiceClips = listOf(VoiceClip(id = "v", label = "Chef voice", remoteUrl = "https://storage/v")))
        val restored = RecipeBackup.restored(cloud, "/files/voice/restored-r1.wav")
        val session = restored.voiceClips.first()
        assertEquals("/files/voice/restored-r1.wav", session.path)
        assertEquals("Full cooking session", session.label)
        assertEquals(3L, session.createdAt)
        assertEquals(session.id, restored.backedUpAudioId)
        assertEquals(40L, restored.backedUpAt)
        assertFalse(restored.communityUpdatePending)
        assertEquals("v", restored.voiceClips[1].id)
        assertFalse(RecipeBackup.needsBackup(restored, uid))
        assertEquals(session.id, RecipeBackup.sessionClip(restored) { it == "/files/voice/restored-r1.wav" }?.id)
    }

    @Test
    fun aRecipeWithNoRecordingInTheAccountComesBackWithout() {
        val restored = RecipeBackup.restored(Recipe(id = "r2", updatedAt = 7L), "")
        assertTrue(restored.voiceClips.isEmpty())
        assertEquals("", restored.backedUpAudioId)
        assertEquals(7L, restored.backedUpAt)
    }
}
