package com.chefvoice.app.model

import java.util.UUID

enum class MediaType { IMAGE, VIDEO }

data class Ingredient(
    val id: String = UUID.randomUUID().toString(),
    val quantity: String = "",
    val unit: String = "",
    val name: String = ""
) {
    fun displayText(): String = listOf(quantity, unit, name)
        .filter { it.isNotBlank() }
        .joinToString(" ")
}

data class MediaAttachment(
    val id: String = UUID.randomUUID().toString(),
    val path: String = "",
    val type: MediaType = MediaType.IMAGE,
    val remoteUrl: String = "",
    val stepId: String = "",
    val caption: String = ""
) {
    fun playableLocation(): String = remoteUrl.ifBlank { path }
}

data class VoiceClip(
    val id: String = UUID.randomUUID().toString(),
    val path: String = "",
    val label: String = "Chef voice",
    val createdAt: Long = System.currentTimeMillis(),
    val remoteUrl: String = ""
) {
    fun playableLocation(): String = remoteUrl.ifBlank { path }
}

data class TranscriptSegment(
    val id: String = UUID.randomUUID().toString(),
    val elapsedMs: Long = 0L,
    val text: String = ""
)


data class SecondPassIssue(
    val id: String = UUID.randomUUID().toString(),
    val type: String = "",
    val title: String = "",
    val detail: String = "",
    val liveIndex: Int = -1,
    val secondIndex: Int = -1,
    val suggested: Ingredient? = null,
    val confidence: Double = 0.75
)

data class SecondPassMethodIssue(
    val id: String = UUID.randomUUID().toString(),
    val type: String = "",
    val title: String = "",
    val detail: String = "",
    val liveIndex: Int = -1,
    val secondIndex: Int = -1,
    val suggestedStep: String? = null,
    val confidence: Double = 0.75
)

data class SecondPassResult(
    val provider: String = "google-cloud-speech-v2",
    val model: String = "chirp_3",
    val transcript: String = "",
    val ingredients: List<Ingredient> = emptyList(),
    val issues: List<SecondPassIssue> = emptyList(),
    val confirmedCount: Int = 0,
    val steps: List<String> = emptyList(),
    val methodIssues: List<SecondPassMethodIssue> = emptyList(),
    val methodConfirmedCount: Int = 0,
    val ranAt: Long = System.currentTimeMillis()
)

data class Recipe(
    val id: String = UUID.randomUUID().toString(),
    val title: String = "",
    val description: String = "",
    val servings: Int = 2,
    val prepTimeMinutes: Int = 0,
    val cookTimeMinutes: Int = 0,
    val ingredients: List<Ingredient> = emptyList(),
    val steps: List<String> = emptyList(),
    val stepIds: List<String> = emptyList(),
    val media: List<MediaAttachment> = emptyList(),
    val voiceClips: List<VoiceClip> = emptyList(),
    val transcript: List<TranscriptSegment> = emptyList(),
    val secondPass: SecondPassResult? = null,
    val isPublic: Boolean = false,
    val authorId: String = "",
    val authorName: String = "Chef",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val likes: Int = 0,
    val commentCount: Int = 0,
    val communityUpdatePending: Boolean = false
)

fun Recipe.stableStepIds(): List<String> = steps.indices.map { index ->
    stepIds.getOrNull(index)?.takeIf { it.isNotBlank() } ?: "${id}:step:${index + 1}"
}

fun Recipe.stepIdAt(index: Int): String = stableStepIds().getOrElse(index) { "${id}:step:${index + 1}" }

data class CommunityItem(
    val recipe: Recipe,
    val isDemoMember: Boolean = false,
    val authorProfile: ChefProfile? = null
)

data class ChefProfile(
    val uid: String = "",
    val displayName: String = "Chef",
    val bio: String = "",
    val photoUrl: String = "",
    val coverPhotoUrl: String = "",
    val favoriteThings: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis()
)

data class ChefSearchResult(
    val profile: ChefProfile,
    val followerCount: Long = 0L
)

data class ChefReport(
    val id: String = "",
    val reporterUid: String = "",
    val targetType: String = "",
    val targetId: String = "",
    val targetUid: String = "",
    val contextId: String = "",
    val reason: String = "Safety concern",
    val status: String = "open",
    val moderatorNote: String = "",
    val action: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val reviewedAt: Long = 0L
)

data class RecipeComment(
    val id: String = UUID.randomUUID().toString(),
    val authorId: String = "",
    val authorName: String = "Chef",
    val text: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val parentCommentId: String = "",
    val replyToUid: String = "",
    val replyToName: String = ""
)



data class DirectConversation(
    val id: String = "",
    val participantIds: List<String> = emptyList(),
    val participantNames: Map<String, String> = emptyMap(),
    val lastMessage: String = "",
    val lastSenderId: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    fun otherUserId(currentUid: String): String = participantIds.firstOrNull { it != currentUid }.orEmpty()
    fun displayNameFor(currentUid: String): String {
        val other = otherUserId(currentUid)
        return participantNames[other]?.ifBlank { null } ?: "Chef"
    }

    fun isUnreadFor(currentUid: String, lastReadAt: Long): Boolean =
        currentUid.isNotBlank() &&
            lastMessage.isNotBlank() &&
            lastSenderId.isNotBlank() &&
            lastSenderId != currentUid &&
            updatedAt > lastReadAt
}

data class DirectMessage(
    val id: String = UUID.randomUUID().toString(),
    val senderId: String = "",
    val senderName: String = "Chef",
    val text: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

data class NotificationPreferences(
    val messages: Boolean = true,
    val comments: Boolean = true,
    val likes: Boolean = true,
    val live: Boolean = true,
    val followers: Boolean = true,
    val replies: Boolean = true
)

data class ChefNotification(
    val id: String = "",
    val type: String = "",
    val actorUid: String = "",
    val actorName: String = "Chef",
    val title: String = "ChefVoice",
    val body: String = "",
    val recipeId: String = "",
    val conversationId: String = "",
    val liveSessionId: String = "",
    val commentId: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val readAt: Long = 0L
) {
    val isUnread: Boolean get() = readAt <= 0L
}

data class LiveSession(
    val id: String = UUID.randomUUID().toString(),
    val hostId: String = "",
    val hostName: String = "Chef",
    val title: String = "Live cooking",
    val status: String = "LIVE",
    val startedAt: Long = System.currentTimeMillis(),
    val heartbeatAt: Long = 0L,
    val endedAt: Long = 0L,
    val heartCount: Int = 0,
    val fireCount: Int = 0,
    val clapCount: Int = 0
)

data class LiveComment(
    val id: String = UUID.randomUUID().toString(),
    val authorId: String = "",
    val authorName: String = "Chef",
    val text: String = "",
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Server-authoritative Pro entitlement, mirrored from
 * `users/{uid}/entitlements/pro`. Written only by the Admin SDK after a purchase
 * token is verified against the Play Developer API, or when a real-time developer
 * notification reports a renewal, cancellation, refund, grace period or hold.
 * Firestore rules deny all client writes to this document.
 *
 * The UI reads entitlement from here and never from the local Play Billing cache:
 * local purchases are an input to verification, not a source of truth.
 */
data class ProEntitlement(
    val status: String = STATUS_EXPIRED,
    val productId: String = "",
    val expiresAt: Long = 0L,
    val autoRenewing: Boolean = false,
    val source: String = "play",
    val updatedAt: Long = 0L
) {
    /**
     * Whether Pro features should be unlocked right now.
     *
     * Grace period keeps access while Play retries a failed payment, which is a
     * large share of involuntary churn — pulling features immediately turns a
     * recoverable card failure into a cancellation. Account hold does not: at that
     * point Play has already suspended the subscription.
     *
     * Checks fail closed to Free. An unknown status is not Pro.
     */
    val isActive: Boolean
        get() = when (status) {
            STATUS_ACTIVE, STATUS_IN_GRACE -> expiresAt == 0L || expiresAt > System.currentTimeMillis()
            else -> false
        }

    val isAnnual: Boolean get() = productId == PRODUCT_ANNUAL

    companion object {
        const val STATUS_ACTIVE = "active"
        const val STATUS_IN_GRACE = "in_grace"
        const val STATUS_ON_HOLD = "on_hold"
        const val STATUS_PAUSED = "paused"
        const val STATUS_EXPIRED = "expired"

        const val PRODUCT_MONTHLY = "chefvoice_pro_monthly"
        const val PRODUCT_ANNUAL = "chefvoice_pro_annual"

        val FREE = ProEntitlement()
    }
}

/**
 * What the Free tier allows. Gating targets what costs money per unit - cloud
 * storage and Second Pass transcription - and leaves local cooking free, because
 * local recipes cost nothing and feed the sharing loop.
 *
 * Deliberately not "unlimited" anywhere with a per-unit cloud cost.
 */
object FreeTierLimits {
    const val CLOUD_RECIPES = 10
    const val SECOND_PASS_PER_MONTH = 2
    const val PHOTOS_PER_RECIPE = 1
    const val VIDEO_ALLOWED = false
}

object ProTierLimits {
    const val SECOND_PASS_PER_MONTH = 30
    const val VIDEO_ALLOWED = true
}
