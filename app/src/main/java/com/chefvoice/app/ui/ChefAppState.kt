package com.chefvoice.app.ui

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.chefvoice.app.analytics.ChefAnalytics
import com.chefvoice.app.billing.ChefVoiceOffer
import com.chefvoice.app.billing.PlayBillingManager
import com.chefvoice.app.cloud.FirebaseSocialRepository
import com.chefvoice.app.data.RecipeRepository
import com.chefvoice.app.media.AudioPlayer
import com.chefvoice.app.model.ChefNotification
import com.chefvoice.app.model.ChefProfile
import com.chefvoice.app.model.ChefReport
import com.chefvoice.app.model.ChefSearchResult
import com.chefvoice.app.model.CommunityItem
import com.chefvoice.app.model.DirectConversation
import com.chefvoice.app.model.DirectMessage
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.LiveComment
import com.chefvoice.app.model.LiveSession
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.NotificationPreferences
import com.chefvoice.app.model.FreeTierLimits
import com.chefvoice.app.model.ProEntitlement
import com.chefvoice.app.model.ProTierLimits
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.RecipeCollection
import com.chefvoice.app.model.ShoppingItem
import com.chefvoice.app.model.RecipeComment
import com.chefvoice.app.model.stableStepIds
import com.chefvoice.app.util.ShoppingList
import com.chefvoice.app.voice.SecondPassReviewer
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.ListenerRegistration
import java.io.File
import java.util.UUID

class ChefAppState(context: Context) {
    // Debug builds only. Gates the Pro preview switch so a release APK has no code
    // path that can grant entitlement locally - entitlement stays server-authoritative.
    private val isDebuggableBuild =
        (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

    // Month-keyed Second Pass usage. This is UX gating, not enforcement: it lives on
    // the device and a determined user can reset it by clearing app data. Real
    // enforcement has to be server-side, and cannot be finished until the Second Pass
    // allowance is checked by the function that actually spends the Chirp 3 budget.
    private val quotaPrefs = context.getSharedPreferences("chefvoice_quota", Context.MODE_PRIVATE)

    private val repository = RecipeRepository(context)
    private val audioPlayer = AudioPlayer()
    private val cloud = FirebaseSocialRepository(context)
    private val playBilling = PlayBillingManager(context)

    val recipes = mutableStateListOf<Recipe>()
    val collections = mutableStateListOf<RecipeCollection>()
    val shoppingItems = mutableStateListOf<ShoppingItem>()
    val cloudRecipes = mutableStateListOf<Recipe>()
    val comments = mutableStateListOf<RecipeComment>()
    val conversations = mutableStateListOf<DirectConversation>()
    val notifications = mutableStateListOf<ChefNotification>()
    val moderationReports = mutableStateListOf<ChefReport>()
    val directMessages = mutableStateListOf<DirectMessage>()
    private val conversationReadAt = mutableStateMapOf<String, Long>()
    private val blockedUserIds = mutableStateListOf<String>()
    val liveSessions = mutableStateListOf<LiveSession>()
    val liveComments = mutableStateListOf<LiveComment>()
    private val communityProfiles = mutableStateMapOf<String, ChefProfile>()
    val chefSearchResults = mutableStateListOf<ChefSearchResult>()

    private val localLikedIds = mutableStateListOf<String>()
    private val cloudLikedIds = mutableStateListOf<String>()
    private val bookmarkIds = mutableStateListOf<String>()
    private val followingIds = mutableStateListOf<String>()

    var displayName by mutableStateOf(repository.loadDisplayName())
        private set
    var profileBio by mutableStateOf("")
        private set
    var profilePhotoUrl by mutableStateOf("")
        private set
    var profileCoverPhotoUrl by mutableStateOf("")
        private set
    var profileFavoriteThings by mutableStateOf<List<String>>(emptyList())
        private set
    var recipeAuthorProfile by mutableStateOf<ChefProfile?>(null)
        private set
    var selectedChefUid by mutableStateOf("")
        private set
    var selectedChefProfile by mutableStateOf<ChefProfile?>(null)
        private set
    var selectedChefFollowerCount by mutableStateOf(0L)
        private set
    var selectedChefProfileLoading by mutableStateOf(false)
        private set
    var ownFollowerCount by mutableStateOf(0L)
        private set
    var liveHostProfile by mutableStateOf<ChefProfile?>(null)
        private set
    private var recipeBehindChefProfile: Recipe? = null
    var selectedRecipe by mutableStateOf<Recipe?>(null)
    var focusedCommentId by mutableStateOf("")
        private set
    var cookingRecipe by mutableStateOf<Recipe?>(null)
    var showShoppingList by mutableStateOf(false)
    var activeCollectionId by mutableStateOf("")
    var shoppingMessage by mutableStateOf("")
    var selectedLiveSession by mutableStateOf<LiveSession?>(null)
        private set
    var selectedConversation by mutableStateOf<DirectConversation?>(null)
        private set
    var cloudMessage by mutableStateOf("")
        private set
    var accountBusy by mutableStateOf(false)
        private set

    /** Mirror of users/{uid}/entitlements/pro. Free until the backend says otherwise. */
    var proEntitlement by mutableStateOf(ProEntitlement.FREE)
        private set

    /**
     * Debug-only override so the paid experience can be demonstrated before Play
     * Billing products exist. Never consulted in a release build, and never written
     * to Firestore - it only changes what this device renders.
     */
    var proPreviewOverride by mutableStateOf(false)

    val proPreviewAvailable: Boolean get() = isDebuggableBuild

    /** Non-empty while a paywall should be shown; the value is the PaywallTrigger. */
    var paywallTrigger by mutableStateOf("")

    // Play-formatted prices for display only. What a purchase actually grants is
    // decided by verifyChefVoicePurchase against the live Play Developer API, never
    // by anything read from BillingClient on-device.
    private var monthlyOffer: ChefVoiceOffer.Subscription? = null
    private var annualOffer: ChefVoiceOffer.Subscription? = null
    private var lifetimeOffer: ChefVoiceOffer.Lifetime? = null
    var proMonthlyPriceLabel by mutableStateOf("")
        private set
    var proAnnualPriceLabel by mutableStateOf("")
        private set
    var proLifetimePriceLabel by mutableStateOf("")
        private set
    var checkoutError by mutableStateOf("")
        private set

    /** Second Pass reviews used in the current calendar month, on this device. */
    var secondPassUsedThisMonth by mutableStateOf(0)
        private set

    /** The single value the UI gates on. Fails closed to Free. */
    val isPro: Boolean
        get() = proEntitlement.isActive || (isDebuggableBuild && proPreviewOverride)

    var needsReauthForDelete by mutableStateOf(false)
        private set
    var liveBusy by mutableStateOf(false)
    var recipeMutationBusyId by mutableStateOf("")
        private set
    var liveSessionsReady by mutableStateOf(!cloud.isConfigured)
        private set
    var messageBusy by mutableStateOf(false)
        private set
    var conversationsReady by mutableStateOf(false)
        private set
    var messageReadsReady by mutableStateOf(false)
        private set
    var messageInboxError by mutableStateOf("")
        private set
    var messageReadError by mutableStateOf("")
        private set
    var notificationsReady by mutableStateOf(false)
        private set
    var notificationsError by mutableStateOf("")
        private set
    var notificationPreferences by mutableStateOf(NotificationPreferences())
        private set
    var notificationPreferencesReady by mutableStateOf(false)
        private set
    var notificationPreferencesError by mutableStateOf("")
        private set
    var blockStatusError by mutableStateOf("")
        private set
    var chefSearchBusy by mutableStateOf(false)
        private set
    var chefSearchError by mutableStateOf("")
        private set
    var communityHasMore by mutableStateOf(true)
        private set
    var communityLoadingMore by mutableStateOf(false)
        private set
    private var chefSearchRequestId = 0
    var directMessagesLoading by mutableStateOf(false)
        private set
    var directMessagesError by mutableStateOf("")
        private set
    var secondPassBusyRecipeId by mutableStateOf("")
        private set
    var secondPassMessage by mutableStateOf("")
        private set
    var signedInUserId by mutableStateOf("")
        private set
    var signedInEmail by mutableStateOf("")
        private set
    var signedInEmailVerified by mutableStateOf(false)
        private set
    var moderatorAccess by mutableStateOf(false)
        private set
    var moderationError by mutableStateOf("")
        private set

    val cloudConfigured: Boolean get() = cloud.isConfigured
    val isSignedIn: Boolean get() = signedInUserId.isNotBlank()
    val followingCount: Int get() = followingIds.size
    val bookmarkCount: Int get() = bookmarkIds.size
    val messageInboxLoading: Boolean get() = isSignedIn && (!conversationsReady || !messageReadsReady)
    val unreadConversationCount: Int get() = conversations.count(::isConversationUnread)
    val unreadNotificationCount: Int get() = notifications.count { it.isUnread }

    fun isConversationUnread(conversation: DirectConversation): Boolean =
        conversation.isUnreadFor(signedInUserId, conversationReadAt[conversation.id] ?: 0L)

    fun isUserBlocked(uid: String): Boolean = uid.isNotBlank() && blockedUserIds.contains(uid)

    private var authListener: FirebaseAuth.AuthStateListener? = null
    private var feedListener: ListenerRegistration? = null
    private var liveFeedListener: ListenerRegistration? = null
    private var profileListener: ListenerRegistration? = null
    private var entitlementListener: ListenerRegistration? = null
    private var recipeAuthorProfileListener: ListenerRegistration? = null
    private var selectedChefProfileListener: ListenerRegistration? = null
    private var liveHostProfileListener: ListenerRegistration? = null
    private var likesListener: ListenerRegistration? = null
    private var bookmarksListener: ListenerRegistration? = null
    private var followingListener: ListenerRegistration? = null
    private var commentsListener: ListenerRegistration? = null
    private var conversationsListener: ListenerRegistration? = null
    private var notificationsListener: ListenerRegistration? = null
    private var notificationPreferencesListener: ListenerRegistration? = null
    private var messageReadsListener: ListenerRegistration? = null
    private var blocksListener: ListenerRegistration? = null
    private var moderationReportsListener: ListenerRegistration? = null
    private var directMessagesListener: ListenerRegistration? = null
    private var liveCommentsListener: ListenerRegistration? = null
    private val liveHeartbeatHandler = Handler(Looper.getMainLooper())
    private var liveHeartbeatRunnable: Runnable? = null

    init {
        loadSecondPassUsage()
        loadProOffers()
        recipes.addAll(repository.loadRecipes())
        collections.addAll(repository.loadCollections())
        shoppingItems.addAll(repository.loadShoppingItems())
        localLikedIds.addAll(repository.loadLikedIds())
        // Reclaim media and cooking audio from abandoned sessions and deleted
        // recipes. Off the main thread: this touches the filesystem.
        Thread { runCatching { repository.pruneOrphanedMedia() } }.start()
        if (cloudConfigured) {
            feedListener = cloud.listenPublicRecipes(
                onChanged = { incoming, hasMore ->
                    cloudRecipes.clear()
                    cloudRecipes.addAll(incoming)
                    communityHasMore = hasMore
                    hydrateProfiles(incoming.map { it.authorId })
                    selectedRecipe?.let { selected ->
                        // Keep local media paths/transcript for recipes owned on this phone.
                        if (recipes.none { it.id == selected.id }) {
                            incoming.firstOrNull { it.id == selected.id }?.let { refreshed -> selectedRecipe = refreshed }
                        }
                    }
                },
                onError = { cloudMessage = it }
            )
            liveFeedListener = cloud.listenLiveSessions(
                onChanged = { incoming ->
                    liveSessionsReady = true
                    liveSessions.clear()
                    liveSessions.addAll(incoming)
                    hydrateProfiles(incoming.map { it.hostId })
                    selectedLiveSession?.let { selected ->
                        val refreshed = incoming.firstOrNull { it.id == selected.id }
                        if (refreshed != null) {
                            selectedLiveSession = refreshed
                        } else if (selected.status == "LIVE") {
                            selectedLiveSession = selected.copy(status = "ENDED", endedAt = System.currentTimeMillis())
                        }
                    }
                },
                onError = {
                    liveSessionsReady = true
                    cloudMessage = it
                }
            )
            authListener = cloud.addAuthListener { user ->
                clearUserListeners()
                signedInUserId = user?.uid.orEmpty()
                signedInEmail = user?.email.orEmpty()
                signedInEmailVerified = user?.isEmailVerified == true
                needsReauthForDelete = false
                moderatorAccess = false
                moderationReports.clear()
                moderationError = ""
                cloudLikedIds.clear()
                bookmarkIds.clear()
                followingIds.clear()
                ownFollowerCount = 0L
                conversations.clear()
                notifications.clear()
                directMessages.clear()
                conversationReadAt.clear()
                blockedUserIds.clear()
                selectedConversation = null
                conversationsReady = user == null
                messageReadsReady = user == null
                notificationsReady = user == null
                notificationPreferences = NotificationPreferences()
                notificationPreferencesReady = user == null
                notificationPreferencesError = ""
                messageInboxError = ""
                messageReadError = ""
                notificationsError = ""
                blockStatusError = ""
                directMessagesLoading = false
                directMessagesError = ""
                if (user != null) startUserListeners(user.uid)
            }
        }
    }

    private fun startUserListeners(uid: String) {
        conversationsReady = false
        messageReadsReady = false
        notificationsReady = false
        notificationPreferencesReady = false
        notificationPreferencesError = ""
        messageInboxError = ""
        messageReadError = ""
        notificationsError = ""
        blockStatusError = ""
        entitlementListener = cloud.listenProEntitlement(uid) { entitlement ->
            proEntitlement = entitlement
        }
        // Not only for a fresh install: this is what surfaces a purchase made on
        // another device, and what finishes verifying/acknowledging a purchase
        // whose first attempt was interrupted (app killed mid-flow, network drop).
        playBilling.restorePurchases()
                profileListener = cloud.listenProfile(uid) { profile ->
            if (profile == null) {
                // No profile document exists for this account yet, so this is the one
                // write that is allowed to set createdAt.
                cloud.saveProfile(
                    ChefProfile(uid = uid, displayName = displayName, bio = profileBio),
                    isNewProfile = true
                ) { error ->
                    if (error != null) cloudMessage = error
                }
            } else {
                communityProfiles[uid] = profile
                displayName = profile.displayName.ifBlank { displayName }
                profileBio = profile.bio
                profilePhotoUrl = profile.photoUrl
                profileCoverPhotoUrl = profile.coverPhotoUrl
                profileFavoriteThings = profile.favoriteThings
                repository.saveDisplayName(displayName)
            }
        }
        refreshOwnFollowerCount(uid)
        likesListener = cloud.listenLikedRecipeIds(uid) { ids ->
            cloudLikedIds.clear(); cloudLikedIds.addAll(ids)
        }
        bookmarksListener = cloud.listenBookmarkIds(uid) { ids ->
            bookmarkIds.clear(); bookmarkIds.addAll(ids)
        }
        followingListener = cloud.listenFollowingIds(uid) { ids ->
            followingIds.clear(); followingIds.addAll(ids)
        }
        cloud.syncNotificationDevice { error ->
            if (error != null) notificationsError = error
        }
        notificationsListener = cloud.listenNotifications(
            uid = uid,
            onChanged = { incoming ->
                notificationsReady = true
                notificationsError = ""
                notifications.clear(); notifications.addAll(incoming)
            },
            onError = {
                notificationsReady = true
                notificationsError = it
            }
        )
        notificationPreferencesListener = cloud.listenNotificationPreferences(
            uid = uid,
            onChanged = { preferences ->
                notificationPreferences = preferences
                notificationPreferencesReady = true
                notificationPreferencesError = ""
            },
            onError = {
                notificationPreferencesReady = true
                notificationPreferencesError = it
            }
        )
        conversationsListener = cloud.listenConversations(
            uid = uid,
            onChanged = { incoming ->
                conversationsReady = true
                messageInboxError = ""
                conversations.clear(); conversations.addAll(incoming)
                selectedConversation?.let { selected ->
                    incoming.firstOrNull { it.id == selected.id }?.let { refreshed ->
                        selectedConversation = refreshed
                        markConversationReadIfNeeded(refreshed)
                    }
                }
            },
            onError = {
                conversationsReady = true
                messageInboxError = it
            }
        )
        messageReadsListener = cloud.listenMessageReadAt(
            uid = uid,
            onChanged = { incoming ->
                messageReadsReady = true
                messageReadError = ""
                conversationReadAt.clear(); conversationReadAt.putAll(incoming)
            },
            onError = {
                messageReadsReady = true
                messageReadError = it
            }
        )
        blocksListener = cloud.listenBlockedUserIds(
            uid = uid,
            onChanged = { incoming ->
                blockStatusError = ""
                blockedUserIds.clear(); blockedUserIds.addAll(incoming.sorted())
            },
            onError = { blockStatusError = it }
        )
        cloud.checkModeratorAccess { allowed, error ->
            moderatorAccess = allowed
            moderationError = error.orEmpty()
            moderationReportsListener?.remove(); moderationReportsListener = null
            if (allowed) {
                moderationReportsListener = cloud.listenModerationReports(
                    onChanged = { incoming -> moderationReports.clear(); moderationReports.addAll(incoming); moderationError = "" },
                    onError = { moderationError = it }
                )
            }
        }
    }

    private fun clearUserListeners() {
        profileListener?.remove(); profileListener = null
        entitlementListener?.remove(); entitlementListener = null
        proEntitlement = ProEntitlement.FREE
        recipeAuthorProfileListener?.remove(); recipeAuthorProfileListener = null
        recipeAuthorProfile = null
        selectedChefProfileListener?.remove(); selectedChefProfileListener = null
        selectedChefUid = ""; selectedChefProfile = null; selectedChefFollowerCount = 0L; selectedChefProfileLoading = false; recipeBehindChefProfile = null
        liveHostProfileListener?.remove(); liveHostProfileListener = null
        liveHostProfile = null
        likesListener?.remove(); likesListener = null
        bookmarksListener?.remove(); bookmarksListener = null
        followingListener?.remove(); followingListener = null
        conversationsListener?.remove(); conversationsListener = null
        notificationsListener?.remove(); notificationsListener = null
        notificationPreferencesListener?.remove(); notificationPreferencesListener = null
        messageReadsListener?.remove(); messageReadsListener = null
        blocksListener?.remove(); blocksListener = null
        moderationReportsListener?.remove(); moderationReportsListener = null
        moderationReports.clear(); moderatorAccess = false; moderationError = ""
        directMessagesListener?.remove(); directMessagesListener = null
        chefSearchResults.clear(); chefSearchBusy = false; chefSearchError = ""
    }

    private fun hydrateProfiles(uids: List<String>) {
        uids.filter { it.isNotBlank() }.distinct().filterNot { communityProfiles.containsKey(it) }.take(24).forEach { uid ->
            cloud.getProfile(uid) { profile -> if (profile != null) communityProfiles[uid] = profile }
        }
    }

    fun chefProfile(uid: String): ChefProfile? = communityProfiles[uid]

    fun searchChefs(searchText: String) {
        val term = searchText.trim()
        val requestId = ++chefSearchRequestId
        chefSearchError = ""
        if (term.length < 2) { chefSearchResults.clear(); chefSearchBusy = false; return }
        chefSearchBusy = true
        cloud.searchChefProfiles(term) { results, error ->
            if (requestId != chefSearchRequestId) return@searchChefProfiles
            chefSearchBusy = false
            chefSearchResults.clear()
            if (results != null) {
                chefSearchResults.addAll(results)
                results.forEach { communityProfiles[it.profile.uid] = it.profile }
            }
            chefSearchError = error.orEmpty()
        }
    }

    private fun refreshOwnFollowerCount(uid: String = signedInUserId) {
        if (uid.isBlank()) { ownFollowerCount = 0L; return }
        cloud.getFollowerCount(uid) { count, _ -> if (uid == signedInUserId && count != null) ownFollowerCount = count }
    }

    fun openChefProfile(uid: String) {
        if (uid.isBlank()) return
        if (selectedRecipe != null) { recipeBehindChefProfile = selectedRecipe; selectedRecipe = null }
        selectedChefUid = uid
        selectedChefProfile = communityProfiles[uid]
        selectedChefFollowerCount = if (uid == signedInUserId) ownFollowerCount else 0L
        selectedChefProfileLoading = true
        selectedChefProfileListener?.remove()
        selectedChefProfileListener = cloud.listenProfile(uid) { profile ->
            selectedChefProfileLoading = false
            selectedChefProfile = profile
            if (profile != null) communityProfiles[uid] = profile
        }
        cloud.getFollowerCount(uid) { count, error ->
            if (uid == selectedChefUid) {
                if (count != null) selectedChefFollowerCount = count
                if (error != null) cloudMessage = error
                selectedChefProfileLoading = false
            }
        }
    }

    fun closeChefProfile() {
        selectedChefProfileListener?.remove(); selectedChefProfileListener = null
        selectedChefUid = ""; selectedChefProfile = null; selectedChefFollowerCount = 0L; selectedChefProfileLoading = false
        recipeBehindChefProfile?.let { selectedRecipe = it }
        recipeBehindChefProfile = null
    }

    fun openRecipeFromChefProfile(recipe: Recipe) {
        selectedRecipe = recipe
        secondPassMessage = ""
        comments.clear()
        commentsListener?.remove()
        recipeAuthorProfileListener?.remove()
        recipeAuthorProfile = communityProfiles[recipe.authorId]
        commentsListener = if (cloudConfigured && recipe.isPublic && recipe.authorId.isNotBlank()) {
            cloud.listenComments(recipe.id) { incoming -> comments.clear(); comments.addAll(incoming) }
        } else null
        recipeAuthorProfileListener = if (cloudConfigured && recipe.authorId.isNotBlank()) {
            cloud.listenProfile(recipe.authorId) { profile -> recipeAuthorProfile = profile; if (profile != null) communityProfiles[recipe.authorId] = profile }
        } else null
    }

    fun loadMoreCommunity() {
        if (communityLoadingMore || !communityHasMore) return
        communityLoadingMore = true
        cloud.loadMorePublicRecipes { incoming, hasMore, error ->
            communityLoadingMore = false
            communityHasMore = hasMore
            if (error != null) { cloudMessage = error; return@loadMorePublicRecipes }
            val merged = LinkedHashMap<String, Recipe>()
            cloudRecipes.forEach { merged[it.id] = it }
            incoming.orEmpty().forEach { merged[it.id] = it }
            cloudRecipes.clear()
            cloudRecipes.addAll(merged.values.sortedByDescending { it.updatedAt })
            hydrateProfiles(incoming.orEmpty().map { it.authorId })
        }
    }

    fun publicRecipesFor(uid: String): List<Recipe> = cloudRecipes.filter { it.authorId == uid && it.isPublic }.sortedByDescending { it.updatedAt }

    fun activeLiveFor(uid: String): LiveSession? = liveSessions.firstOrNull { it.hostId == uid && it.status == "LIVE" }

    fun updateNotificationPreferences(preferences: NotificationPreferences) {
        if (!isSignedIn) { notificationPreferencesError = "Sign in to update notification preferences."; return }
        val previous = notificationPreferences
        notificationPreferences = preferences
        notificationPreferencesError = ""
        cloud.saveNotificationPreferences(preferences) { error ->
            if (error != null) {
                notificationPreferences = previous
                notificationPreferencesError = error
            }
        }
    }

    fun openNotification(notification: ChefNotification) {
        if (notification.isUnread) {
            val previousIndex = notifications.indexOfFirst { it.id == notification.id }
            if (previousIndex >= 0) {
                notifications[previousIndex] = notifications[previousIndex].copy(readAt = System.currentTimeMillis())
            }
            cloud.markNotificationRead(notification.id) { error ->
                if (error != null) notificationsError = error
            }
        }

        when (notification.type) {
            "message" -> {
                val conversation = conversations.firstOrNull { it.id == notification.conversationId }
                if (conversation != null) openConversation(conversation)
                else cloudMessage = "That conversation is not available yet. Open Messages and refresh."
            }
            "comment", "like", "reply" -> {
                val recipe = (recipes + cloudRecipes).firstOrNull { it.id == notification.recipeId }
                if (recipe != null) {
                    openRecipe(recipe)
                    if (notification.type == "reply") focusedCommentId = notification.commentId
                } else cloudMessage = "That recipe is not available in the current Community feed."
            }
            "live" -> {
                val session = liveSessions.firstOrNull { it.id == notification.liveSessionId }
                if (session != null) openLiveSession(session)
                else cloudMessage = "That Live session has ended or is no longer available."
            }
            "follow" -> {
                if (notification.actorUid.isNotBlank()) openChefProfile(notification.actorUid)
                else cloudMessage = "That Chef Profile is not available."
            }
            else -> cloudMessage = notification.body.ifBlank { "ChefVoice notification opened." }
        }
    }

    fun markAllNotificationsRead() {
        notifications.filter { it.isUnread }.forEach { item ->
            val index = notifications.indexOfFirst { it.id == item.id }
            if (index >= 0) notifications[index] = notifications[index].copy(readAt = System.currentTimeMillis())
            cloud.markNotificationRead(item.id) { error ->
                if (error != null) notificationsError = error
            }
        }
    }

    fun clearReadNotifications() {
        if (!isSignedIn) { notificationsError = "Sign in to clear notifications."; return }
        val readItems = notifications.filterNot { it.isUnread }
        if (readItems.isEmpty()) return
        val ids = readItems.map { it.id }
        notifications.removeAll { it.id in ids }
        notificationsError = ""
        cloud.deleteNotifications(ids) { error ->
            if (error != null) notificationsError = "Could not clear read notifications: $error"
        }
    }

    /**
     * Clears one notification, whether it has been read or not.
     *
     * Backs both the per-row close button and the swipe on the Notifications tab, so a
     * chef can deal with a single alert without clearing everything they have read.
     * Removed from the list first so the row goes away with the gesture rather than
     * after a Firestore round trip; the listener would drop it anyway once the delete
     * lands, and a failed delete restores it along with the reason.
     */
    fun dismissNotification(notification: ChefNotification) {
        if (!isSignedIn) { notificationsError = "Sign in to clear notifications."; return }
        val index = notifications.indexOfFirst { it.id == notification.id }
        if (index < 0) return
        val removed = notifications.removeAt(index)
        notificationsError = ""
        cloud.deleteNotifications(listOf(removed.id)) { error ->
            if (error != null) {
                if (notifications.none { it.id == removed.id }) {
                    notifications.add(index.coerceAtMost(notifications.size), removed)
                }
                notificationsError = "That notification could not be cleared: $error"
            }
        }
    }

    fun openRecipe(recipe: Recipe) {
        selectedRecipe = recipe
        focusedCommentId = ""
        secondPassMessage = ""
        comments.clear()
        commentsListener?.remove()
        recipeAuthorProfileListener?.remove()
        recipeAuthorProfile = null
        commentsListener = if (cloudConfigured && recipe.isPublic && recipe.authorId.isNotBlank()) {
            cloud.listenComments(recipe.id) { incoming -> comments.clear(); comments.addAll(incoming) }
        } else null
        recipeAuthorProfileListener = if (cloudConfigured && recipe.authorId.isNotBlank()) {
            cloud.listenProfile(recipe.authorId) { profile -> recipeAuthorProfile = profile; if (profile != null) communityProfiles[recipe.authorId] = profile }
        } else null
    }

    fun closeRecipe() {
        selectedRecipe = null
        secondPassMessage = ""
        comments.clear()
        commentsListener?.remove()
        commentsListener = null
        recipeAuthorProfileListener?.remove()
        recipeAuthorProfileListener = null
        recipeAuthorProfile = null
    }

    fun openConversation(conversation: DirectConversation) {
        selectedConversation = conversation
        directMessages.clear()
        directMessagesError = ""
        directMessagesLoading = cloudConfigured && isSignedIn
        directMessagesListener?.remove()
        markConversationReadIfNeeded(conversation)
        directMessagesListener = if (cloudConfigured && isSignedIn) {
            cloud.listenDirectMessages(
                conversationId = conversation.id,
                onChanged = { incoming ->
                    directMessagesLoading = false
                    directMessagesError = ""
                    directMessages.clear(); directMessages.addAll(incoming)
                    selectedConversation?.let(::markConversationReadIfNeeded)
                },
                onError = {
                    directMessagesLoading = false
                    directMessagesError = it
                }
            )
        } else null
        if (directMessagesListener == null) directMessagesLoading = false
    }

    private fun markConversationReadIfNeeded(conversation: DirectConversation) {
        if (!isConversationUnread(conversation)) return
        val previous = conversationReadAt[conversation.id] ?: 0L
        conversationReadAt[conversation.id] = conversation.updatedAt
        cloud.markConversationRead(conversation.id, conversation.updatedAt) { error ->
            if (error != null) {
                if (conversationReadAt[conversation.id] == conversation.updatedAt) {
                    conversationReadAt[conversation.id] = previous
                }
                messageReadError = error
            }
        }
    }

    fun closeConversation() {
        selectedConversation = null
        directMessages.clear()
        directMessagesListener?.remove()
        directMessagesListener = null
        directMessagesLoading = false
        directMessagesError = ""
        messageBusy = false
    }

    fun startConversationWith(recipe: Recipe) = startConversationWithChef(recipe.authorId, recipe.authorName)

    fun startConversationWithChef(targetUid: String, targetName: String) {
        if (messageBusy) return
        if (!cloudConfigured) { cloudMessage = "Connect Firebase before messaging chefs."; return }
        if (!isSignedIn) { cloudMessage = "Sign in on Profile before messaging chefs."; return }
        if (targetUid.isBlank() || targetUid == signedInUserId) { cloudMessage = "Choose another Community chef to message."; return }
        if (isUserBlocked(targetUid)) { cloudMessage = "You blocked this chef. Unblock them from your existing conversation before sending new private messages."; return }
        messageBusy = true
        cloudMessage = "Opening messages…"
        cloud.startConversation(targetUid, targetName, displayName) { conversation, error ->
            messageBusy = false
            if (error != null) {
                cloudMessage = if (error.contains("permission", ignoreCase = true)) "Messaging security rules need the ChefVoice community/profile rules deploy. Run DEPLOY_COMMUNITY_PROFILE_RULES.cmd on the PC, then try again." else error
            } else if (conversation != null) {
                selectedChefProfileListener?.remove(); selectedChefProfileListener = null
                selectedChefUid = ""; selectedChefProfile = null; selectedChefFollowerCount = 0L; selectedChefProfileLoading = false; recipeBehindChefProfile = null
                cloudMessage = "Private messages with ${targetName.ifBlank { "Chef" }}."
                openConversation(conversation)
            }
        }
    }

    fun sendDirectMessage(text: String, onDone: (Boolean) -> Unit = {}) {
        val conversation = selectedConversation ?: return onDone(false)
        if (messageBusy) return onDone(false)
        if (isUserBlocked(conversation.otherUserId(signedInUserId))) {
            cloudMessage = "Unblock this chef before sending new private messages."
            return onDone(false)
        }
        messageBusy = true
        cloud.sendDirectMessage(conversation, text, displayName) { error ->
            messageBusy = false
            cloudMessage = when {
                error == null -> "Message sent."
                error.contains("permission", ignoreCase = true) -> "This conversation is not accepting new messages right now."
                else -> error
            }
            onDone(error == null)
        }
    }

    fun reportChef(uid: String) {
        if (uid.isBlank()) return
        cloud.submitReport("user", targetId = uid, targetUid = uid, reason = "Chef Profile report") { error -> cloudMessage = error ?: "Report submitted." }
    }

    fun reportRecipe(recipe: Recipe) {
        cloud.submitReport("recipe", targetId = recipe.id, targetUid = recipe.authorId, contextId = recipe.id, reason = "Recipe report") { error -> cloudMessage = error ?: "Report submitted." }
    }

    fun reportRecipeComment(comment: RecipeComment) {
        val recipe = selectedRecipe ?: return
        cloud.submitReport(if (comment.parentCommentId.isBlank()) "comment" else "reply", targetId = comment.id, targetUid = comment.authorId, contextId = recipe.id, reason = if (comment.parentCommentId.isBlank()) "Recipe comment report" else "Recipe reply report") { error -> cloudMessage = error ?: "Report submitted." }
    }

    fun reportDirectMessage(message: DirectMessage) {
        val conversation = selectedConversation ?: return
        val otherUid = conversation.otherUserId(signedInUserId)
        cloud.submitReport("message", targetId = message.id, targetUid = otherUid, contextId = conversation.id, reason = "Private message report") { error -> cloudMessage = error ?: "Report submitted." }
    }

    fun setConversationUserBlocked(blocked: Boolean) {
        val conversation = selectedConversation ?: return
        setUserBlocked(conversation.otherUserId(signedInUserId), blocked)
    }

    /** Community feed cards and chef profiles block by uid directly, with no
     * open conversation to derive the target from -- setConversationUserBlocked
     * is now just the conversation-scoped case of this. */
    fun setUserBlocked(targetUid: String, blocked: Boolean) {
        if (targetUid.isBlank() || targetUid == signedInUserId || messageBusy) return
        messageBusy = true
        cloud.setUserBlocked(targetUid, blocked) { error ->
            messageBusy = false
            if (error == null) {
                if (blocked) {
                    if (!blockedUserIds.contains(targetUid)) blockedUserIds.add(targetUid)
                    cloudMessage = "Chef blocked. Their recipes stay hidden and neither of you can message the other."
                } else {
                    blockedUserIds.remove(targetUid)
                    cloudMessage = "Chef unblocked."
                }
            } else {
                cloudMessage = error
            }
        }
    }

    private fun stopLiveHeartbeat() {
        liveHeartbeatRunnable?.let(liveHeartbeatHandler::removeCallbacks)
        liveHeartbeatRunnable = null
    }

    private fun startLiveHeartbeat(sessionId: String) {
        stopLiveHeartbeat()
        val runnable = object : Runnable {
            override fun run() {
                val session = selectedLiveSession
                if (session?.id != sessionId || session.hostId != signedInUserId || session.status != "LIVE") {
                    stopLiveHeartbeat()
                    return
                }
                cloud.updateLiveHeartbeat(sessionId) { }
                liveHeartbeatHandler.postDelayed(this, FirebaseSocialRepository.LIVE_HEARTBEAT_INTERVAL_MS)
            }
        }
        liveHeartbeatRunnable = runnable
        liveHeartbeatHandler.post(runnable)
    }

    fun openLiveSession(session: LiveSession) {
        selectedLiveSession = session
        liveHostProfile = communityProfiles[session.hostId]
        liveHostProfileListener?.remove()
        liveHostProfileListener = if (cloudConfigured && session.hostId.isNotBlank()) cloud.listenProfile(session.hostId) { profile ->
            liveHostProfile = profile
            if (profile != null) communityProfiles[session.hostId] = profile
        } else null
        liveComments.clear()
        liveCommentsListener?.remove()
        liveCommentsListener = if (cloudConfigured) {
            cloud.listenLiveComments(session.id) { incoming ->
                liveComments.clear()
                liveComments.addAll(incoming)
            }
        } else null
    }

    fun closeLiveSession() {
        selectedLiveSession = null
        liveHostProfileListener?.remove(); liveHostProfileListener = null
        liveHostProfile = null
        liveComments.clear()
        liveCommentsListener?.remove()
        liveCommentsListener = null
    }

    fun startLive(title: String, tags: List<String> = emptyList()) {
        if (liveBusy) return
        if (!cloudConfigured) {
            cloudMessage = "Connect Firebase before starting a real member live session."
            return
        }
        if (!isSignedIn) {
            cloudMessage = "Sign in on Profile before going live."
            return
        }
        liveBusy = true
        cloudMessage = "Starting live session…"
        cloud.startLiveSession(title, displayName, tags) { session, error ->
            liveBusy = false
            if (error != null) {
                cloudMessage = error
            } else if (session != null) {
                cloudMessage = "Opening camera + microphone…"
                openLiveSession(session)
            }
        }
    }

    fun markLiveReady(sessionId: String) {
        val session = selectedLiveSession ?: return
        if (session.id != sessionId || session.hostId != signedInUserId || session.status == "LIVE") return
        cloud.markLiveSessionReady(sessionId) { error ->
            Log.d("ChefVoiceLive", "markLiveSessionReady callback: error=$error")
            if (error != null) {
                cloudMessage = "Camera and microphone opened, but ChefVoice could not publish the Live room: $error"
                endLiveForSafety("Live room closed because readiness could not be published.")
            } else {
                selectedLiveSession = session.copy(status = "LIVE", heartbeatAt = System.currentTimeMillis())
                cloudMessage = "You are live in the ChefVoice community."
                startLiveHeartbeat(sessionId)
            }
        }
    }

    fun endLive() = endLiveInternal(closeAfter = false, safetyMessage = "")

    fun endLiveAndClose() = endLiveInternal(closeAfter = true, safetyMessage = "")

    fun endLiveForSafety(message: String) = endLiveInternal(closeAfter = false, safetyMessage = message, allowWhileBusy = true)

    private fun endLiveInternal(closeAfter: Boolean, safetyMessage: String, allowWhileBusy: Boolean = false) {
        val session = selectedLiveSession ?: return
        Log.d("ChefVoiceLive", "endLiveInternal called: closeAfter=$closeAfter safetyMessage=\"$safetyMessage\" allowWhileBusy=$allowWhileBusy sessionStatus=${session.status} liveBusy=$liveBusy hostId=${session.hostId} signedInUserId=$signedInUserId")
        if (session.hostId != signedInUserId || (session.status != "LIVE" && session.status != "STARTING")) return
        if (liveBusy && !allowWhileBusy) return
        stopLiveHeartbeat()
        // Stop the visible host surface immediately. Removing LIVE from local state disposes
        // WebRtcLiveHostPanel synchronously, which shuts camera/microphone before cloud latency.
        val ended = session.copy(status = "ENDED", endedAt = System.currentTimeMillis(), heartbeatAt = 0L)
        selectedLiveSession = ended
        liveBusy = true
        cloudMessage = safetyMessage.ifBlank { "Ending live session…" }
        if (closeAfter) closeLiveSession()
        cloud.endLiveSession(session.id) { error ->
            liveBusy = false
            cloudMessage = if (error != null) {
                "Camera and microphone are off. ChefVoice could not mark the cloud Live room ended yet: $error"
            } else {
                safetyMessage.ifBlank { "Live session ended." }
            }
        }
    }

    fun addLiveComment(text: String) {
        val session = selectedLiveSession ?: return
        cloud.addLiveComment(session.id, text, displayName) { error ->
            cloudMessage = error ?: "Live comment posted."
        }
    }

    fun reactLive(reaction: String) {
        val session = selectedLiveSession ?: return
        cloud.sendLiveReaction(session.id, reaction) { error ->
            if (error != null) cloudMessage = error
        }
    }

    fun saveRecipe(recipe: Recipe) {
        val normalized = recipe.copy(stepIds = recipe.stableStepIds())
        val index = recipes.indexOfFirst { it.id == normalized.id }
        if (index >= 0) recipes[index] = normalized else recipes.add(0, normalized)
        persist()
    }

    fun updateRecipeTimes(recipeId: String, prepTimeMinutes: Int, cookTimeMinutes: Int) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val nextPrep = prepTimeMinutes.coerceAtLeast(0)
        val nextCook = cookTimeMinutes.coerceAtLeast(0)
        if (current.prepTimeMinutes == nextPrep && current.cookTimeMinutes == nextCook) return
        val updated = current.copy(
            prepTimeMinutes = nextPrep,
            cookTimeMinutes = nextCook,
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated.copy(stepIds = updated.stableStepIds())
        cloudMessage = if (current.isPublic)
            "Prep/cook times saved on this phone. Tap Update Community when you want members to see them."
        else "Prep/cook times saved to this recipe."
    }

    fun updateRecipeTags(recipeId: String, tags: List<String>) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        if (current.tags == tags) return
        val updated = current.copy(
            tags = tags,
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated.copy(stepIds = updated.stableStepIds())
        cloudMessage = if (current.isPublic)
            "Tags saved on this phone. Tap Update Community when you want members to see them."
        else "Tags saved to this recipe."
    }

    fun addRecipeMedia(recipeId: String, attachment: MediaAttachment) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val updated = current.copy(
            media = current.media + attachment,
            stepIds = current.stableStepIds(),
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated.copy(stepIds = updated.stableStepIds())
        cloudMessage = if (current.isPublic)
            "Media saved on this phone. Tap Update Community when you want members to see it."
        else "Media saved to this recipe on this phone."
    }

    fun removeRecipeMedia(recipeId: String, mediaId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val removed = current.media.firstOrNull { it.id == mediaId } ?: return
        if (removed.path.isNotBlank()) runCatching { File(removed.path).delete() }
        val updated = current.copy(
            media = current.media.filterNot { it.id == mediaId },
            stepIds = current.stableStepIds(),
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated.copy(stepIds = updated.stableStepIds())
        cloudMessage = if (current.isPublic)
            "Media removed on this phone. Tap Update Community to apply the change publicly."
        else "Media removed from this recipe."
    }

    fun removeRecipeIngredient(recipeId: String, ingredientId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        if (current.ingredients.none { it.id == ingredientId }) return
        val nextIngredients = current.ingredients.filterNot { it.id == ingredientId }
        // Removing an ingredient shifts list indices, and ChefVoice Review issues carry a
        // liveIndex into that list — rebuild the review so it never points at the wrong item.
        val nextSecondPass = current.secondPass?.let { result ->
            val rebuilt = SecondPassReviewer.buildReview(nextIngredients, result.ingredients)
            result.copy(issues = rebuilt.issues, confirmedCount = rebuilt.confirmedCount)
        }
        val updated = current.copy(
            ingredients = nextIngredients,
            secondPass = nextSecondPass,
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        cloudMessage = if (current.isPublic)
            "Ingredient removed on this phone. Tap Update Community to apply the change publicly."
        else "Ingredient removed from this recipe."
    }

    fun removeRecipeStep(recipeId: String, stepId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val currentStepIds = current.stableStepIds()
        val index = currentStepIds.indexOf(stepId)
        if (index < 0) return
        val nextSteps = current.steps.toMutableList().apply { removeAt(index) }
        val nextStepIds = currentStepIds.toMutableList().apply { removeAt(index) }
        val orphanedMedia = current.media.filter { it.stepId == stepId }
        orphanedMedia.forEach { attachment ->
            if (attachment.path.isNotBlank()) runCatching { File(attachment.path).delete() }
        }
        // Removing a step shifts list indices, and ChefVoice Review method issues carry a
        // liveIndex into that list — rebuild the review so it never points at the wrong step.
        val nextSecondPass = current.secondPass?.let { result ->
            val rebuilt = SecondPassReviewer.buildMethodReview(nextSteps, result.steps, result.transcript)
            result.copy(methodIssues = rebuilt.issues, methodConfirmedCount = rebuilt.confirmedCount)
        }
        val updated = current.copy(
            steps = nextSteps,
            stepIds = nextStepIds,
            media = current.media.filterNot { it.stepId == stepId },
            secondPass = nextSecondPass,
            communityUpdatePending = current.isPublic || current.communityUpdatePending,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        cloudMessage = if (current.isPublic)
            "Step removed on this phone. Tap Update Community to apply the change publicly."
        else "Step removed from this recipe."
    }

    fun hasSecondPassAudio(recipe: Recipe): Boolean =
        secondPassAudioPath(recipe) != null

    private fun quotaMonthKey(): String {
        val now = java.util.Calendar.getInstance()
        return "%04d-%02d".format(now.get(java.util.Calendar.YEAR), now.get(java.util.Calendar.MONTH) + 1)
    }

    private fun loadSecondPassUsage() {
        secondPassUsedThisMonth = quotaPrefs.getInt("secondPass_" + quotaMonthKey(), 0)
    }

    private fun recordSecondPassUse() {
        val key = "secondPass_" + quotaMonthKey()
        val next = quotaPrefs.getInt(key, 0) + 1
        quotaPrefs.edit().putInt(key, next).apply()
        secondPassUsedThisMonth = next
    }

    /** Reviews allowed this month for the current tier. */
    val secondPassMonthlyLimit: Int
        get() = if (isPro) ProTierLimits.SECOND_PASS_PER_MONTH else FreeTierLimits.SECOND_PASS_PER_MONTH

    val secondPassRemaining: Int
        get() = (secondPassMonthlyLimit - secondPassUsedThisMonth).coerceAtLeast(0)

    /** Cloud-synced recipes this account owns, against the Free cap. */
    val cloudRecipeCount: Int get() = recipes.count { it.isPublic }

    val cloudRecipesRemaining: Int
        get() = if (isPro) Int.MAX_VALUE
        else (FreeTierLimits.CLOUD_RECIPES - cloudRecipeCount).coerceAtLeast(0)

    val videoAllowed: Boolean get() = isPro

    /**
     * The single way a paywall is raised. Every caller goes through here so that
     * `paywall_shown` cannot be missed by a surface that sets the trigger directly,
     * and so the trigger recorded in analytics is always the one the chef actually saw.
     */
    fun showPaywall(trigger: String) {
        if (paywallTrigger == trigger) return
        paywallTrigger = trigger
        ChefAnalytics.paywallShown(trigger)
    }

    fun dismissPaywall() {
        val trigger = paywallTrigger
        if (trigger.isBlank()) return
        paywallTrigger = ""
        ChefAnalytics.paywallDismissed(trigger)
    }

    /** Fetches current Play-formatted prices. Cheap and idempotent; called at startup and safe to call again. */
    fun loadProOffers() {
        playBilling.queryOffers { monthly, annual, lifetime ->
            monthlyOffer = monthly
            annualOffer = annual
            lifetimeOffer = lifetime
            proMonthlyPriceLabel = monthly?.formattedPrice.orEmpty()
            proAnnualPriceLabel = annual?.formattedPrice.orEmpty()
            proLifetimePriceLabel = lifetime?.formattedPrice.orEmpty()
        }
    }

    /**
     * Launches Play's checkout UI for one of ProEntitlement's PRODUCT_* constants.
     * Nothing is granted here or in PlayBillingManager -- entitlement only ever
     * arrives back through the proEntitlement listener once verifyChefVoicePurchase
     * has confirmed the purchase and the backend has written it.
     */
    fun startCheckout(productChoice: String, activity: Activity) {
        if (!isSignedIn) { checkoutError = "Sign in to upgrade to ChefVoice Pro."; return }
        val offer = when (productChoice) {
            ProEntitlement.PRODUCT_MONTHLY -> monthlyOffer
            ProEntitlement.PRODUCT_ANNUAL -> annualOffer
            ProEntitlement.PRODUCT_LIFETIME -> lifetimeOffer
            else -> null
        }
        if (offer == null) { checkoutError = "ChefVoice Pro pricing is still loading. Try again in a moment."; return }
        checkoutError = ""
        // launchBillingFlow only reports whether Play's checkout UI could be shown,
        // not whether a purchase followed -- that arrives later through
        // PurchasesUpdatedListener (verified before anything is granted) and then
        // through the proEntitlement listener once the backend has written it.
        playBilling.launchPurchase(activity, offer, signedInUserId) { error -> checkoutError = error }
    }

    fun dismissCheckoutError() {
        checkoutError = ""
    }

    fun runSecondPass(recipe: Recipe) {
        if (secondPassBusyRecipeId.isNotBlank()) return
        if (!cloudConfigured) {
            secondPassMessage = "Connect Firebase before running ChefVoice Review."
            return
        }
        if (!isSignedIn) {
            secondPassMessage = "Sign in on Profile before checking the original audio."
            return
        }
        loadSecondPassUsage()
        if (secondPassRemaining <= 0) {
            // The paywall is raised here rather than an error message: this is the
            // moment the chef already understands what Second Pass does for them.
            secondPassMessage = "You have used all " + secondPassMonthlyLimit +
                " Second Pass reviews this month."
            showPaywall(PaywallTrigger.SECOND_PASS)
            return
        }
                val audioPath = secondPassAudioPath(recipe)
        if (audioPath == null) {
            secondPassMessage = "No original full cooking-session audio is stored locally for this recipe."
            return
        }

        secondPassBusyRecipeId = recipe.id
        // Recorded here rather than at the tap: every gate above is a reason the review
        // never ran, and counting those as opens would inflate the denominator the
        // paywall's conversion rate is measured against.
        ChefAnalytics.secondPassOpened()
        secondPassMessage = "Uploading the private original audio and running Chirp 3. This can take a few minutes."
        cloud.transcribePrivateChefVoice(recipe.id, audioPath) { cloudResult, error ->
            secondPassBusyRecipeId = ""
            if (error != null) {
                secondPassMessage = error
                return@transcribePrivateChefVoice
            }
            if (cloudResult == null) {
                secondPassMessage = "ChefVoice Review returned no result."
                return@transcribePrivateChefVoice
            }

            val current = recipes.firstOrNull { it.id == recipe.id } ?: recipe
            val secondPass = SecondPassReviewer.fromCloudTranscript(
                liveIngredients = current.ingredients,
                liveSteps = current.steps,
                transcript = cloudResult.transcript,
                rawSegments = cloudResult.segments.map { it.text },
                provider = cloudResult.provider,
                model = cloudResult.model,
                ranAt = cloudResult.processedAt
            )
            val updated = current.copy(
                secondPass = secondPass,
                updatedAt = System.currentTimeMillis()
            )
            saveRecipe(updated)
            if (selectedRecipe?.id == updated.id) selectedRecipe = updated
            recordSecondPassUse()
                        secondPassMessage = secondPassReviewMessage(secondPass)
        }
    }

    fun acceptSecondPassIssue(recipeId: String, issueId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val result = current.secondPass ?: return
        val issue = result.issues.firstOrNull { it.id == issueId } ?: return
        val nextIngredients = SecondPassReviewer.applySuggestion(current.ingredients, issue)
        val rebuiltReview = SecondPassReviewer.buildReview(nextIngredients, result.ingredients)
        val updatedResult = result.copy(
            issues = rebuiltReview.issues,
            confirmedCount = rebuiltReview.confirmedCount
        )
        val updated = current.copy(
            ingredients = nextIngredients,
            secondPass = updatedResult,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        ChefAnalytics.secondPassAccepted(ChefAnalytics.KIND_INGREDIENT)
        secondPassMessage = secondPassReviewMessage(updatedResult)
    }

    fun keepCurrentForSecondPassIssue(recipeId: String, issueId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val result = current.secondPass ?: return
        if (result.issues.none { it.id == issueId }) return
        val updatedResult = result.copy(issues = result.issues.filterNot { it.id == issueId })
        val updated = current.copy(secondPass = updatedResult, updatedAt = System.currentTimeMillis())
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        secondPassMessage = secondPassReviewMessage(updatedResult)
    }

    fun acceptSecondPassMethodIssue(recipeId: String, issueId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val result = current.secondPass ?: return
        val issue = result.methodIssues.firstOrNull { it.id == issueId } ?: return
        val nextSteps = SecondPassReviewer.applyMethodSuggestion(current.steps, issue)
        val nextStepIds = current.stableStepIds().toMutableList().apply {
            if (issue.type == "possible-missed-step" && nextSteps.size > current.steps.size) {
                add(issue.secondIndex.coerceIn(0, size), UUID.randomUUID().toString())
            }
        }
        val rebuiltReview = SecondPassReviewer.buildMethodReview(nextSteps, result.steps, result.transcript)
        val updatedResult = result.copy(
            methodIssues = rebuiltReview.issues,
            methodConfirmedCount = rebuiltReview.confirmedCount
        )
        val updated = current.copy(
            steps = nextSteps,
            stepIds = nextStepIds,
            secondPass = updatedResult,
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        ChefAnalytics.secondPassAccepted(ChefAnalytics.KIND_METHOD)
        secondPassMessage = secondPassReviewMessage(updatedResult)
    }

    fun keepCurrentForSecondPassMethodIssue(recipeId: String, issueId: String) {
        val current = recipes.firstOrNull { it.id == recipeId } ?: selectedRecipe?.takeIf { it.id == recipeId } ?: return
        val result = current.secondPass ?: return
        if (result.methodIssues.none { it.id == issueId }) return
        val updatedResult = result.copy(methodIssues = result.methodIssues.filterNot { it.id == issueId })
        val updated = current.copy(secondPass = updatedResult, updatedAt = System.currentTimeMillis())
        saveRecipe(updated)
        if (selectedRecipe?.id == recipeId) selectedRecipe = updated
        secondPassMessage = secondPassReviewMessage(updatedResult)
    }

    private fun secondPassReviewMessage(result: com.chefvoice.app.model.SecondPassResult): String {
        val ingredientCount = result.issues.size
        val methodCount = result.methodIssues.size
        if (ingredientCount == 0 && methodCount == 0) {
            return "ChefVoice Review complete. ${result.confirmedCount} ingredient${if (result.confirmedCount == 1) "" else "s"} and ${result.methodConfirmedCount} method step${if (result.methodConfirmedCount == 1) "" else "s"} confirmed."
        }
        val parts = buildList {
            if (ingredientCount > 0) add("$ingredientCount ingredient item${if (ingredientCount == 1) "" else "s"}")
            if (methodCount > 0) add("$methodCount method item${if (methodCount == 1) "" else "s"}")
        }
        return parts.joinToString(" · ") + " need review."
    }

    private fun secondPassAudioPath(recipe: Recipe): String? {
        val fullSession = recipe.voiceClips.firstOrNull {
            it.label.equals("Full cooking session", ignoreCase = true) &&
                it.path.isNotBlank() &&
                File(it.path).exists() &&
                File(it.path).length() > 44L
        }
        return fullSession?.path
    }

    fun deleteRecipe(recipe: Recipe) {
        if (recipeMutationBusyId.isNotBlank()) return
        // Public recipes may have been created by an older client before the local
        // copy persisted authorId. Treat any public recipe as potentially cloud-backed.
        // A read-only preflight distinguishes a real cloud document from a legacy
        // orphan before any destructive local mutation occurs.
        val hasCloudCopy = recipe.isPublic || recipe.authorId.isNotBlank()
        fun removeLocalAfterCloudSuccess(message: String? = null) {
            recipes.removeAll { it.id == recipe.id }
            persist()
            closeRecipe()
            recipeMutationBusyId = ""
            cloudMessage = message ?: if (hasCloudCopy) "Recipe deleted from Community/cloud and this phone." else "Local recipe deleted."
        }
        if (!hasCloudCopy) {
            removeLocalAfterCloudSuccess()
            return
        }
        if (!cloudConfigured) {
            cloudMessage = "Connect to Firebase before deleting a cloud recipe. ChefVoice kept the local copy."
            return
        }
        if (!isSignedIn) {
            cloudMessage = "Sign in with the ChefVoice account that owns this recipe before deleting it."
            return
        }
        if (recipe.authorId.isNotBlank() && recipe.authorId != signedInUserId) {
            cloudMessage = "This recipe belongs to a different ChefVoice account, so it was not deleted."
            return
        }
        recipeMutationBusyId = recipe.id
        cloudMessage = "Checking Community/cloud recipe…"
        cloud.inspectRecipeForMutation(recipe.id) { check, inspectError ->
            when {
                inspectError != null || check == null -> {
                    recipeMutationBusyId = ""
                    cloudMessage = "Could not verify the cloud recipe. The copy on this phone was kept: ${inspectError ?: "Unknown cloud error."}"
                }
                !check.exists -> removeLocalAfterCloudSuccess("Recipe was already absent from Community/cloud and was deleted from this phone.")
                check.authorId != signedInUserId -> {
                    recipeMutationBusyId = ""
                    cloudMessage = "This cloud recipe belongs to a different ChefVoice account, so it was not deleted."
                }
                else -> {
                    cloudMessage = "Deleting recipe from Community/cloud…"
                    cloud.deleteCloudRecipe(recipe.id) { error ->
                        if (error != null) {
                            recipeMutationBusyId = ""
                            cloudMessage = "Could not delete the cloud recipe. The copy on this phone was kept: $error"
                        } else removeLocalAfterCloudSuccess()
                    }
                }
            }
        }
    }

    fun publish(recipe: Recipe) {
        // Gate cloud sync, not recipe count. Local recipes cost nothing and feed the
        // sharing loop; cloud recipes cost storage. Only block a recipe that is not
        // already public, so re-publishing an existing cloud recipe never trips the cap.
        if (!recipe.isPublic && cloudRecipesRemaining <= 0) {
            cloudMessage = "Free accounts sync " + FreeTierLimits.CLOUD_RECIPES +
                " recipes to the cloud. This recipe stays saved on this phone."
            showPaywall(PaywallTrigger.CLOUD_LIMIT)
            return
        }
        val localPublished = recipe.copy(
            isPublic = true,
            authorName = displayName.ifBlank { "Chef" },
            updatedAt = System.currentTimeMillis()
        )
        saveRecipe(localPublished)
        selectedRecipe = localPublished

        if (!cloudConfigured) {
            cloudMessage = "Saved as public on this device. Connect Firebase to publish it to other members."
            return
        }
        if (!isSignedIn) {
            cloudMessage = "Sign in on Profile to publish this recipe to the real Community feed."
            return
        }
        cloudMessage = "Publishing recipe…"
        cloud.publishRecipe(localPublished, displayName) { published, error, warning ->
            when {
                error != null -> cloudMessage = error
                published != null -> {
                    saveRecipe(published)
                    selectedRecipe = published
                    cloudMessage = if (warning.isNullOrBlank()) "Published to Community." else "Published to Community. $warning"
                }
            }
        }
    }

    fun unpublish(recipe: Recipe) {
        if (recipeMutationBusyId.isNotBlank()) return
        val updated = recipe.copy(isPublic = false, communityUpdatePending = false, updatedAt = System.currentTimeMillis())
        val hasCloudCopy = recipe.isPublic || recipe.authorId.isNotBlank()
        if (!hasCloudCopy) {
            saveRecipe(updated)
            selectedRecipe = updated
            cloudMessage = "Kept private on this phone."
            return
        }
        if (!cloudConfigured) {
            cloudMessage = "Connect to Firebase before unpublishing a cloud recipe. ChefVoice kept it marked public on this phone."
            return
        }
        if (!isSignedIn) {
            cloudMessage = "Sign in with the ChefVoice account that owns this recipe before unpublishing it."
            return
        }
        if (recipe.authorId.isNotBlank() && recipe.authorId != signedInUserId) {
            cloudMessage = "This recipe belongs to a different ChefVoice account, so it was not unpublished."
            return
        }
        fun keepPrivate(message: String) {
            saveRecipe(updated)
            selectedRecipe = updated
            recipeMutationBusyId = ""
            cloudMessage = message
        }
        recipeMutationBusyId = recipe.id
        cloudMessage = "Checking Community/cloud recipe…"
        cloud.inspectRecipeForMutation(recipe.id) { check, inspectError ->
            when {
                inspectError != null || check == null -> {
                    recipeMutationBusyId = ""
                    cloudMessage = "Could not verify the cloud recipe. It is still marked public on this phone: ${inspectError ?: "Unknown cloud error."}"
                }
                !check.exists -> keepPrivate("Recipe was already absent from Community/cloud and is now private on this phone.")
                check.authorId != signedInUserId -> {
                    recipeMutationBusyId = ""
                    cloudMessage = "This cloud recipe belongs to a different ChefVoice account, so it was not unpublished."
                }
                else -> {
                    cloudMessage = "Removing recipe from Community…"
                    cloud.unpublishRecipe(recipe.id) { error ->
                        if (error != null) {
                            recipeMutationBusyId = ""
                            cloudMessage = "Could not remove the recipe from Community. It is still marked public: $error"
                        } else keepPrivate("Removed from Community and kept private in Recipes.")
                    }
                }
            }
        }
    }

    fun signUp(email: String, password: String, name: String) {
        if (accountBusy) return
        accountBusy = true
        cloudMessage = "Creating account…"
        cloud.signUp(email, password, name) { error ->
            accountBusy = false
            if (error == null) {
                saveDisplayName(name)
                cloudMessage = "Account created. Welcome to ChefVoice Community."
                cloud.sendVerificationEmail { verifyError ->
                    cloudMessage = verifyError ?: "Account created. Verification email sent."
                }
            } else cloudMessage = error
        }
    }

    fun signIn(email: String, password: String) {
        if (accountBusy) return
        accountBusy = true
        cloudMessage = "Signing in…"
        cloud.signIn(email, password) { error ->
            accountBusy = false
            cloudMessage = error ?: "Signed in."
        }
    }

    fun signOut() {
        if (accountBusy) return
        accountBusy = true
        cloud.signOut {
            accountBusy = false
            cloudMessage = "Signed out. Your recipes remain saved on this phone."
        }
    }

    fun sendPasswordReset(email: String = signedInEmail) {
        if (accountBusy) return
        accountBusy = true
        cloudMessage = "Sending password reset email…"
        cloud.sendPasswordReset(email) { error ->
            accountBusy = false
            cloudMessage = error ?: "Password reset email sent."
        }
    }

    fun sendVerificationEmail() {
        if (accountBusy) return
        accountBusy = true
        cloudMessage = "Sending verification email…"
        cloud.sendVerificationEmail { error ->
            accountBusy = false
            cloudMessage = error ?: "Verification email sent. Open it, then return to ChefVoice."
        }
    }

    fun refreshEmailVerification() {
        if (signedInUserId.isBlank() || signedInEmailVerified) return
        cloud.refreshEmailVerification { verified ->
            signedInEmailVerified = verified
        }
    }

    fun deleteChefVoiceAccount() {
        if (accountBusy) return
        accountBusy = true
        needsReauthForDelete = false
        cloudMessage = "Deleting ChefVoice cloud account and owned Community data…"
        cloud.deleteChefVoiceAccount { needsReauth, error ->
            accountBusy = false
            when {
                needsReauth -> {
                    needsReauthForDelete = true
                    cloudMessage = "For security, enter your password to confirm this is you before we permanently delete your account."
                }
                error == null -> cloudMessage = "ChefVoice cloud account deleted. Local cooking recipes remain on this phone."
                else -> cloudMessage = error
            }
        }
    }

    fun confirmAccountDeletionWithPassword(password: String) {
        if (accountBusy) return
        accountBusy = true
        cloudMessage = "Verifying it's you…"
        cloud.reauthenticateAndDeleteChefVoiceAccount(password) { needsReauth, error ->
            accountBusy = false
            when {
                needsReauth -> cloudMessage = "Re-authentication did not carry through. Sign out, sign back in, then try deleting again."
                error == null -> {
                    needsReauthForDelete = false
                    cloudMessage = "ChefVoice cloud account deleted. Local cooking recipes remain on this phone."
                }
                else -> cloudMessage = error
            }
        }
    }

    fun cancelAccountDeletionReauth() {
        needsReauthForDelete = false
        cloudMessage = ""
    }

    fun moderateReport(reportId: String, status: String, note: String = "", action: String = "") {
        if (!moderatorAccess || accountBusy) return
        accountBusy = true
        cloudMessage = "Recording report disposition…"
        cloud.moderateReport(
            reportId = reportId,
            status = status,
            moderatorNote = note,
            action = if (status == "actioned") action else ""
        ) { error ->
            accountBusy = false
            cloudMessage = error ?: "Report disposition saved."
        }
    }

    fun saveProfile(name: String, bio: String, favoriteThings: List<String>) {
        saveDisplayName(name)
        profileBio = bio.trim().take(500)
        profileFavoriteThings = favoriteThings.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(12)
        if (isSignedIn) {
            cloud.saveProfile(
                ChefProfile(
                    uid = signedInUserId,
                    displayName = displayName,
                    bio = profileBio,
                    photoUrl = profilePhotoUrl,
                    coverPhotoUrl = profileCoverPhotoUrl,
                    favoriteThings = profileFavoriteThings
                )
            ) { error -> cloudMessage = error ?: "Chef profile saved." }
        } else {
            cloudMessage = if (cloudConfigured) "Local name saved. Sign in to publish your full Chef Profile." else "Profile name saved on this phone."
        }
    }

    fun uploadProfilePhoto(kind: String, uri: Uri) {
        if (!isSignedIn) {
            cloudMessage = "Sign in before adding public Chef Profile photos."
            return
        }
        accountBusy = true
        cloudMessage = if (kind == "cover") "Uploading cover photo…" else "Uploading profile photo…"
        cloud.uploadProfileImage(kind, uri) { url, error ->
            accountBusy = false
            if (error != null || url.isNullOrBlank()) {
                cloudMessage = error ?: "Could not upload profile photo."
                return@uploadProfileImage
            }
            if (kind == "cover") profileCoverPhotoUrl = url else profilePhotoUrl = url
            cloud.saveProfile(
                ChefProfile(
                    uid = signedInUserId,
                    displayName = displayName,
                    bio = profileBio,
                    photoUrl = profilePhotoUrl,
                    coverPhotoUrl = profileCoverPhotoUrl,
                    favoriteThings = profileFavoriteThings
                )
            ) { saveError -> cloudMessage = saveError ?: "Chef Profile photo updated." }
        }
    }

    fun saveDisplayName(name: String) {
        displayName = name.ifBlank { "Chef" }
        repository.saveDisplayName(displayName)
    }

    fun playVoice(path: String) = audioPlayer.play(path)
    fun stopVoice() = audioPlayer.stop()

    fun toggleLike(recipe: Recipe) {
        if (cloudConfigured && recipe.authorId.isNotBlank()) {
            cloud.toggleLike(recipe.id) { _, error -> if (error != null) cloudMessage = error }
        } else {
            if (localLikedIds.contains(recipe.id)) localLikedIds.remove(recipe.id) else localLikedIds.add(recipe.id)
            repository.saveLikedIds(localLikedIds.toSet())
        }
    }

    fun isLiked(recipeId: String): Boolean = cloudLikedIds.contains(recipeId) || localLikedIds.contains(recipeId)

    fun toggleBookmark(recipe: Recipe) {
        if (recipe.authorId.isBlank()) {
            cloudMessage = "Bookmarks become available when this recipe is on the real Community feed."
            return
        }
        cloud.toggleBookmark(recipe.id) { _, error -> if (error != null) cloudMessage = error }
    }

    fun isBookmarked(recipeId: String): Boolean = bookmarkIds.contains(recipeId)

    fun toggleFollow(recipe: Recipe) = toggleFollowUid(recipe.authorId)

    fun toggleFollowUid(authorId: String) {
        if (authorId.isBlank()) { cloudMessage = "This demo/local chef cannot be followed yet."; return }
        cloud.toggleFollow(authorId) { _, error ->
            if (error != null) cloudMessage = error
            else {
                if (authorId == selectedChefUid) cloud.getFollowerCount(authorId) { count, _ -> if (count != null) selectedChefFollowerCount = count }
                if (authorId == signedInUserId) refreshOwnFollowerCount(authorId)
            }
        }
    }

    fun isFollowing(authorId: String): Boolean = followingIds.contains(authorId)

    fun addComment(text: String) {
        val recipe = selectedRecipe ?: return
        if (recipe.authorId.isBlank()) {
            cloudMessage = "Comments are available on cloud Community recipes."
            return
        }
        cloud.addComment(recipe.id, text, displayName) { error ->
            cloudMessage = error ?: "Comment posted."
        }
    }

    fun addRecipeReply(parent: RecipeComment, text: String) {
        val recipe = selectedRecipe ?: return
        cloud.addCommentReply(recipe.id, parent, text, displayName) { error ->
            cloudMessage = error ?: "Reply posted."
        }
    }

    fun communityItems(): List<CommunityItem> {
        if (cloudConfigured) {
            val byId = LinkedHashMap<String, Recipe>()
            cloudRecipes.forEach { byId[it.id] = it }
            recipes.filter { it.isPublic && !byId.containsKey(it.id) }.forEach { byId[it.id] = it }
            return byId.values.sortedByDescending { it.updatedAt }.map { CommunityItem(it, authorProfile = communityProfiles[it.authorId]) }
        }
        val own = recipes.filter { it.isPublic }.map { CommunityItem(it) }
        return (own + demoCommunityRecipes()).sortedByDescending { it.recipe.updatedAt }
    }


    // ---- Collections ----------------------------------------------------------
    // A chef's own filing of their own library. Local to this device by design:
    // cloud bookmarks already cover saving other chefs' dishes, so this needs no
    // Firestore collection, no security rule and no rules deploy, and it keeps
    // working for a chef who is signed out.

    /** Recipes in [collectionId], in library order. A blank id means the whole library. */
    fun recipesInCollection(collectionId: String): List<Recipe> {
        if (collectionId.isBlank()) return recipes
        val collection = collections.firstOrNull { it.id == collectionId } ?: return recipes
        // Ids that no longer resolve are skipped rather than pruned, so deleting a
        // recipe can never corrupt a collection that mentioned it.
        return recipes.filter { collection.recipeIds.contains(it.id) }
    }

    fun collectionsContaining(recipeId: String): List<RecipeCollection> =
        collections.filter { it.recipeIds.contains(recipeId) }

    fun createCollection(name: String): String {
        val clean = name.trim().take(60)
        if (clean.isBlank()) return ""
        // Re-using an existing collection by name rather than making a second one with
        // the same label, which would be indistinguishable in the picker.
        collections.firstOrNull { it.name.equals(clean, ignoreCase = true) }?.let { return it.id }
        val collection = RecipeCollection(name = clean)
        collections.add(collection)
        persistCollections()
        return collection.id
    }

    fun renameCollection(collectionId: String, name: String) {
        val clean = name.trim().take(60)
        if (clean.isBlank()) return
        val index = collections.indexOfFirst { it.id == collectionId }
        if (index < 0) return
        collections[index] = collections[index].copy(name = clean, updatedAt = System.currentTimeMillis())
        persistCollections()
    }

    /** Removes the collection only. The recipes in it are untouched. */
    fun deleteCollection(collectionId: String) {
        if (collections.none { it.id == collectionId }) return
        collections.removeAll { it.id == collectionId }
        if (activeCollectionId == collectionId) activeCollectionId = ""
        persistCollections()
    }

    fun setRecipeInCollection(collectionId: String, recipeId: String, inCollection: Boolean) {
        val index = collections.indexOfFirst { it.id == collectionId }
        if (index < 0 || recipeId.isBlank()) return
        val current = collections[index]
        val alreadyIn = current.recipeIds.contains(recipeId)
        if (alreadyIn == inCollection) return
        val next = if (inCollection) current.recipeIds + recipeId else current.recipeIds - recipeId
        collections[index] = current.copy(recipeIds = next, updatedAt = System.currentTimeMillis())
        persistCollections()
    }

    private fun persistCollections() {
        repository.saveCollections(collections.toList())
    }

    // ---- Shopping list --------------------------------------------------------
    // Built from the structured ingredients the parser already produced, so a chef
    // never retypes what they narrated. Local for the same reasons collections are.

    val shoppingUncheckedCount: Int get() = shoppingItems.count { !it.checked }

    /**
     * Adds one recipe's ingredients, scaled the way the chef is currently viewing it,
     * merging into lines that are already on the list where that is safe.
     */
    fun addRecipeToShoppingList(recipe: Recipe, servingFactor: Double = 1.0) {
        val incoming = ShoppingList.itemsFor(
            recipeId = recipe.id,
            recipeTitle = recipe.title.ifBlank { "Untitled recipe" },
            ingredients = recipe.ingredients,
            servingFactor = servingFactor
        )
        if (incoming.isEmpty()) {
            shoppingMessage = "That recipe has no ingredients to add yet."
            return
        }
        val before = shoppingItems.size
        val merged = ShoppingList.merge(shoppingItems.toList(), incoming)
        shoppingItems.clear()
        shoppingItems.addAll(merged)
        persistShoppingItems()
        val added = merged.size - before
        val combined = incoming.size - added
        shoppingMessage = when {
            combined <= 0 -> "Added $added item${if (added == 1) "" else "s"} to the shopping list."
            added <= 0 -> "Combined $combined item${if (combined == 1) "" else "s"} into lines already on the list."
            else -> "Added $added and combined $combined into the shopping list."
        }
    }

    fun setShoppingItemChecked(itemId: String, checked: Boolean) {
        val index = shoppingItems.indexOfFirst { it.id == itemId }
        if (index < 0) return
        shoppingItems[index] = shoppingItems[index].copy(checked = checked)
        persistShoppingItems()
    }

    fun removeShoppingItem(itemId: String) {
        if (shoppingItems.none { it.id == itemId }) return
        shoppingItems.removeAll { it.id == itemId }
        persistShoppingItems()
    }

    /** Clears the ticked lines, which is how a list gets reset after a shop. */
    fun clearCheckedShoppingItems() {
        if (shoppingItems.none { it.checked }) return
        shoppingItems.removeAll { it.checked }
        persistShoppingItems()
        shoppingMessage = "Cleared everything already in the basket."
    }

    fun clearShoppingList() {
        if (shoppingItems.isEmpty()) return
        shoppingItems.clear()
        persistShoppingItems()
        shoppingMessage = "Shopping list emptied."
    }

    fun shoppingShareText(): String = ShoppingList.asShareText(shoppingItems.toList())

    fun dismissShoppingMessage() {
        shoppingMessage = ""
    }

    private fun persistShoppingItems() {
        repository.saveShoppingItems(shoppingItems.toList())
    }

    fun bookmarkedRecipes(): List<Recipe> = cloudRecipes.filter { bookmarkIds.contains(it.id) }

    fun isOwned(recipe: Recipe): Boolean = recipes.any { it.id == recipe.id } ||
        (signedInUserId.isNotBlank() && recipe.authorId == signedInUserId)

    fun close() {
        stopLiveHeartbeat()
        audioPlayer.stop()
        playBilling.close()
        commentsListener?.remove()
        directMessagesListener?.remove()
        conversationsListener?.remove()
        liveCommentsListener?.remove()
        selectedChefProfileListener?.remove()
        liveHostProfileListener?.remove()
        feedListener?.remove()
        liveFeedListener?.remove()
        clearUserListeners()
        cloud.removeAuthListener(authListener)
    }

    private fun persist() = repository.saveRecipes(recipes)

    private fun demoCommunityRecipes(): List<CommunityItem> {
        val now = System.currentTimeMillis()
        return listOf(
            CommunityItem(
                Recipe(
                    id = "demo-carmen-pasta",
                    title = "Sunday Tomato & Basil Pasta",
                    description = "Slow, glossy tomato sauce with basil and parmesan.",
                    servings = 4,
                    ingredients = listOf(
                        Ingredient(quantity = "2", unit = "tbsp", name = "Olive oil"),
                        Ingredient(quantity = "4", unit = "clove", name = "Garlic"),
                        Ingredient(quantity = "28", unit = "oz", name = "Crushed tomatoes"),
                        Ingredient(quantity = "12", unit = "oz", name = "Pasta"),
                        Ingredient(quantity = "1", unit = "cup", name = "Fresh basil")
                    ),
                    steps = listOf(
                        "Warm the olive oil and gently cook the garlic.",
                        "Add tomatoes and simmer until glossy and slightly reduced.",
                        "Toss with pasta, basil, and a splash of pasta water."
                    ),
                    isPublic = true,
                    authorName = "Carmen R.",
                    createdAt = now - 86_400_000L,
                    updatedAt = now - 3_600_000L,
                    likes = 34,
                    commentCount = 7
                ),
                isDemoMember = true
            ),
            CommunityItem(
                Recipe(
                    id = "demo-jamal-chicken",
                    title = "Charred Lemon Chicken",
                    description = "Weeknight chicken with a bright pan sauce.",
                    servings = 3,
                    ingredients = listOf(
                        Ingredient(quantity = "1.5", unit = "lb", name = "Chicken thighs"),
                        Ingredient(quantity = "2", unit = "", name = "Lemons"),
                        Ingredient(quantity = "1", unit = "tbsp", name = "Honey"),
                        Ingredient(quantity = "1", unit = "tsp", name = "Smoked paprika")
                    ),
                    steps = listOf(
                        "Season and sear the chicken until deeply browned.",
                        "Char lemon halves in the same pan.",
                        "Finish with honey, lemon juice, and pan drippings."
                    ),
                    isPublic = true,
                    authorName = "Jamal T.",
                    createdAt = now - 172_800_000L,
                    updatedAt = now - 7_200_000L,
                    likes = 52,
                    commentCount = 11
                ),
                isDemoMember = true
            )
        )
    }
}
