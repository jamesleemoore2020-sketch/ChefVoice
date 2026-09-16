package com.chefvoice.app.ui

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
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.RecipeComment
import com.chefvoice.app.model.stableStepIds
import com.chefvoice.app.voice.SecondPassReviewer
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.ListenerRegistration
import java.io.File
import java.util.UUID

class ChefAppState(context: Context) {
    private val repository = RecipeRepository(context)
    private val audioPlayer = AudioPlayer()
    private val cloud = FirebaseSocialRepository(context)

    val recipes = mutableStateListOf<Recipe>()
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
    var selectedLiveSession by mutableStateOf<LiveSession?>(null)
        private set
    var selectedConversation by mutableStateOf<DirectConversation?>(null)
        private set
    var cloudMessage by mutableStateOf("")
        private set
    var accountBusy by mutableStateOf(false)
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
        recipes.addAll(repository.loadRecipes())
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
        val otherUid = conversation.otherUserId(signedInUserId)
        if (otherUid.isBlank() || messageBusy) return
        messageBusy = true
        cloud.setUserBlocked(otherUid, blocked) { error ->
            messageBusy = false
            if (error == null) {
                if (blocked) {
                    if (!blockedUserIds.contains(otherUid)) blockedUserIds.add(otherUid)
                    cloudMessage = "Chef blocked. Message history stays visible, but new private messages are disabled."
                } else {
                    blockedUserIds.remove(otherUid)
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

    fun startLive(title: String) {
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
        cloud.startLiveSession(title, displayName) { session, error ->
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
        val audioPath = secondPassAudioPath(recipe)
        if (audioPath == null) {
            secondPassMessage = "No original full cooking-session audio is stored locally for this recipe."
            return
        }

        secondPassBusyRecipeId = recipe.id
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
            // ChefVoice Review can upload the original cooking audio to private Cloud
            // Storage before this recipe is ever published (even before it is saved).
            // Best-effort cleanup only: it must not block or fail the local delete when
            // offline or signed out, since account deletion also sweeps this prefix.
            if (recipe.secondPass != null && cloudConfigured && isSignedIn) {
                cloud.deleteCloudRecipe(recipe.id)
            }
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
        cloudMessage = "Deleting ChefVoice cloud account and owned Community data…"
        cloud.deleteChefVoiceAccount { error ->
            accountBusy = false
            if (error == null) {
                cloudMessage = "ChefVoice cloud account deleted. Local cooking recipes remain on this phone."
            } else cloudMessage = error
        }
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

    fun bookmarkedRecipes(): List<Recipe> = cloudRecipes.filter { bookmarkIds.contains(it.id) }

    fun isOwned(recipe: Recipe): Boolean = recipes.any { it.id == recipe.id } ||
        (signedInUserId.isNotBlank() && recipe.authorId == signedInUserId)

    fun close() {
        stopLiveHeartbeat()
        audioPlayer.stop()
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
