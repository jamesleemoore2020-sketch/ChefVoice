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
    val communityUpdatePending: Boolean = false,
    val tags: List<String> = emptyList(),
    /**
     * Where this recipe was imported from, or blank for one the chef narrated.
     *
     * **Local to this device.** It is never written to Firestore -- the cloud repository
     * allow-lists the fields it sends, so adding it needs no rules change -- and it exists for
     * one reason: to warn a chef, once, before they publish another site's method to Community
     * under their own name. The credit itself lives in the description, which is the field that
     * travels with a published recipe.
     */
    val importedFrom: String = ""
)

fun Recipe.stableStepIds(): List<String> = steps.indices.map { index ->
    stepIds.getOrNull(index)?.takeIf { it.isNotBlank() } ?: "${id}:step:${index + 1}"
}

fun Recipe.stepIdAt(index: Int): String = stableStepIds().getOrElse(index) { "${id}:step:${index + 1}" }

/**
 * One line on the shopping list.
 *
 * [recipeTitle] can name several recipes once lines have been merged, which is what
 * lets a chef see that the 3 cups of flour came from two different dishes.
 */
data class ShoppingItem(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val quantity: String = "",
    val unit: String = "",
    val recipeId: String = "",
    val recipeTitle: String = "",
    val checked: Boolean = false,
    val addedAt: Long = System.currentTimeMillis()
) {
    fun displayText(): String = listOf(quantity, unit, name)
        .filter { it.isNotBlank() }
        .joinToString(" ")
}

/**
 * A chef-named group of their own saved recipes -- "Weeknight", "Thanksgiving".
 *
 * Deliberately **local to the device**, stored beside the recipes themselves. Cloud
 * bookmarks already exist for saving other chefs' dishes; this is the chef's own
 * filing of their own library, so it needs no Firestore collection and no security
 * rule, and therefore no rules deploy. Recipe ids that no longer resolve are ignored
 * at read time rather than pruned, so deleting a recipe cannot corrupt a collection.
 */
data class RecipeCollection(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val recipeIds: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

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
    val clapCount: Int = 0,
    val tags: List<String> = emptyList()
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
    val isLifetime: Boolean get() = productId == PRODUCT_LIFETIME

    /** Granted a founding seat: 2 free years, never revoked by the promo kill switch. */
    val isFounding: Boolean get() = source == SOURCE_FOUNDING

    /** Inside the free 90-day launch window rather than paying. */
    val isPromo: Boolean get() = source == SOURCE_PROMO

    /**
     * Pro without paying for it. The UI must not describe these chefs as subscribers,
     * offer them a "manage subscription" link, or warn them about a payment method
     * they never entered.
     */
    val isComplimentary: Boolean get() = isFounding || isPromo

    /** Whole days of a promo window still remaining, floored at zero. */
    fun daysRemaining(nowMs: Long = System.currentTimeMillis()): Int {
        if (expiresAt <= 0L) return Int.MAX_VALUE
        val remaining = expiresAt - nowMs
        if (remaining <= 0L) return 0
        return ((remaining + 86_400_000L - 1L) / 86_400_000L).toInt()
    }

    companion object {
        const val STATUS_ACTIVE = "active"
        const val STATUS_IN_GRACE = "in_grace"
        const val STATUS_ON_HOLD = "on_hold"
        const val STATUS_PAUSED = "paused"
        const val STATUS_EXPIRED = "expired"

        const val PRODUCT_MONTHLY = "chefvoice_pro_monthly"
        const val PRODUCT_ANNUAL = "chefvoice_pro_annual"
        const val PRODUCT_LIFETIME = "chefvoice_pro_lifetime"

        /** A verified Google Play purchase. */
        const val SOURCE_PLAY = "play"

        /** One of the first 10 signups. Two free years, written by chefvoice-billing. */
        const val SOURCE_FOUNDING = "founding"

        /** The free 90-day launch window granted at signup. */
        const val SOURCE_PROMO = "promo"

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

/**
 * How much audio one ChefVoice Review is allowed to send to the cloud.
 *
 * Unlike the per-month counts above this is not a tier lever -- Free and Pro get the
 * same ceiling -- because it bounds the cost of a single review rather than how many
 * a chef may run. Cloud speech is billed per minute of audio, so this is the number
 * that decides what a review costs.
 *
 * It does not limit Cook & Capture. A chef can narrate for as long as they like; the
 * local recording is the source of truth and is never truncated, only left out of
 * cloud review when it runs past this length.
 *
 * The repository enforces it and the PWA mirrors it in web/js/firebase-client.js.
 * Changing it means changing it in both places together.
 */
object SecondPassLimits {
    const val MAX_REVIEW_DURATION_MS = 5L * 60L * 1000L
    const val MAX_REVIEW_MINUTES = MAX_REVIEW_DURATION_MS / 60_000L
}

/**
 * Launch access, granted by the `chefvoice-billing` Functions codebase.
 *
 * These numbers are display copy only. The backend owns the real decision and writes
 * the entitlement document; the app never grants itself anything. They are mirrored
 * here so the membership card can say "one of the first 10", "2 years" and "90 days"
 * without inventing numbers, and they must be changed in both places together —
 * `billing/functions/index.js` holds the authoritative set.
 */
object FoundingAccess {
    const val SEATS = 10
    const val FOUNDING_YEARS = 2
    const val PROMO_DAYS = 90
}
