package com.chefvoice.app.util

import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.VoiceClip

/**
 * Private backup of a chef's recipes and original cooking audio to their own account
 * (audit F11), as decisions with no Firebase in them. `web/js/backup.js` is the PWA's port.
 *
 * A backup is a recipe document with `isPublic: false`, its photos and videos in the recipe's
 * Storage slots (readable only by the chef while it is private), and the original recording at
 * `privateVoice/{uid}/{recipeId}/session`, the path Second Pass already uses. The rules already
 * allowed all of it, so nothing about security changed.
 *
 * What it never does: change whether a recipe is on Community, or send the edits of a published
 * recipe there. Those stay the explicit publish and Update Community they always were. A
 * published recipe is already in the account, as published.
 */
object RecipeBackup {
    const val SESSION_LABEL = "Full cooking session"

    /** Photo and video slots a recipe has in the account: the Storage permit's slot-00 to slot-23. */
    const val MEDIA_SLOTS = 24

    /** Whether this recipe has something the chef's account does not hold yet. */
    fun needsBackup(recipe: Recipe, uid: String): Boolean =
        uid.isNotBlank() &&
            !recipe.isPublic &&
            (recipe.authorId.isBlank() || recipe.authorId == uid) &&
            recipe.updatedAt > recipe.backedUpAt

    /** The account's recipes this device does not have, newest first. */
    fun restorable(cloud: List<Recipe>, local: List<Recipe>): List<Recipe> {
        val here = local.mapTo(HashSet()) { it.id }
        return cloud.filterNot { it.id in here }.sortedByDescending { it.updatedAt }
    }

    /** The recording a backup keeps: the newest full cooking session still on this device. */
    fun sessionClip(recipe: Recipe, onDisk: (String) -> Boolean): VoiceClip? =
        recipe.voiceClips
            .filter { it.label.equals(SESSION_LABEL, ignoreCase = true) && it.path.isNotBlank() && onDisk(it.path) }
            .maxByOrNull { it.createdAt }

    /**
     * Whether a backup of [snapshot] holds everything it could: every photo and video still on
     * this device that has a slot, and the original recording if the device has one. A recipe
     * backed up only in part stays waiting, and the next backup sends what is missing.
     */
    fun complete(snapshot: Recipe, uploaded: Recipe, onDisk: (String) -> Boolean): Boolean {
        val mediaHeld = snapshot.media.take(MEDIA_SLOTS).all { item ->
            item.path.isBlank() || !onDisk(item.path) ||
                uploaded.media.any { it.id == item.id && it.remoteUrl.isNotBlank() }
        }
        val session = sessionClip(snapshot, onDisk)
        return mediaHeld && (session == null || uploaded.backedUpAudioId == session.id)
    }

    /**
     * The recipe as it is now, with what a backup of [snapshot] produced. The chef may have
     * edited it while the upload ran; those edits are kept, and because [Recipe.backedUpAt]
     * records the version that was uploaded, the edited recipe still reads as needing a backup.
     * It only moves when the backup was [complete].
     */
    fun afterBackup(current: Recipe, snapshot: Recipe, uploaded: Recipe, complete: Boolean): Recipe =
        current.copy(
            authorId = uploaded.authorId,
            authorName = uploaded.authorName,
            media = current.media.map { item ->
                val url = uploaded.media.firstOrNull { it.id == item.id }?.remoteUrl.orEmpty()
                if (url.isNotBlank() && item.remoteUrl.isBlank()) item.copy(remoteUrl = url) else item
            },
            voiceClips = current.voiceClips.map { clip ->
                val url = uploaded.voiceClips.firstOrNull { it.id == clip.id }?.remoteUrl.orEmpty()
                if (url.isNotBlank() && clip.remoteUrl.isBlank()) clip.copy(remoteUrl = url) else clip
            },
            backedUpAt = if (complete) maxOf(current.backedUpAt, snapshot.updatedAt) else current.backedUpAt,
            backedUpAudioId = uploaded.backedUpAudioId.ifBlank { current.backedUpAudioId }
        )

    /**
     * [incoming], a new version of [stored], keeping what only backing up and publishing learn:
     * the owner, the account's copy of each photo and clip, and which version and recording the
     * account holds. A screen that opened the recipe before a backup finished saves a copy from
     * before it, and that must not make the phone upload everything again.
     */
    fun keepBookkeeping(stored: Recipe, incoming: Recipe): Recipe =
        incoming.copy(
            authorId = incoming.authorId.ifBlank { stored.authorId },
            media = incoming.media.map { item ->
                if (item.remoteUrl.isNotBlank()) item
                else stored.media.firstOrNull { it.id == item.id && it.path == item.path && it.remoteUrl.isNotBlank() }
                    ?.let { item.copy(remoteUrl = it.remoteUrl) } ?: item
            },
            voiceClips = incoming.voiceClips.map { clip ->
                if (clip.remoteUrl.isNotBlank()) clip
                else stored.voiceClips.firstOrNull { it.id == clip.id && it.path == clip.path && it.remoteUrl.isNotBlank() }
                    ?.let { clip.copy(remoteUrl = it.remoteUrl) } ?: clip
            },
            backedUpAt = maxOf(stored.backedUpAt, incoming.backedUpAt),
            backedUpAudioId = incoming.backedUpAudioId.ifBlank { stored.backedUpAudioId }
        )

    /**
     * A recipe from the account, as this device keeps it: already backed up as it stands, with
     * its original recording, when the account had one, at [sessionAudioPath].
     */
    fun restored(cloud: Recipe, sessionAudioPath: String): Recipe {
        val session = sessionAudioPath.takeIf { it.isNotBlank() }?.let {
            VoiceClip(path = it, label = SESSION_LABEL, createdAt = cloud.createdAt)
        }
        return cloud.copy(
            communityUpdatePending = false,
            voiceClips = listOfNotNull(session) + cloud.voiceClips,
            backedUpAt = cloud.updatedAt,
            backedUpAudioId = session?.id.orEmpty()
        )
    }
}
