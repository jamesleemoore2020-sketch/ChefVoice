package com.chefvoice.app.ui

import android.Manifest
import android.content.Intent
import android.util.Log
import android.content.pm.PackageManager
import android.net.Uri
import android.speech.RecognizerIntent
import android.os.Build
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.chefvoice.app.R
import androidx.core.content.FileProvider
import com.chefvoice.app.analytics.ChefAnalytics
import com.chefvoice.app.media.AudioPlayer
import com.chefvoice.app.media.AudioRecorder
import com.chefvoice.app.media.RecipeSpeaker
import com.chefvoice.app.media.copyPickedMedia
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.ChefNotification
import com.chefvoice.app.model.ChefProfile
import com.chefvoice.app.model.ChefReport
import com.chefvoice.app.model.ChefSearchResult
import com.chefvoice.app.model.DirectConversation
import com.chefvoice.app.model.DirectMessage
import com.chefvoice.app.model.LiveComment
import com.chefvoice.app.model.LiveSession
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import com.chefvoice.app.model.NotificationPreferences
import com.chefvoice.app.model.FoundingAccess
import com.chefvoice.app.model.FreeTierLimits
import com.chefvoice.app.model.ProEntitlement
import com.chefvoice.app.model.ProTierLimits
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.RecipeComment
import com.chefvoice.app.model.stepIdAt
import com.chefvoice.app.notifications.ChefVoiceForegroundService
import com.chefvoice.app.model.TranscriptSegment
import com.chefvoice.app.model.VoiceClip
import com.chefvoice.app.util.shareRecipe
import com.chefvoice.app.util.parseTagsInput
import com.chefvoice.app.util.tagMatchesQuery
import com.chefvoice.app.voice.CookingSessionCapture
import com.chefvoice.app.voice.CookingSessionParser
import com.chefvoice.app.voice.IngredientParser
import java.io.File
import java.util.Locale
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private enum class Tab(val label: String, val glyph: String) {
    LIBRARY("Recipes", "🍳"),
    CREATE("Create", "🎙"),
    COMMUNITY("Community", "🌎"),
    MESSAGES("Messages", "✉"),
    NOTIFICATIONS("Notifications", "🔔"),
    LIVE("Live", "🔴"),
    PROFILE("Profile", "👤")
}

private val AndroidPrimaryTabs = listOf(Tab.LIBRARY, Tab.CREATE, Tab.COMMUNITY, Tab.LIVE, Tab.PROFILE)

private enum class SpeechTarget { INGREDIENT, STEP }

private val ChefVoiceColorScheme = lightColorScheme(
    primary = Color(0xFFF06423),
    onPrimary = Color.White,
    secondary = Color(0xFFD93A22),
    onSecondary = Color.White,
    background = Color(0xFFFFFBF8),
    onBackground = Color(0xFF241A16),
    surface = Color(0xFFFFFBF8),
    onSurface = Color(0xFF241A16),
    surfaceVariant = Color(0xFFFFEEE6),
    onSurfaceVariant = Color(0xFF665049)
)

private val ChefVoiceBlackoutColorScheme = darkColorScheme(
    primary = Color(0xFFFF8A50),
    onPrimary = Color(0xFF1C0D06),
    secondary = Color(0xFFFF7665),
    onSecondary = Color(0xFF240704),
    background = Color(0xFF050505),
    onBackground = Color(0xFFF7F1ED),
    surface = Color(0xFF0D0D0D),
    onSurface = Color(0xFFF7F1ED),
    surfaceVariant = Color(0xFF1A1411),
    onSurfaceVariant = Color(0xFFD0C1BA)
)

@Composable
fun ChefVoiceApp(
    pendingLiveSessionId: String = "",
    onLiveNotificationConsumed: (String) -> Unit = {},
    pendingNotificationEventId: String = "",
    onNotificationEventConsumed: (String) -> Unit = {}
) {
    val context = LocalContext.current
    val appState = remember { ChefAppState(context.applicationContext) }
    val appearancePrefs = remember { context.applicationContext.getSharedPreferences("chefvoice_appearance", 0) }
    var blackoutMode by remember { mutableStateOf(appearancePrefs.getBoolean("blackout", false)) }
    var tab by remember { mutableStateOf(Tab.LIBRARY) }
    val tabHistory = remember { mutableStateListOf<Tab>() }
    var showBrandCover by remember { mutableStateOf(true) }
    var showHostExitDialog by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current

    fun navigateTab(next: Tab, rememberCurrent: Boolean = true) {
        if (next == tab) return
        if (rememberCurrent && tabHistory.lastOrNull() != tab) tabHistory.add(tab)
        tab = next
    }

    val selectedLive = appState.selectedLiveSession
    val hostingActiveLive = selectedLive?.hostId == appState.signedInUserId && selectedLive?.status == "LIVE"

    fun requestAppBack() {
        when {
            appState.cookingRecipe != null -> appState.cookingRecipe = null
            appState.selectedConversation != null -> appState.closeConversation()
            appState.selectedRecipe != null -> appState.closeRecipe()
            appState.selectedChefUid.isNotBlank() -> appState.closeChefProfile()
            appState.selectedLiveSession != null && hostingActiveLive -> showHostExitDialog = true
            appState.selectedLiveSession != null -> appState.closeLiveSession()
            tabHistory.isNotEmpty() -> tab = tabHistory.removeAt(tabHistory.lastIndex)
        }
    }

    BackHandler(
        enabled = appState.cookingRecipe != null || appState.selectedConversation != null || appState.selectedRecipe != null ||
            appState.selectedChefUid.isNotBlank() || appState.selectedLiveSession != null || tabHistory.isNotEmpty()
    ) { requestAppBack() }

    val liveSafetyScope = rememberCoroutineScope()
    DisposableEffect(lifecycleOwner, hostingActiveLive, selectedLive?.id) {
        // A brief ON_STOP/ON_START round trip also happens when Android shows the
        // camera/mic runtime-permission prompt while already LIVE (it launches a
        // separate system activity), so ending the live immediately on ON_STOP was
        // killing every fresh broadcast the instant it started. Give it a short grace
        // window and only actually end the live if the app is still stopped after it.
        var pendingEndJob: Job? = null
        val observer = LifecycleEventObserver { _, event ->
            Log.d("ChefVoiceLive", "lifecycle event=$event hostingActiveLive=$hostingActiveLive selectedLiveId=${selectedLive?.id} status=${selectedLive?.status}")
            when (event) {
                Lifecycle.Event.ON_STOP -> if (hostingActiveLive) {
                    Log.d("ChefVoiceLive", "ON_STOP while hosting -- scheduling safety-end in 4s")
                    pendingEndJob = liveSafetyScope.launch {
                        delay(4000)
                        Log.d("ChefVoiceLive", "grace window elapsed -- calling endLiveForSafety")
                        appState.endLiveForSafety("Live ended because ChefVoice left the foreground. Camera and microphone are off.")
                    }
                }
                Lifecycle.Event.ON_START -> {
                    if (pendingEndJob != null) Log.d("ChefVoiceLive", "ON_START -- cancelling pending safety-end")
                    pendingEndJob?.cancel()
                    pendingEndJob = null
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            pendingEndJob?.cancel()
        }
    }

    DisposableEffect(appState) {
        onDispose { appState.close() }
    }

    DisposableEffect(lifecycleOwner, appState) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) appState.refreshEmailVerification()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(Unit) {
        delay(800)
        showBrandCover = false
    }

    LaunchedEffect(pendingLiveSessionId, appState.liveSessionsReady) {
        if (pendingLiveSessionId.isBlank()) return@LaunchedEffect
        navigateTab(Tab.LIVE, rememberCurrent = false)
        if (!appState.liveSessionsReady) return@LaunchedEffect
        appState.liveSessions.firstOrNull { it.id == pendingLiveSessionId }?.let(appState::openLiveSession)
        onLiveNotificationConsumed(pendingLiveSessionId)
    }

    LaunchedEffect(pendingNotificationEventId, appState.notificationsReady, appState.notifications.size) {
        if (pendingNotificationEventId.isBlank() || !appState.notificationsReady) return@LaunchedEffect
        val notification = appState.notifications.firstOrNull { it.id == pendingNotificationEventId }
        if (notification != null) appState.openNotification(notification)
        onNotificationEventConsumed(pendingNotificationEventId)
    }

    MaterialTheme(colorScheme = if (blackoutMode) ChefVoiceBlackoutColorScheme else ChefVoiceColorScheme) {
        Surface(Modifier.fillMaxSize()) {
            if (showBrandCover) {
                // The brand cover is deliberately full-bleed behind the system bars.
                BrandCoverScreen()
            } else Box(
                // Everything else keeps clear of the status bar, navigation bar and
                // display cutout. Screens that bypass Scaffold used to draw underneath
                // them, because targetSdk 36 makes edge-to-edge mandatory.
                Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)
            ) { when {
                appState.cookingRecipe != null -> CookingScreen(
                    recipe = appState.cookingRecipe!!,
                    onBack = { appState.cookingRecipe = null },
                    onPlayVoice = appState::playVoice
                )
                appState.selectedConversation != null -> ConversationScreen(
                    conversation = appState.selectedConversation!!,
                    messages = appState.directMessages,
                    currentUserId = appState.signedInUserId,
                    otherUserBlocked = appState.isUserBlocked(appState.selectedConversation!!.otherUserId(appState.signedInUserId)),
                    messageBusy = appState.messageBusy,
                    loading = appState.directMessagesLoading,
                    errorMessage = appState.directMessagesError,
                    blockStatusError = appState.blockStatusError,
                    cloudMessage = appState.cloudMessage,
                    onBack = appState::closeConversation,
                    onSetBlocked = appState::setConversationUserBlocked,
                    onReportMessage = appState::reportDirectMessage,
                    onSend = appState::sendDirectMessage
                )
                appState.selectedRecipe != null -> {
                    val recipe = appState.selectedRecipe!!
                    RecipeDetailScreen(
                        recipe = recipe,
                        isOwned = appState.isOwned(recipe),
                        isLiked = appState.isLiked(recipe.id),
                        isBookmarked = appState.isBookmarked(recipe.id),
                        isFollowing = appState.isFollowing(recipe.authorId),
                        canFollow = recipe.authorId.isNotBlank() && recipe.authorId != appState.signedInUserId,
                        canMessage = appState.isSignedIn && recipe.authorId.isNotBlank() && recipe.authorId != appState.signedInUserId,
                        authorProfile = appState.recipeAuthorProfile,
                        comments = appState.comments,
                        focusedCommentId = appState.focusedCommentId,
                        isSignedIn = appState.isSignedIn,
                        signedInUserId = appState.signedInUserId,
                        cloudMessage = appState.cloudMessage,
                        secondPassAvailable = appState.hasSecondPassAudio(recipe),
                        secondPassBusy = appState.secondPassBusyRecipeId == recipe.id,
                        secondPassMessage = appState.secondPassMessage,
                        recipeMutationBusy = appState.recipeMutationBusyId == recipe.id,
                        onBack = appState::closeRecipe,
                        onShare = { shareRecipe(context, recipe) },
                        onPublish = { appState.publish(recipe) },
                        onUnpublish = { appState.unpublish(recipe) },
                        onDelete = { appState.deleteRecipe(recipe) },
                        onAddMedia = { attachment -> appState.addRecipeMedia(recipe.id, attachment) },
                        onRemoveMedia = { mediaId -> appState.removeRecipeMedia(recipe.id, mediaId) },
                        onRemoveIngredient = { ingredientId -> appState.removeRecipeIngredient(recipe.id, ingredientId) },
                        onRemoveStep = { stepId -> appState.removeRecipeStep(recipe.id, stepId) },
                        onUpdateTimes = { prep, cook -> appState.updateRecipeTimes(recipe.id, prep, cook) },
                        onUpdateTags = { tags -> appState.updateRecipeTags(recipe.id, tags) },
                        onCook = { appState.cookingRecipe = recipe },
                        onPlayVoice = appState::playVoice,
                        onLike = { appState.toggleLike(recipe) },
                        onBookmark = { appState.toggleBookmark(recipe) },
                        onFollow = { appState.toggleFollow(recipe) },
                        onAuthorProfile = { appState.openChefProfile(recipe.authorId) },
                        onMessage = { appState.startConversationWith(recipe) },
                        onReportRecipe = { appState.reportRecipe(recipe) },
                        onReportComment = appState::reportRecipeComment,
                        onComment = appState::addComment,
                        onReply = appState::addRecipeReply,
                        onRunSecondPass = { appState.runSecondPass(recipe) },
                        onAcceptSecondPass = { issueId -> appState.acceptSecondPassIssue(recipe.id, issueId) },
                        onKeepSecondPass = { issueId -> appState.keepCurrentForSecondPassIssue(recipe.id, issueId) },
                        onAcceptSecondPassMethod = { issueId -> appState.acceptSecondPassMethodIssue(recipe.id, issueId) },
                        onKeepSecondPassMethod = { issueId -> appState.keepCurrentForSecondPassMethodIssue(recipe.id, issueId) }
                    )
                }
                appState.selectedChefUid.isNotBlank() -> PublicChefProfileScreen(
                    uid = appState.selectedChefUid,
                    profile = appState.selectedChefProfile,
                    followerCount = appState.selectedChefFollowerCount,
                    recipes = appState.publicRecipesFor(appState.selectedChefUid),
                    isFollowing = appState.isFollowing(appState.selectedChefUid),
                    isSelf = appState.selectedChefUid == appState.signedInUserId,
                    isSignedIn = appState.isSignedIn,
                    loading = appState.selectedChefProfileLoading,
                    activeLive = appState.activeLiveFor(appState.selectedChefUid),
                    isBlocked = appState.isUserBlocked(appState.selectedChefUid),
                    onBack = appState::closeChefProfile,
                    onFollow = { appState.toggleFollowUid(appState.selectedChefUid) },
                    onMessage = { appState.startConversationWithChef(appState.selectedChefUid, appState.selectedChefProfile?.displayName ?: "Chef") },
                    onReport = { appState.reportChef(appState.selectedChefUid) },
                    onToggleBlock = { appState.setUserBlocked(appState.selectedChefUid, !appState.isUserBlocked(appState.selectedChefUid)) },
                    onWatchLive = { live ->
                        appState.closeChefProfile()
                        if (appState.selectedRecipe != null) appState.closeRecipe()
                        appState.openLiveSession(live)
                    },
                    onOpenRecipe = appState::openRecipeFromChefProfile
                )
                appState.selectedLiveSession != null -> LiveRoomScreen(
                    session = appState.selectedLiveSession!!,
                    comments = appState.liveComments,
                    isSignedIn = appState.isSignedIn,
                    isHost = appState.selectedLiveSession!!.hostId == appState.signedInUserId,
                    signedInUserId = appState.signedInUserId,
                    hostProfile = appState.liveHostProfile,
                    isFollowing = appState.isFollowing(appState.selectedLiveSession!!.hostId),
                    canFollow = appState.isSignedIn && appState.selectedLiveSession!!.hostId != appState.signedInUserId,
                    liveBusy = appState.liveBusy,
                    cloudMessage = appState.cloudMessage,
                    onBack = { if (hostingActiveLive) showHostExitDialog = true else appState.closeLiveSession() },
                    onEnd = appState::endLive,
                    onHostReady = { appState.markLiveReady(appState.selectedLiveSession!!.id) },
                    onFollow = { appState.toggleFollowUid(appState.selectedLiveSession!!.hostId) },
                    onOpenHostProfile = { if (!hostingActiveLive) appState.openChefProfile(appState.selectedLiveSession!!.hostId) },
                    onComment = appState::addLiveComment,
                    onReact = appState::reactLive
                )
                else -> Scaffold(
                    // The root Box above already applies safeDrawing, so Scaffold
                    // must not add the same padding a second time.
                    contentWindowInsets = WindowInsets(0, 0, 0, 0),
                    bottomBar = {
                        NavigationBar {
                            AndroidPrimaryTabs.forEach { item ->
                                NavigationBarItem(
                                    selected = tab == item,
                                    onClick = { navigateTab(item) },
                                    icon = { Text(item.glyph) },
                                    label = { Text(item.label) }
                                )
                            }
                        }
                    }
                ) { padding ->
                    Box(Modifier.padding(padding)) {
                        when (tab) {
                            Tab.LIBRARY -> LibraryScreen(
                                recipes = appState.recipes,
                                cookbook = appState.bookmarkedRecipes(),
                                isSignedIn = appState.isSignedIn,
                                onOpen = appState::openRecipe,
                                onCreate = { navigateTab(Tab.CREATE) },
                                onCommunity = { navigateTab(Tab.COMMUNITY) }
                            )
                            Tab.CREATE -> CreateRecipeScreen(
                                authorName = appState.displayName,
                                onSaved = {
                                    appState.saveRecipe(it)
                                    // Recorded here rather than inside saveRecipe, which
                                    // is also the update path for edits, second-pass
                                    // accepts and publishing. Only this callback means a
                                    // chef finished making a new recipe.
                                    ChefAnalytics.recipeCompleted()
                                    navigateTab(Tab.LIBRARY)
                                }
                            )
                            Tab.COMMUNITY -> CommunityScreen(
                                communityItems = appState.communityItems(),
                                cloudConfigured = appState.cloudConfigured,
                                isSignedIn = appState.isSignedIn,
                                signedInUserId = appState.signedInUserId,
                                cloudMessage = appState.cloudMessage,
                                chefSearchResults = appState.chefSearchResults,
                                chefSearchBusy = appState.chefSearchBusy,
                                chefSearchError = appState.chefSearchError,
                                communityHasMore = appState.communityHasMore,
                                communityLoadingMore = appState.communityLoadingMore,
                                onLoadMore = appState::loadMoreCommunity,
                                isFollowing = appState::isFollowing,
                                onFollowChef = appState::toggleFollowUid,
                                onSearchChefs = appState::searchChefs,
                                isLiked = appState::isLiked,
                                isBookmarked = appState::isBookmarked,
                                isUserBlocked = appState::isUserBlocked,
                                onLike = appState::toggleLike,
                                onBookmark = appState::toggleBookmark,
                                onOpen = appState::openRecipe,
                                onChefProfile = appState::openChefProfile,
                                onMessageChef = appState::startConversationWithChef,
                                onReportRecipe = appState::reportRecipe,
                                onToggleBlock = { uid -> appState.setUserBlocked(uid, !appState.isUserBlocked(uid)) },
                                unreadMessageCount = appState.unreadConversationCount,
                                unreadNotificationCount = appState.unreadNotificationCount,
                                onMessages = { navigateTab(Tab.MESSAGES) },
                                onNotifications = { navigateTab(Tab.NOTIFICATIONS) }
                            )
                            Tab.MESSAGES -> MessagesScreen(
                                conversations = appState.conversations,
                                currentUserId = appState.signedInUserId,
                                isSignedIn = appState.isSignedIn,
                                loading = appState.messageInboxLoading,
                                errorMessage = appState.messageInboxError,
                                readStatusError = appState.messageReadError,
                                unreadCount = appState.unreadConversationCount,
                                isUnread = appState::isConversationUnread,
                                isBlocked = { conversation -> appState.isUserBlocked(conversation.otherUserId(appState.signedInUserId)) },
                                cloudMessage = appState.cloudMessage,
                                onOpen = appState::openConversation,
                                onCommunity = { navigateTab(Tab.COMMUNITY) },
                                onProfile = { navigateTab(Tab.PROFILE) }
                            )
                            Tab.NOTIFICATIONS -> NotificationsScreen(
                                notifications = appState.notifications,
                                isSignedIn = appState.isSignedIn,
                                loading = appState.isSignedIn && !appState.notificationsReady,
                                errorMessage = appState.notificationsError,
                                unreadCount = appState.unreadNotificationCount,
                                preferences = appState.notificationPreferences,
                                preferencesReady = appState.notificationPreferencesReady,
                                preferencesError = appState.notificationPreferencesError,
                                onPreferencesChange = appState::updateNotificationPreferences,
                                onOpen = appState::openNotification,
                                onMarkAllRead = appState::markAllNotificationsRead,
                                onClearRead = appState::clearReadNotifications
                            )
                            Tab.LIVE -> LiveHubScreen(
                                sessions = appState.liveSessions,
                                cloudConfigured = appState.cloudConfigured,
                                isSignedIn = appState.isSignedIn,
                                liveBusy = appState.liveBusy,
                                cloudMessage = appState.cloudMessage,
                                signedInUserId = appState.signedInUserId,
                                isFollowing = appState::isFollowing,
                                profileForUid = appState::chefProfile,
                                onStartLive = appState::startLive,
                                onOpenLive = appState::openLiveSession,
                                onChefProfile = appState::openChefProfile,
                                onProfile = { navigateTab(Tab.PROFILE) }
                            )
                            Tab.PROFILE -> ProfileScreen(
                                cloudConfigured = appState.cloudConfigured,
                                isSignedIn = appState.isSignedIn,
                                signedInEmail = appState.signedInEmail,
                                signedInEmailVerified = appState.signedInEmailVerified,
                                moderatorAccess = appState.moderatorAccess,
                                moderationReports = appState.moderationReports,
                                moderationError = appState.moderationError,
                                displayName = appState.displayName,
                                bio = appState.profileBio,
                                photoUrl = appState.profilePhotoUrl,
                                coverPhotoUrl = appState.profileCoverPhotoUrl,
                                favoriteThings = appState.profileFavoriteThings,
                                recipeCount = appState.recipes.size,
                                publicCount = appState.recipes.count { it.isPublic },
                                followerCount = appState.ownFollowerCount,
                                followingCount = appState.followingCount,
                                bookmarkCount = appState.bookmarkCount,
                                bookmarks = appState.bookmarkedRecipes(),
                                accountBusy = appState.accountBusy,
                                cloudMessage = appState.cloudMessage,
                                needsReauthForDelete = appState.needsReauthForDelete,
                                isPro = appState.isPro,
                                proEntitlement = appState.proEntitlement,
                                proPreviewAvailable = appState.proPreviewAvailable,
                                proPreviewOverride = appState.proPreviewOverride,
                                onProPreviewChange = { appState.proPreviewOverride = it },
                                onSeePro = { appState.showPaywall(PaywallTrigger.PROFILE) },
                                secondPassUsed = appState.secondPassUsedThisMonth,
                                secondPassLimit = appState.secondPassMonthlyLimit,
                                cloudRecipeCount = appState.cloudRecipeCount,
                                unreadMessageCount = appState.unreadConversationCount,
                                unreadNotificationCount = appState.unreadNotificationCount,
                                blackoutMode = blackoutMode,
                                onBlackoutModeChange = { enabled ->
                                    blackoutMode = enabled
                                    appearancePrefs.edit().putBoolean("blackout", enabled).apply()
                                },
                                onSaveProfile = appState::saveProfile,
                                onUploadProfilePhoto = appState::uploadProfilePhoto,
                                onMessages = { navigateTab(Tab.MESSAGES) },
                                onNotifications = { navigateTab(Tab.NOTIFICATIONS) },
                                onCommunity = { navigateTab(Tab.COMMUNITY) },
                                onSignIn = appState::signIn,
                                onSignUp = appState::signUp,
                                onResetPassword = appState::sendPasswordReset,
                                onVerifyEmail = appState::sendVerificationEmail,
                                onDeleteAccount = appState::deleteChefVoiceAccount,
                                onConfirmDeletePassword = appState::confirmAccountDeletionWithPassword,
                                onCancelDeleteReauth = appState::cancelAccountDeletionReauth,
                                onModerateReport = appState::moderateReport,
                                onSignOut = appState::signOut,
                                onOpenRecipe = appState::openRecipe
                            )
                        }
                    }
                }
            } }
        }
        // One paywall for the whole app. Second Pass and the cloud-sync cap raise it
        // from ChefAppState, so it appears wherever the chef happens to be.
        if (appState.paywallTrigger.isNotBlank()) {
            ProPaywallDialog(
                trigger = appState.paywallTrigger,
                onDismiss = { appState.dismissPaywall() },
                onStartCheckout = {
                    // Play Billing is not wired yet. Deliberately a no-op rather than a
                    // faked purchase - entitlement only ever comes from the backend.
                    appState.dismissPaywall()
                }
            )
        }
        if (showHostExitDialog) {
            AlertDialog(
                onDismissRequest = { showHostExitDialog = false },
                title = { Text("You are LIVE") },
                text = { Text("End Live before leaving this screen. Staying keeps your camera and microphone visibly inside the Live room.") },
                confirmButton = {
                    Button(onClick = {
                        showHostExitDialog = false
                        appState.endLiveAndClose()
                    }) { Text("End Live & Leave") }
                },
                dismissButton = { TextButton(onClick = { showHostExitDialog = false }) { Text("Stay Live") } }
            )
        }
    }
}

@Composable
private fun LibraryScreen(
    recipes: List<Recipe>,
    cookbook: List<Recipe>,
    isSignedIn: Boolean,
    onOpen: (Recipe) -> Unit,
    onCreate: () -> Unit,
    onCommunity: () -> Unit
) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(
                painter = painterResource(R.drawable.ic_launcher_brand),
                contentDescription = "ChefVoice whisk microphone logo",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(64.dp)
            )
            Spacer(Modifier.width(12.dp))
            Column {
                Text("ChefVoice", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Your recipes, your cookbook.", style = MaterialTheme.typography.bodyLarge)
            }
        }
        Spacer(Modifier.height(16.dp))
        Button(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
            Text("🎙 Create a recipe")
        }
        Spacer(Modifier.height(12.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { SectionTitle("My recipes") }
            if (recipes.isEmpty()) {
                item {
                    EmptyState(
                        title = "Your kitchen notebook is empty",
                        body = "Dictate ingredients, record your own chef voice, attach photos or videos, then save your first recipe."
                    )
                }
            } else {
                items(recipes, key = { "local:${it.id}" }) { recipe ->
                    RecipeCard(recipe = recipe, onClick = { onOpen(recipe) })
                }
            }

            item { SectionTitle("Saved cookbook") }
            when {
                !isSignedIn -> item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Your Community favorites live here", fontWeight = FontWeight.Bold)
                            Text("Sign in, then tap Save on any Community recipe to keep it in your cookbook.")
                            OutlinedButton(onClick = onCommunity, modifier = Modifier.fillMaxWidth()) { Text("Browse Community") }
                        }
                    }
                }
                cookbook.isEmpty() -> item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("No saved Community recipes yet", fontWeight = FontWeight.Bold)
                            Text("Tap Save on recipes you want to cook again.")
                            OutlinedButton(onClick = onCommunity, modifier = Modifier.fillMaxWidth()) { Text("Find recipes") }
                        }
                    }
                }
                else -> items(cookbook, key = { "cookbook:${it.id}" }) { recipe ->
                    RecipeCard(recipe = recipe, onClick = { onOpen(recipe) })
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
}

private fun recipeMinutesLabel(minutes: Int): String {
    val safe = minutes.coerceAtLeast(0)
    if (safe == 0) return "—"
    val hours = safe / 60
    val mins = safe % 60
    return when {
        hours > 0 && mins > 0 -> "${hours}h ${mins}m"
        hours > 0 -> "${hours}h"
        else -> "${mins}m"
    }
}

private fun recipeTimeSummary(recipe: Recipe): String = buildList {
    if (recipe.prepTimeMinutes > 0) add("Prep ${recipeMinutesLabel(recipe.prepTimeMinutes)}")
    if (recipe.cookTimeMinutes > 0) add("Cook ${recipeMinutesLabel(recipe.cookTimeMinutes)}")
    if (recipe.prepTimeMinutes > 0 && recipe.cookTimeMinutes > 0) add("Total ${recipeMinutesLabel(recipe.prepTimeMinutes + recipe.cookTimeMinutes)}")
}.joinToString(" · ")

@Composable
private fun RecipeCard(recipe: Recipe, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column {
            recipe.media.firstOrNull()?.let { attachment ->
                RecipeMediaBanner(
                    attachment = attachment,
                    modifier = Modifier.fillMaxWidth().height(145.dp)
                )
            }
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(recipe.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("${recipe.ingredients.size} ingredients · ${recipe.steps.size} steps · Serves ${recipe.servings}")
                        recipeTimeSummary(recipe).takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                    if (recipe.isPublic) Text("🌎")
                }
                if (recipe.description.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(recipe.description, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (recipe.voiceClips.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text("🎧 Includes ${recipe.voiceClips.size} original chef voice clip${if (recipe.voiceClips.size == 1) "" else "s"}")
                }
            }
        }
    }
}

@Composable
private fun RecipeMediaBanner(attachment: MediaAttachment, modifier: Modifier = Modifier) {
    ChefAsyncImage(
        model = mediaModel(attachment),
        contentDescription = "Recipe media",
        modifier = modifier
    ) {
        Text(if (attachment.type == MediaType.VIDEO) "🎬 Video" else "📷 Photo")
    }
}

/**
 * The double-tap-to-like heart: pops in, settles, holds, then fades. `trigger`
 * is a counter rather than a boolean so tapping again while it is still
 * playing restarts the animation instead of doing nothing.
 */
@Composable
private fun HeartBurstOverlay(trigger: Int, modifier: Modifier = Modifier) {
    if (trigger == 0) return
    val alpha = remember(trigger) { Animatable(1f) }
    LaunchedEffect(trigger) {
        alpha.snapTo(1f)
        delay(350)
        alpha.animateTo(0f, tween(300))
    }
    Text("❤", color = Color.White.copy(alpha = alpha.value), style = MaterialTheme.typography.displayLarge, modifier = modifier)
}

@Composable
private fun CreateRecipeScreen(authorName: String, onSaved: (Recipe) -> Unit) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var servingsText by remember { mutableStateOf("2") }
    var prepTimeText by remember { mutableStateOf("") }
    var cookTimeText by remember { mutableStateOf("") }
    var tagsText by remember { mutableStateOf("") }
    val ingredients = remember { mutableStateListOf<Ingredient>() }
    val steps = remember { mutableStateListOf<String>() }
    val media = remember { mutableStateListOf<MediaAttachment>() }
    var cameraMode by remember { mutableStateOf<ChefCameraMode?>(null) }
    val voiceClips = remember { mutableStateListOf<VoiceClip>() }
    val sessionTranscript = remember { mutableStateListOf<TranscriptSegment>() }
    var livePartial by remember { mutableStateOf("") }
    var captureStatus by remember { mutableStateOf("Talk naturally while you cook. ChefVoice will turn the session into an editable recipe draft.") }
    var isSessionCapturing by remember { mutableStateOf(false) }
    var isProcessingSession by remember { mutableStateOf(false) }
    var manualIngredient by remember { mutableStateOf("") }
    var manualStep by remember { mutableStateOf("") }
    var speechTarget by remember { mutableStateOf(SpeechTarget.INGREDIENT) }
    var isRecording by remember { mutableStateOf(false) }
    val recorder = remember { AudioRecorder(context.applicationContext) }
    val previewPlayer = remember { AudioPlayer() }

    val sessionCapture = remember {
        CookingSessionCapture(
            context = context.applicationContext,
            onSegment = { sessionTranscript.add(it) },
            onPartial = { livePartial = it },
            onStatus = { captureStatus = it }
        )
    }

    fun mergeCookingDraft() {
        val draft = CookingSessionParser.parse(sessionTranscript.toList())
        val ingredientKeys = ingredients.map {
            "${it.quantity}|${it.unit}|${it.name}".lowercase().replace(Regex("\\s+"), " ")
        }.toMutableSet()
        draft.ingredients.forEach { ingredient ->
            val key = "${ingredient.quantity}|${ingredient.unit}|${ingredient.name}"
                .lowercase().replace(Regex("\\s+"), " ")
            if (ingredientKeys.add(key)) ingredients.add(ingredient)
        }

        val stepKeys = steps.map { it.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim() }.toMutableSet()
        draft.steps.forEach { step ->
            val key = step.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
            if (key.isNotBlank() && stepKeys.add(key)) steps.add(step)
        }

        captureStatus = when {
            sessionTranscript.isEmpty() -> "No transcript was returned. Your saved chef voice can still be kept with the recipe."
            draft.ingredients.isEmpty() && draft.steps.isEmpty() -> "Transcript captured. Review it below and add any ingredients or steps ChefVoice missed."
            else -> "Draft ready: ${draft.ingredients.size} ingredient${if (draft.ingredients.size == 1) "" else "s"} and ${draft.steps.size} step${if (draft.steps.size == 1) "" else "s"} detected. Review them below."
        }
    }

    fun finishCookingCapture() {
        if (!isSessionCapturing) return
        isSessionCapturing = false
        isProcessingSession = true
        ChefVoiceForegroundService.stop(context)
        sessionCapture.stop { voicePath ->
            if (voicePath != null && voiceClips.none { it.path == voicePath }) {
                voiceClips.add(VoiceClip(path = voicePath, label = "Full cooking session"))
            }
            // Parsing begins only after recognition has gone quiet (or Android signals
            // the segmented session ended), so late ingredient phrases are included.
            mergeCookingDraft()
            isProcessingSession = false
        }
    }

    fun startCookingCapture() {
        if (isRecording) return
        sessionTranscript.clear()
        livePartial = ""
        isProcessingSession = false
        if (sessionCapture.start()) {
            isSessionCapturing = true
            // Only once recognition is actually running: a denied microphone permission
            // or a failed start is not a chef who began narrating.
            ChefAnalytics.recipeCaptureStarted()
            // Hold the microphone open if the chef leaves the app or the screen
            // locks. Without this the session kept running but captured silence.
            ChefVoiceForegroundService.start(context, ChefVoiceForegroundService.MODE_COOKING)
        }
    }

    // A phone propped on the counter should not sleep mid-session.
    KeepScreenOn(enabled = isSessionCapturing || isRecording)

    DisposableEffect(Unit) {
        onDispose {
            ChefVoiceForegroundService.stop(context)
            sessionCapture.close()
            recorder.cancel()
            previewPlayer.stop()
        }
    }

    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val heard = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (heard.isNotBlank()) {
                when (speechTarget) {
                    SpeechTarget.INGREDIENT -> ingredients.add(IngredientParser.parse(heard))
                    SpeechTarget.STEP -> steps.add(heard.replaceFirstChar { it.titlecase() })
                }
            }
        }
    }

    fun launchSpeech(target: SpeechTarget) {
        speechTarget = target
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(
                RecognizerIntent.EXTRA_PROMPT,
                if (target == SpeechTarget.INGREDIENT) "Say an ingredient, for example: two tablespoons olive oil" else "Say the next recipe step"
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                putStringArrayListExtra(
                    RecognizerIntent.EXTRA_BIASING_STRINGS,
                    arrayListOf(
                        "tablespoon", "tablespoons", "teaspoon", "teaspoons", "tbsp", "tsp",
                        "cup", "cups", "gram", "grams", "ounce", "ounces", "pound", "pounds",
                        "clove", "cloves", "pinch", "salt", "pepper", "olive oil", "butter",
                        "flour", "sugar", "garlic", "onion"
                    )
                )
            }
        }
        runCatching { speechLauncher.launch(intent) }
    }

    fun startRecording() {
        if (recorder.start() != null) {
            isRecording = true
        } else {
            captureStatus = "The microphone is busy. Close any other app that is recording and try again."
        }
    }

    val audioPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording()
    }

    val sessionPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCookingCapture() else captureStatus = "Microphone permission is required for cooking capture."
    }

    val mediaLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { copyPickedMedia(context, it) }?.let { media.add(it) }
    }

    if (cameraMode != null) {
        ChefCameraScreen(
            initialMode = cameraMode!!,
            videoEnabled = !isSessionCapturing && !isRecording,
            onCaptured = { media.add(it) },
            onBack = { cameraMode = null }
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("Create recipe", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Cook, talk, and let ChefVoice build the first draft while keeping the creator's real voice.")
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(18.dp)
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (isSessionCapturing) "🔴 LIVE COOKING CAPTURE" else "🎙 Cook & capture", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        if (isSessionCapturing) Text("Listening")
                    }
                    Text(captureStatus)
                    Text(
                        if (sessionCapture.savesFullSessionVoice)
                            "On Android 13+, ChefVoice saves the microphone session as your original chef voice and feeds that same audio to compatible speech recognition services."
                        else
                            "This Android version can continuously transcribe, but full-session voice saving uses Android 13+; manual voice clips remain available below.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        "Speak naturally: “you add 2 teaspoons of salt,” “add salt and pepper,” or “then sauté the garlic.” ChefVoice now joins recognition segments back together and waits for late speech results before building the draft.",
                        style = MaterialTheme.typography.bodySmall
                    )

                    if (sessionTranscript.isNotEmpty() || livePartial.isNotBlank()) {
                        HorizontalDivider()
                        Text("Live transcript", fontWeight = FontWeight.SemiBold)
                        sessionTranscript.takeLast(4).forEach { segment ->
                            Text("${formatElapsed(segment.elapsedMs)}  ${segment.text}", style = MaterialTheme.typography.bodySmall)
                        }
                        if (livePartial.isNotBlank()) {
                            Text("… $livePartial", style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    Button(
                        onClick = {
                            if (isSessionCapturing) {
                                finishCookingCapture()
                            } else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                startCookingCapture()
                            } else {
                                sessionPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        enabled = !isRecording && !isProcessingSession,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            when {
                                isProcessingSession -> "Structuring recipe…"
                                isSessionCapturing -> "⏹ Finish & build recipe"
                                else -> "🎙 Start cooking capture"
                            }
                        )
                    }
                }
            }
        }

        item {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Recipe name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        }
        item {
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Description / chef note") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2
            )
        }
        item {
            OutlinedTextField(
                value = servingsText,
                onValueChange = { servingsText = it.filter { ch -> ch.isDigit() }.take(3) },
                label = { Text("Servings") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        }
        item {
            OutlinedTextField(
                value = tagsText,
                onValueChange = { tagsText = it },
                label = { Text("Tags") },
                placeholder = { Text("#bbq, camping, weeknight") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = prepTimeText,
                    onValueChange = { prepTimeText = it.filter { ch -> ch.isDigit() }.take(4) },
                    label = { Text("Prep min") },
                    placeholder = { Text("Optional") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
                OutlinedTextField(
                    value = cookTimeText,
                    onValueChange = { cookTimeText = it.filter { ch -> ch.isDigit() }.take(4) },
                    label = { Text("Cook min") },
                    placeholder = { Text("Optional") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
            }
            Text("These are recipe summary times. Method-step timers stay exactly as captured.", style = MaterialTheme.typography.bodySmall)
        }

        item { SectionTitle("Ingredients") }
        items(ingredients, key = { it.id }) { ingredient ->
            IngredientRow(
                ingredient = ingredient,
                onChange = { updated ->
                    val index = ingredients.indexOfFirst { it.id == ingredient.id }
                    if (index >= 0) ingredients[index] = updated
                },
                onDelete = { ingredients.removeAll { it.id == ingredient.id } }
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = manualIngredient,
                    onValueChange = { manualIngredient = it },
                    label = { Text("Add ingredient") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
                Button(
                    onClick = {
                        if (manualIngredient.isNotBlank()) {
                            ingredients.add(IngredientParser.parse(manualIngredient))
                            manualIngredient = ""
                        }
                    }
                ) { Text("Add") }
            }
        }
        item {
            OutlinedButton(
                onClick = { launchSpeech(SpeechTarget.INGREDIENT) },
                enabled = !isSessionCapturing,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("🎙 Dictate one ingredient")
            }
        }

        item { SectionTitle("Method") }
        items(steps) { step ->
            val index = steps.indexOf(step)
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${index + 1}.", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(8.dp))
                    Text(step, Modifier.weight(1f))
                    TextButton(onClick = { steps.remove(step) }) { Text("Remove") }
                }
            }
        }
        item {
            OutlinedTextField(
                value = manualStep,
                onValueChange = { manualStep = it },
                label = { Text("Add cooking step") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        if (manualStep.isNotBlank()) {
                            steps.add(manualStep.trim())
                            manualStep = ""
                        }
                    },
                    modifier = Modifier.weight(1f)
                ) { Text("Add step") }
                OutlinedButton(
                    onClick = { launchSpeech(SpeechTarget.STEP) },
                    enabled = !isSessionCapturing,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("🎙 Dictate")
                }
            }
        }

        if (sessionTranscript.isNotEmpty()) {
            item { SectionTitle("Cooking transcript") }
            items(sessionTranscript, key = { it.id }) { segment ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp)) {
                        Text(formatElapsed(segment.elapsedMs), fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.width(10.dp))
                        Text(segment.text, Modifier.weight(1f))
                    }
                }
            }
        }

        item { SectionTitle("Chef voice") }
        item {
            Text("The creator's original voice stays with the recipe. Full cooking sessions appear here automatically on supported phones; you can also record focused voice notes.")
        }
        items(voiceClips, key = { it.id }) { clip ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("🎧 ${clip.label}", Modifier.weight(1f))
                    TextButton(onClick = { previewPlayer.play(clip.path) }) { Text("Play") }
                    TextButton(onClick = { voiceClips.removeAll { it.id == clip.id } }) { Text("Remove") }
                }
            }
        }
        item {
            Button(
                onClick = {
                    if (isRecording) {
                        recorder.stop()?.let { voiceClips.add(VoiceClip(path = it, label = "Chef voice ${voiceClips.size + 1}")) }
                        isRecording = false
                    } else {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            startRecording()
                        } else {
                            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    }
                },
                enabled = !isSessionCapturing,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (isRecording) "⏹ Stop & save voice" else "🔴 Record chef voice note")
            }
        }

        item { SectionTitle("Photos & video") }
        item {
            Text("Capture food photos and cooking clips directly inside ChefVoice, or choose something already on your phone.")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { cameraMode = ChefCameraMode.PHOTO },
                    enabled = !isProcessingSession,
                    modifier = Modifier.weight(1f)
                ) { Text("📷 Take photo") }
                Button(
                    onClick = { cameraMode = ChefCameraMode.VIDEO },
                    enabled = !isSessionCapturing && !isRecording && !isProcessingSession,
                    modifier = Modifier.weight(1f)
                ) { Text("🎬 Record video") }
            }
        }
        item {
            OutlinedButton(
                onClick = {
                    mediaLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                    )
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("🖼 Choose from phone") }
        }
        if (isSessionCapturing) {
            item {
                Text(
                    "Photos can be captured while ChefVoice is listening. Finish continuous voice capture before recording video so the microphone stays dedicated to recipe transcription.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        items(media, key = { it.id }) { attachment ->
            MediaPreview(
                attachment = attachment,
                onRemove = { media.removeAll { it.id == attachment.id } }
            )
        }

        item {
            Spacer(Modifier.height(8.dp))
            Button(
                enabled = title.isNotBlank() && ingredients.isNotEmpty() && !isSessionCapturing && !isProcessingSession,
                onClick = {
                    if (isRecording) {
                        recorder.stop()?.let { voiceClips.add(VoiceClip(path = it, label = "Chef voice ${voiceClips.size + 1}")) }
                        isRecording = false
                    }
                    onSaved(
                        Recipe(
                            title = title.trim(),
                            description = description.trim(),
                            servings = servingsText.toIntOrNull()?.coerceAtLeast(1) ?: 2,
                            prepTimeMinutes = prepTimeText.toIntOrNull()?.coerceAtLeast(0) ?: 0,
                            cookTimeMinutes = cookTimeText.toIntOrNull()?.coerceAtLeast(0) ?: 0,
                            ingredients = ingredients.toList(),
                            steps = steps.toList(),
                            stepIds = steps.map { java.util.UUID.randomUUID().toString() },
                            media = media.toList(),
                            voiceClips = voiceClips.toList(),
                            transcript = sessionTranscript.toList(),
                            authorName = authorName,
                            tags = parseTagsInput(tagsText)
                        )
                    )
                    title = ""
                    description = ""
                    servingsText = "2"
                    prepTimeText = ""
                    cookTimeText = ""
                    tagsText = ""
                    ingredients.clear()
                    steps.clear()
                    media.clear()
                    voiceClips.clear()
                    sessionTranscript.clear()
                    livePartial = ""
                    captureStatus = "Talk naturally while you cook. ChefVoice will turn the session into an editable recipe draft."
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Save recipe") }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

private fun formatElapsed(elapsedMs: Long): String {
    val totalSeconds = (elapsedMs / 1000L).coerceAtLeast(0L)
    val minutes = totalSeconds / 60L
    val seconds = totalSeconds % 60L
    return "%02d:%02d".format(minutes, seconds)
}

private fun relativeTime(epochMs: Long): String {
    if (epochMs <= 0L) return ""
    return DateUtils.getRelativeTimeSpanString(
        epochMs, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE
    ).toString()
}

private fun formatCount(count: Int): String {
    val value = count.coerceAtLeast(0)
    return when {
        value < 1000 -> value.toString()
        value < 1_000_000 -> "%.1f".format(value / 1000.0).removeSuffix(".0") + "K"
        else -> "%.1f".format(value / 1_000_000.0).removeSuffix(".0") + "M"
    }
}

@Composable
private fun IngredientRow(ingredient: Ingredient, onChange: (Ingredient) -> Unit, onDelete: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = ingredient.quantity,
                    onValueChange = { onChange(ingredient.copy(quantity = it)) },
                    label = { Text("Qty") },
                    modifier = Modifier.width(78.dp),
                    singleLine = true
                )
                OutlinedTextField(
                    value = ingredient.unit,
                    onValueChange = { onChange(ingredient.copy(unit = it)) },
                    label = { Text("Unit") },
                    modifier = Modifier.width(88.dp),
                    singleLine = true
                )
                OutlinedTextField(
                    value = ingredient.name,
                    onValueChange = { onChange(ingredient.copy(name = it)) },
                    label = { Text("Ingredient") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
            }
            TextButton(onClick = onDelete, modifier = Modifier.align(Alignment.End)) { Text("Remove") }
        }
    }
}

@Composable
private fun MediaPreview(attachment: MediaAttachment, onRemove: (() -> Unit)? = null) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            ChefAsyncImage(
                model = mediaModel(attachment),
                contentDescription = null,
                modifier = Modifier.size(72.dp)
            ) {
                Text(if (attachment.type == MediaType.VIDEO) "🎬" else "📷")
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (attachment.type == MediaType.VIDEO) "Video attached" else "Photo attached")
                if (attachment.remoteUrl.isNotBlank()) Text("☁ Cloud", style = MaterialTheme.typography.bodySmall)
            }
            if (attachment.type == MediaType.VIDEO) {
                val context = LocalContext.current
                TextButton(onClick = { openVideo(context, attachment) }) { Text("Play") }
            }
            if (onRemove != null) {
                TextButton(onClick = onRemove) { Text("Remove") }
            }
        }
    }
}

private fun openVideo(context: android.content.Context, attachment: MediaAttachment) {
    val intent = Intent(Intent.ACTION_VIEW).apply {
        if (attachment.remoteUrl.isNotBlank()) {
            setDataAndType(Uri.parse(attachment.remoteUrl), "video/*")
        } else {
            val file = File(attachment.path)
            if (!file.exists()) return
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            setDataAndType(uri, "video/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
    runCatching { context.startActivity(intent) }
}

@Composable
private fun CommunityScreen(
    communityItems: List<com.chefvoice.app.model.CommunityItem>,
    cloudConfigured: Boolean,
    isSignedIn: Boolean,
    signedInUserId: String,
    cloudMessage: String,
    chefSearchResults: List<ChefSearchResult>,
    chefSearchBusy: Boolean,
    chefSearchError: String,
    communityHasMore: Boolean,
    communityLoadingMore: Boolean,
    onLoadMore: () -> Unit,
    isFollowing: (String) -> Boolean,
    onFollowChef: (String) -> Unit,
    onSearchChefs: (String) -> Unit,
    isLiked: (String) -> Boolean,
    isBookmarked: (String) -> Boolean,
    isUserBlocked: (String) -> Boolean,
    onLike: (Recipe) -> Unit,
    onBookmark: (Recipe) -> Unit,
    onOpen: (Recipe) -> Unit,
    onChefProfile: (String) -> Unit,
    onMessageChef: (String, String) -> Unit,
    onReportRecipe: (Recipe) -> Unit,
    onToggleBlock: (String) -> Unit,
    unreadMessageCount: Int,
    unreadNotificationCount: Int,
    onMessages: () -> Unit,
    onNotifications: () -> Unit
) {
    var communityMode by remember { mutableStateOf("discover") }
    var searchExpanded by remember { mutableStateOf(false) }
    var searchText by remember { mutableStateOf("") }
    var appliedSearch by remember { mutableStateOf("") }
    val term = appliedSearch.trim().lowercase(Locale.getDefault())
    val modeItems = if (communityMode == "following") {
        if (isSignedIn) communityItems.filter { isFollowing(it.recipe.authorId) } else emptyList()
    } else communityItems
    val visibleItems = if (term.isBlank()) modeItems else modeItems.filter { item ->
        val recipe = item.recipe
        val profile = item.authorProfile
        if (recipe.tags.any { tagMatchesQuery(it, term) }) return@filter true
        val haystack = buildList {
            add(recipe.title); add(recipe.description); add(recipe.authorName)
            add(profile?.displayName.orEmpty()); add(profile?.bio.orEmpty())
            addAll(profile?.favoriteThings.orEmpty()); addAll(recipe.ingredients.map { it.name })
        }.joinToString(" ").lowercase(Locale.getDefault())
        haystack.contains(term)
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Community", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = {
                if (searchExpanded) { searchText = ""; appliedSearch = ""; onSearchChefs("") }
                searchExpanded = !searchExpanded
            }) { Text(if (searchExpanded) "✕" else "🔍") }
            TextButton(onClick = onMessages) { Text(if (unreadMessageCount > 0) "✉ $unreadMessageCount" else "✉", style = MaterialTheme.typography.headlineSmall) }
            TextButton(onClick = onNotifications) { Text(if (unreadNotificationCount > 0) "🔔 $unreadNotificationCount" else "🔔") }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (communityMode == "following") Button(onClick = { communityMode = "following" }, modifier = Modifier.weight(1f)) { Text("Following") }
            else OutlinedButton(onClick = { communityMode = "following" }, modifier = Modifier.weight(1f)) { Text("Following") }
            if (communityMode == "discover") Button(onClick = { communityMode = "discover" }, modifier = Modifier.weight(1f)) { Text("Discover") }
            else OutlinedButton(onClick = { communityMode = "discover" }, modifier = Modifier.weight(1f)) { Text("Discover") }
        }
        if (searchExpanded) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    label = { Text("Search chefs, dishes or #tags") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Button(onClick = { appliedSearch = searchText.trim(); onSearchChefs(appliedSearch) }, enabled = searchText.trim().length >= 2) { Text("Search") }
            }
            if (appliedSearch.isNotBlank()) {
                TextButton(onClick = { searchText = ""; appliedSearch = ""; onSearchChefs("") }) { Text("Clear search") }
            }
        }
        if (!cloudConfigured) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Text("Demo mode · Connect Firebase for the real member feed.", Modifier.padding(12.dp))
            }
        }
        if (cloudMessage.isNotBlank()) Text(cloudMessage, style = MaterialTheme.typography.bodySmall)
        if (appliedSearch.length >= 2) {
            Spacer(Modifier.height(8.dp))
            Text("Chefs", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            when {
                chefSearchBusy -> Text("Finding chefs…", style = MaterialTheme.typography.bodySmall)
                chefSearchError.isNotBlank() -> Text(chefSearchError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                chefSearchResults.isEmpty() -> Text("No chef profiles matched this search.", style = MaterialTheme.typography.bodySmall)
                else -> chefSearchResults.forEach { result ->
                    val profile = result.profile
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp).clickable { onChefProfile(profile.uid) },
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            RemoteProfileImage(profile.photoUrl, "${profile.displayName} profile", Modifier.size(54.dp))
                            Column(Modifier.weight(1f)) {
                                Text(profile.displayName, fontWeight = FontWeight.Bold)
                                val detail = profile.bio.ifBlank { profile.favoriteThings.take(3).joinToString(" · ") }
                                if (detail.isNotBlank()) Text(detail, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                                Text("${result.followerCount} follower${if (result.followerCount == 1L) "" else "s"}", style = MaterialTheme.typography.bodySmall)
                            }
                            if (profile.uid != signedInUserId && isSignedIn) {
                                TextButton(onClick = { onFollowChef(profile.uid) }) { Text(if (isFollowing(profile.uid)) "✓ Following" else "+ Follow") }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(if (communityMode == "following") "Following" else "Finished dishes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        if (visibleItems.isEmpty()) {
            val message = when {
                communityMode == "following" && !isSignedIn -> "Sign in to see finished dishes from chefs you follow."
                communityMode == "following" -> "Follow chefs from Discover, Chef Profiles, or Live to build your Following feed."
                appliedSearch.isNotBlank() -> "No finished dishes match this search."
                else -> "Publish the first finished dish from your library."
            }
            EmptyState("Nothing here yet", message)
        } else {
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                items(visibleItems, key = { it.recipe.id }) { item ->
                    val recipe = item.recipe
                    val profile = item.authorProfile
                    val context = LocalContext.current
                    var menuOpen by remember { mutableStateOf(false) }
                    var heartTrigger by remember { mutableIntStateOf(0) }
                    val canModerate = isSignedIn && recipe.authorId.isNotBlank() && recipe.authorId != signedInUserId
                    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
                        Box(
                            Modifier.fillMaxWidth().height(360.dp).pointerInput(recipe.id) {
                                detectTapGestures(
                                    onTap = { onOpen(recipe) },
                                    // Instagram-style: a double-tap always likes and always
                                    // shows the heart, but never removes an existing like.
                                    onDoubleTap = {
                                        if (!isLiked(recipe.id)) onLike(recipe)
                                        heartTrigger++
                                    }
                                )
                            }
                        ) {
                            val hero = recipe.media.firstOrNull { it.type == MediaType.IMAGE } ?: recipe.media.firstOrNull()
                            if (hero != null) RecipeMediaBanner(hero, Modifier.fillMaxSize())
                            else Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.secondary), contentAlignment = Alignment.Center) { Text("🍽️", style = MaterialTheme.typography.displayMedium, color = Color.White) }
                            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.16f)))
                            HeartBurstOverlay(heartTrigger, Modifier.align(Alignment.Center))
                            Row(
                                modifier = Modifier.align(Alignment.TopStart).padding(12.dp).background(Color.Black.copy(alpha = 0.58f), RoundedCornerShape(24.dp)).clickable(enabled = recipe.authorId.isNotBlank()) { onChefProfile(recipe.authorId) }.padding(horizontal = 7.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RemoteProfileImage(profile?.photoUrl.orEmpty(), "${profile?.displayName ?: recipe.authorName} profile", Modifier.size(36.dp))
                                Spacer(Modifier.width(8.dp)); Text(profile?.displayName?.ifBlank { recipe.authorName } ?: recipe.authorName, color = Color.White, fontWeight = FontWeight.Bold)
                            }
                            if (canModerate) {
                                Row(
                                    modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    val following = isFollowing(recipe.authorId)
                                    TextButton(
                                        onClick = { onFollowChef(recipe.authorId) },
                                        modifier = Modifier.background(if (following) Color.Black.copy(alpha = 0.5f) else Color.White, CircleShape),
                                        colors = ButtonDefaults.textButtonColors(contentColor = if (following) Color.White else Color.Black)
                                    ) { Text(if (following) "Following" else "Follow", style = MaterialTheme.typography.labelSmall) }
                                    Box {
                                        TextButton(
                                            onClick = { menuOpen = true },
                                            modifier = Modifier.background(Color.Black.copy(alpha = 0.58f), CircleShape)
                                        ) { Text("⋯", color = Color.White, fontWeight = FontWeight.Bold) }
                                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                            DropdownMenuItem(text = { Text("✉ Message chef") }, onClick = { menuOpen = false; onMessageChef(recipe.authorId, recipe.authorName) })
                                            DropdownMenuItem(text = { Text("⚑ Report") }, onClick = { menuOpen = false; onReportRecipe(recipe) })
                                            DropdownMenuItem(
                                                text = { Text(if (isUserBlocked(recipe.authorId)) "Unblock chef" else "🚫 Block chef") },
                                                onClick = { menuOpen = false; onToggleBlock(recipe.authorId) }
                                            )
                                        }
                                    }
                                }
                            }
                            Column(modifier = Modifier.align(Alignment.BottomStart).padding(14.dp).background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(16.dp)).padding(10.dp)) {
                                Text(recipe.title, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text("${recipe.ingredients.size} ingredients · 💬 ${formatCount(recipe.commentCount)} · ${relativeTime(recipe.createdAt)}", color = Color.White, style = MaterialTheme.typography.bodySmall)
                                if (recipe.tags.isNotEmpty()) {
                                    Text(recipe.tags.take(3).joinToString(" ") { "#$it" }, color = Color.White, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Column(modifier = Modifier.align(Alignment.BottomEnd).padding(10.dp).background(Color.Black.copy(alpha = 0.58f), RoundedCornerShape(18.dp)), horizontalAlignment = Alignment.CenterHorizontally) {
                                TextButton(onClick = { onLike(recipe) }) { Text(if (isLiked(recipe.id)) "♥ ${formatCount(recipe.likes)}" else "♡ ${formatCount(recipe.likes)}", color = Color.White) }
                                TextButton(onClick = { onOpen(recipe) }) { Text("💬", color = Color.White) }
                                TextButton(onClick = { shareRecipe(context, recipe) }) { Text("📤", color = Color.White) }
                                TextButton(onClick = { onBookmark(recipe) }) { Text(if (isBookmarked(recipe.id)) "★" else "☆", color = Color.White) }
                            }
                        }
                    }
                }
                if (communityMode == "discover" && term.isBlank() && communityHasMore) {
                    item(key = "community-load-more") {
                        OutlinedButton(onClick = onLoadMore, enabled = !communityLoadingMore, modifier = Modifier.fillMaxWidth()) {
                            Text(if (communityLoadingMore) "Loading…" else "Load more dishes")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessagesScreen(
    conversations: List<DirectConversation>,
    currentUserId: String,
    isSignedIn: Boolean,
    loading: Boolean,
    errorMessage: String,
    readStatusError: String,
    unreadCount: Int,
    isUnread: (DirectConversation) -> Boolean,
    isBlocked: (DirectConversation) -> Boolean,
    cloudMessage: String,
    onOpen: (DirectConversation) -> Unit,
    onCommunity: () -> Unit,
    onProfile: () -> Unit
) {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Messages", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(if (unreadCount > 0) "$unreadCount unread conversation${if (unreadCount == 1) "" else "s"}" else "Private one-to-one conversations with ChefVoice members.")
        Spacer(Modifier.height(12.dp))
        if (!isSignedIn) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Sign in to message chefs", fontWeight = FontWeight.Bold)
                    Text("Messages are private to the two ChefVoice accounts in the conversation.")
                    Button(onClick = onProfile, modifier = Modifier.fillMaxWidth()) { Text("Go to Profile") }
                }
            }
            return@Column
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onCommunity, modifier = Modifier.weight(1f)) { Text("Find chefs") }
        }
        Spacer(Modifier.height(8.dp))
        when {
            loading -> {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text("Loading private conversations…")
                    }
                }
            }
            errorMessage.isNotBlank() -> {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Messages could not be loaded", fontWeight = FontWeight.Bold)
                        Text(errorMessage)
                        Text("Your cooking capture remains local and unaffected.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            conversations.isEmpty() -> EmptyState("No messages yet", "Open a Community recipe and tap Message chef to start a private conversation.")
            else -> {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(conversations, key = { it.id }) { conversation ->
                        val unread = isUnread(conversation)
                        val blocked = isBlocked(conversation)
                        Card(Modifier.fillMaxWidth().clickable { onOpen(conversation) }) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Text(conversation.displayNameFor(currentUserId), modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                                    if (blocked) Text("BLOCKED", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                                    if (blocked && unread) Spacer(Modifier.width(8.dp))
                                    if (unread) Text("NEW", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                                }
                                Text(
                                    conversation.lastMessage.ifBlank { "Start the conversation" },
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal
                                )
                            }
                        }
                    }
                }
            }
        }
        if (readStatusError.isNotBlank()) Text("Unread status: $readStatusError", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        if (cloudMessage.isNotBlank()) Text(cloudMessage, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun NotificationPreferenceRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

@Composable
private fun NotificationsScreen(
    notifications: List<ChefNotification>,
    isSignedIn: Boolean,
    loading: Boolean,
    errorMessage: String,
    unreadCount: Int,
    preferences: NotificationPreferences,
    preferencesReady: Boolean,
    preferencesError: String,
    onPreferencesChange: (NotificationPreferences) -> Unit,
    onOpen: (ChefNotification) -> Unit,
    onMarkAllRead: () -> Unit,
    onClearRead: () -> Unit
) {
    var settingsExpanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Notifications", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(if (unreadCount > 0) "$unreadCount new alert${if (unreadCount == 1) "" else "s"}" else "Messages, comments, likes, new followers, and followed-chef Live alerts will appear here.")
            }
            if (unreadCount > 0) TextButton(onClick = onMarkAllRead) { Text("Mark all read") }
        }
        Spacer(Modifier.height(10.dp))
        if (!isSignedIn) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Sign in for notifications", fontWeight = FontWeight.Bold)
                    Text("ChefVoice keeps notification activity private to your signed-in account. Sign in from the Profile tab.")
                }
            }
            return@Column
        }
        val enabledPreferenceCount = listOf(preferences.messages, preferences.comments, preferences.likes, preferences.live, preferences.followers, preferences.replies).count { it }
        Card(Modifier.fillMaxWidth()) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { settingsExpanded = !settingsExpanded }
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Notification settings", fontWeight = FontWeight.Bold)
                        Text("$enabledPreferenceCount of 6 activity alerts on · account synced", style = MaterialTheme.typography.bodySmall)
                    }
                    Text(if (settingsExpanded) "▲" else "▼", style = MaterialTheme.typography.labelLarge)
                }
                if (settingsExpanded) {
                    HorizontalDivider()
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Activity alerts", fontWeight = FontWeight.SemiBold)
                        Text("Choose which ChefVoice activity creates an in-app alert and phone notification.", style = MaterialTheme.typography.bodySmall)
                        NotificationPreferenceRow("Messages", "Private message alerts", preferences.messages, preferencesReady) { onPreferencesChange(preferences.copy(messages = it)) }
                        NotificationPreferenceRow("Comments", "Comments on your recipes", preferences.comments, preferencesReady) { onPreferencesChange(preferences.copy(comments = it)) }
                        NotificationPreferenceRow("Likes", "Likes on your recipes", preferences.likes, preferencesReady) { onPreferencesChange(preferences.copy(likes = it)) }
                        NotificationPreferenceRow("Followed chefs Live", "When a chef you follow starts Live", preferences.live, preferencesReady) { onPreferencesChange(preferences.copy(live = it)) }
                        NotificationPreferenceRow("New followers", "When another chef follows you", preferences.followers, preferencesReady) { onPreferencesChange(preferences.copy(followers = it)) }
                        NotificationPreferenceRow("Comment replies", "When someone replies to your recipe comment", preferences.replies, preferencesReady) { onPreferencesChange(preferences.copy(replies = it)) }
                        if (preferencesError.isNotBlank()) Text(preferencesError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        else Text(if (preferencesReady) "All notification types default to ON until you change them." else "Loading account preferences…", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        when {
            loading -> {
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator()
                        Text("Loading notifications…")
                    }
                }
            }
            errorMessage.isNotBlank() -> {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Notifications could not be loaded", fontWeight = FontWeight.Bold)
                        Text(errorMessage)
                    }
                }
            }
            notifications.isEmpty() -> EmptyState("No notifications yet", "New private messages, recipe activity, follower alerts, and Live alerts from chefs you follow will appear here.")
            else -> {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(notifications, key = { it.id }) { notification ->
                        val glyph = when (notification.type) {
                            "message" -> "✉"
                            "comment" -> "💬"
                            "like" -> "♥"
                            "live" -> "🔴"
                            "follow" -> "👨‍🍳"
                            "reply" -> "↩"
                            else -> "🔔"
                        }
                        Card(Modifier.fillMaxWidth().clickable { onOpen(notification) }) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                                Text(glyph, style = MaterialTheme.typography.titleLarge)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(notification.title, modifier = Modifier.weight(1f), fontWeight = if (notification.isUnread) FontWeight.Bold else FontWeight.SemiBold)
                                        if (notification.isUnread) Text("NEW", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                                    }
                                    Text(notification.body, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                    if (notifications.any { !it.isUnread }) {
                        item {
                            TextButton(onClick = onClearRead, modifier = Modifier.fillMaxWidth()) {
                                Text("Clear read notifications")
                            }
                        }
                    }
                    item {
                        Text("ChefVoice keeps recent activity; older notification history is pruned as new activity arrives.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationScreen(
    conversation: DirectConversation,
    messages: List<DirectMessage>,
    currentUserId: String,
    otherUserBlocked: Boolean,
    messageBusy: Boolean,
    loading: Boolean,
    errorMessage: String,
    blockStatusError: String,
    cloudMessage: String,
    onBack: () -> Unit,
    onSetBlocked: (Boolean) -> Unit,
    onReportMessage: (DirectMessage) -> Unit,
    onSend: (String, (Boolean) -> Unit) -> Unit
) {
    var text by remember(conversation.id) { mutableStateOf("") }
    var confirmBlock by remember(conversation.id) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.scrollToItem(messages.lastIndex)
    }
    if (confirmBlock) {
        AlertDialog(
            onDismissRequest = { confirmBlock = false },
            title = { Text("Block ${conversation.displayNameFor(currentUserId)}?") },
            text = { Text("You will keep this message history, but neither account will be able to send new private messages in this conversation while the block is active.") },
            confirmButton = {
                Button(onClick = {
                    confirmBlock = false
                    onSetBlocked(true)
                }) { Text("Block chef") }
            },
            dismissButton = { TextButton(onClick = { confirmBlock = false }) { Text("Cancel") } }
        )
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(conversation.displayNameFor(currentUserId), maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            actions = {
                TextButton(
                    enabled = !messageBusy,
                    onClick = {
                        if (otherUserBlocked) onSetBlocked(false) else confirmBlock = true
                    }
                ) { Text(if (otherUserBlocked) "Unblock" else "Block") }
            }
        )
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (loading) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                CircularProgressIndicator()
                                Text("Loading messages…")
                            }
                        }
                    }
                } else if (errorMessage.isNotBlank()) {
                    item {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("Conversation could not be loaded", fontWeight = FontWeight.Bold)
                                Text(errorMessage)
                            }
                        }
                    }
                } else if (messages.isEmpty()) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Text("No messages yet. Say hello to start this private conversation.", Modifier.padding(16.dp))
                        }
                    }
                } else {
                    items(messages, key = { it.id }) { message ->
                        val mine = message.senderId == currentUserId
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                            Card(Modifier.fillMaxWidth(0.84f)) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(if (mine) "You" else message.senderName, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                                    Text(message.text)
                                    if (!mine) TextButton(onClick = { onReportMessage(message) }) { Text("Report", color = MaterialTheme.colorScheme.error) }
                                }
                            }
                        }
                    }
                }
            }
            if (otherUserBlocked) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Chef blocked", fontWeight = FontWeight.Bold)
                        Text("Message history stays visible. New private messages are disabled until you unblock this chef.")
                    }
                }
            }
            if (blockStatusError.isNotBlank()) {
                Text("Block status: $blockStatusError", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            if (cloudMessage.isNotBlank()) Text(cloudMessage, style = MaterialTheme.typography.bodySmall)
            if (!otherUserBlocked) {
                Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.take(2000) },
                        label = { Text("Message") },
                        modifier = Modifier.weight(1f),
                        maxLines = 4
                    )
                    Button(
                        enabled = text.isNotBlank() && !messageBusy,
                        onClick = {
                            val outgoing = text.trim()
                            if (outgoing.isNotBlank()) {
                                onSend(outgoing) { sent -> if (sent) text = "" }
                            }
                        }
                    ) { Text("Send") }
                }
            } else {
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
private fun LiveHubScreen(
    sessions: List<LiveSession>,
    cloudConfigured: Boolean,
    isSignedIn: Boolean,
    liveBusy: Boolean,
    cloudMessage: String,
    signedInUserId: String,
    isFollowing: (String) -> Boolean,
    profileForUid: (String) -> ChefProfile?,
    onStartLive: (String) -> Unit,
    onOpenLive: (LiveSession) -> Unit,
    onChefProfile: (String) -> Unit,
    onProfile: () -> Unit
) {
    var title by remember { mutableStateOf("") }
    val orderedSessions = sessions.sortedWith(compareByDescending<LiveSession> { isFollowing(it.hostId) }.thenByDescending { it.startedAt })
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("ChefVoice Live", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text("Chefs you follow are shown first. Follow once and ChefVoice can alert you when they go Live.")
        Spacer(Modifier.height(10.dp))
        if (!cloudConfigured) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) { Text("Firebase connection required for Live.", Modifier.padding(14.dp)) }
        } else if (!isSignedIn) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Browse active Lives now. Sign in to host, watch, follow, chat and react.", Modifier.weight(1f))
                    TextButton(onClick = onProfile) { Text("Sign in") }
                }
            }
        } else {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Start a Live", fontWeight = FontWeight.Bold)
                    OutlinedTextField(value = title, onValueChange = { title = it.take(80) }, label = { Text("What are you cooking?") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Button(enabled = !liveBusy, onClick = { onStartLive(title) }, modifier = Modifier.fillMaxWidth()) { Text(if (liveBusy) "Starting…" else "🔴 Go Live") }
                }
            }
        }
        if (cloudMessage.isNotBlank()) Text(cloudMessage, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(14.dp))
        Text("Live now", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (orderedSessions.isEmpty()) {
            EmptyState("Nobody is live yet", "When a chef starts cooking Live, the session appears here.")
        } else {
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(orderedSessions, key = { it.id }) { session ->
                    val profile = profileForUid(session.hostId)
                    Card(Modifier.fillMaxWidth().clickable { onOpenLive(session) }) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                RemoteProfileImage(profile?.photoUrl.orEmpty(), "${session.hostName} profile", Modifier.size(46.dp).clickable { onChefProfile(session.hostId) })
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f).clickable { onChefProfile(session.hostId) }) {
                                    Text(profile?.displayName?.ifBlank { session.hostName } ?: session.hostName, fontWeight = FontWeight.Bold)
                                    Text(if (session.hostId == signedInUserId) "You · 🔴 LIVE" else if (isFollowing(session.hostId)) "Following · 🔴 LIVE" else "View Chef Profile · 🔴 LIVE", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            Text(session.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("♥ ${session.heartCount} · 🔥 ${session.fireCount} · 👏 ${session.clapCount}")
                            Button(onClick = { onOpenLive(session) }, modifier = Modifier.fillMaxWidth()) { Text("Watch Live") }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LiveRoomScreen(
    session: LiveSession,
    comments: List<LiveComment>,
    isSignedIn: Boolean,
    isHost: Boolean,
    signedInUserId: String,
    hostProfile: ChefProfile?,
    isFollowing: Boolean,
    canFollow: Boolean,
    liveBusy: Boolean,
    cloudMessage: String,
    onBack: () -> Unit,
    onEnd: () -> Unit,
    onHostReady: () -> Unit,
    onFollow: () -> Unit,
    onOpenHostProfile: () -> Unit,
    onComment: (String) -> Unit,
    onReact: (String) -> Unit
) {
    var commentText by remember(session.id) { mutableStateOf("") }
    val isLive = session.status == "LIVE"
    val hostStarting = isHost && session.status == "STARTING"
    Scaffold(topBar = {
        TopAppBar(title = { Text(session.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }, navigationIcon = { TextButton(onClick = onBack) { Text("Back") } }, actions = { if (isHost && (isLive || hostStarting)) TextButton(enabled = !liveBusy, onClick = onEnd) { Text("End") } })
    }) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Box(Modifier.fillMaxWidth()) {
                        when {
                            isHost && (isLive || hostStarting) -> WebRtcLiveHostPanel(sessionId = session.id, hostUid = signedInUserId, onReady = onHostReady)
                            isLive && isSignedIn -> WebRtcLiveViewerPanel(sessionId = session.id, viewerUid = signedInUserId)
                            else -> Box(Modifier.fillMaxWidth().height(300.dp).background(Color.Black), contentAlignment = Alignment.Center) {
                                Text(if (isLive) "Sign in to watch Live" else "This Live has ended", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        }
                        Row(
                            modifier = Modifier.align(Alignment.TopStart).padding(10.dp)
                                .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(24.dp))
                                .clickable(enabled = session.hostId.isNotBlank() && !isHost) { onOpenHostProfile() }
                                .padding(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RemoteProfileImage(hostProfile?.photoUrl.orEmpty(), "${session.hostName} profile", Modifier.size(36.dp))
                            Spacer(Modifier.width(7.dp))
                            Column {
                                Text(hostProfile?.displayName?.ifBlank { session.hostName } ?: session.hostName, color = Color.White, fontWeight = FontWeight.Bold)
                                Text(if (isLive) "🔴 LIVE" else "ENDED", color = Color.White, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                        if (canFollow) {
                            TextButton(
                                onClick = onFollow,
                                modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(22.dp))
                            ) { Text(if (isFollowing) "✓ Following" else "+ Follow", color = Color.White, fontWeight = FontWeight.Bold) }
                        }
                        if (isHost) {
                            Column(
                                Modifier.align(Alignment.CenterEnd).padding(10.dp).background(Color.Black.copy(alpha = 0.58f), RoundedCornerShape(18.dp)).padding(8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text("♥ ${session.heartCount}", color = Color.White, fontWeight = FontWeight.Bold)
                                Text("🔥 ${session.fireCount}", color = Color.White, fontWeight = FontWeight.Bold)
                                Text("👏 ${session.clapCount}", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                        } else if (isLive && isSignedIn) {
                            Column(
                                Modifier.align(Alignment.CenterEnd).padding(10.dp).background(Color.Black.copy(alpha = 0.58f), RoundedCornerShape(18.dp)),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                TextButton(onClick = { onReact("heart") }) { Text("♥ ${session.heartCount}", color = Color.White) }
                                TextButton(onClick = { onReact("fire") }) { Text("🔥 ${session.fireCount}", color = Color.White) }
                                TextButton(onClick = { onReact("clap") }) { Text("👏 ${session.clapCount}", color = Color.White) }
                            }
                        }
                    }
                }
            }
            item { SectionTitle("Live chat") }
            if (comments.isEmpty()) item { Text("No live comments yet.") }
            else items(comments, key = { it.id }) { comment -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(comment.authorName, fontWeight = FontWeight.SemiBold); Text(comment.text) } } }
            if (isLive && isSignedIn) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(value = commentText, onValueChange = { commentText = it.take(500) }, label = { Text("Say something") }, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        Button(enabled = commentText.isNotBlank(), onClick = { onComment(commentText); commentText = "" }) { Text("Send") }
                    }
                }
            } else if (isLive) item { Text("Sign in to join Live chat and reactions.") }
            if (cloudMessage.isNotBlank()) item { Text(cloudMessage, style = MaterialTheme.typography.bodySmall) }
            if (isHost && isLive) item { Button(enabled = !liveBusy, onClick = onEnd, modifier = Modifier.fillMaxWidth()) { Text(if (liveBusy) "Ending…" else "End Live session") } }
            item { Spacer(Modifier.height(18.dp)) }
        }
    }
}

private fun voiceClipsForDisplay(clips: List<VoiceClip>): List<VoiceClip> {
    if (clips.isEmpty()) return emptyList()
    val fullSessions = clips.filter { it.label.equals("Full cooking session", ignoreCase = true) }
    val preferredFull = fullSessions.maxWithOrNull(
        compareBy<VoiceClip> { it.remoteUrl.isNotBlank() }
            .thenBy { it.createdAt }
    )
    return clips.filterNot { it.label.equals("Full cooking session", ignoreCase = true) } +
        listOfNotNull(preferredFull)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RecipeDetailScreen(
    recipe: Recipe,
    isOwned: Boolean,
    isLiked: Boolean,
    isBookmarked: Boolean,
    isFollowing: Boolean,
    canFollow: Boolean,
    canMessage: Boolean,
    authorProfile: ChefProfile?,
    comments: List<RecipeComment>,
    focusedCommentId: String,
    isSignedIn: Boolean,
    signedInUserId: String,
    cloudMessage: String,
    secondPassAvailable: Boolean,
    secondPassBusy: Boolean,
    secondPassMessage: String,
    recipeMutationBusy: Boolean,
    onBack: () -> Unit,
    onShare: () -> Unit,
    onPublish: () -> Unit,
    onUnpublish: () -> Unit,
    onDelete: () -> Unit,
    onAddMedia: (MediaAttachment) -> Unit,
    onRemoveMedia: (String) -> Unit,
    onRemoveIngredient: (String) -> Unit,
    onRemoveStep: (String) -> Unit,
    onUpdateTimes: (Int, Int) -> Unit,
    onUpdateTags: (List<String>) -> Unit,
    onCook: () -> Unit,
    onPlayVoice: (String) -> Unit,
    onLike: () -> Unit,
    onBookmark: () -> Unit,
    onFollow: () -> Unit,
    onAuthorProfile: () -> Unit,
    onMessage: () -> Unit,
    onReportRecipe: () -> Unit,
    onReportComment: (RecipeComment) -> Unit,
    onComment: (String) -> Unit,
    onReply: (RecipeComment, String) -> Unit,
    onRunSecondPass: () -> Unit,
    onAcceptSecondPass: (String) -> Unit,
    onKeepSecondPass: (String) -> Unit,
    onAcceptSecondPassMethod: (String) -> Unit,
    onKeepSecondPassMethod: (String) -> Unit
) {
    var commentText by remember(recipe.id) { mutableStateOf("") }
    var replyTarget by remember(recipe.id) { mutableStateOf<RecipeComment?>(null) }
    var replyText by remember(recipe.id) { mutableStateOf("") }
    var showDeleteConfirm by remember(recipe.id) { mutableStateOf(false) }
    var mediaEditMode by remember(recipe.id) { mutableStateOf(false) }
    var prepTimeText by remember(recipe.id) { mutableStateOf(recipe.prepTimeMinutes.takeIf { it > 0 }?.toString().orEmpty()) }
    var cookTimeText by remember(recipe.id) { mutableStateOf(recipe.cookTimeMinutes.takeIf { it > 0 }?.toString().orEmpty()) }
    var tagsText by remember(recipe.id) { mutableStateOf(recipe.tags.joinToString(", ") { "#$it" }) }
    var pendingMediaStepId by remember(recipe.id) { mutableStateOf("") }
    val context = LocalContext.current
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { copyPickedMedia(context, it) }?.let { onAddMedia(it.copy(stepId = pendingMediaStepId)) }
        pendingMediaStepId = ""
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { copyPickedMedia(context, it) }?.let { onAddMedia(it.copy(stepId = pendingMediaStepId)) }
        pendingMediaStepId = ""
    }
    fun pickPhoto(stepId: String = "") {
        pendingMediaStepId = stepId
        photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
    fun pickVideo(stepId: String = "") {
        pendingMediaStepId = stepId
        videoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(recipe.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            actions = {
                if (isOwned) TextButton(onClick = {
                    if (mediaEditMode) {
                        onUpdateTimes(prepTimeText.toIntOrNull() ?: 0, cookTimeText.toIntOrNull() ?: 0)
                        onUpdateTags(parseTagsInput(tagsText))
                    }
                    mediaEditMode = !mediaEditMode
                }) {
                    Text(if (mediaEditMode) "Done" else "Edit recipe")
                }
            }
        )
    }) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                if (recipe.description.isNotBlank()) Text(recipe.description, style = MaterialTheme.typography.bodyLarge)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("By ${recipe.authorName} · Serves ${recipe.servings}", Modifier.weight(1f))
                    if (canFollow) {
                        TextButton(onClick = onFollow) { Text(if (isFollowing) "Following" else "+ Follow") }
                    }
                }
                if (authorProfile != null && !isOwned) {
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().clickable { onAuthorProfile() }) { ChefProfileSummaryCard(authorProfile) }
                    TextButton(onClick = onAuthorProfile) { Text("View Chef Profile →") }
                }
                if (canMessage) {
                    OutlinedButton(onClick = onMessage, modifier = Modifier.fillMaxWidth()) {
                        Text("✉ Message ${recipe.authorName.ifBlank { "chef" }}")
                    }
                    TextButton(onClick = onReportRecipe, modifier = Modifier.fillMaxWidth()) { Text("Report recipe", color = MaterialTheme.colorScheme.error) }
                }
                recipeTimeSummary(recipe).takeIf { it.isNotBlank() }?.let { summary ->
                    Spacer(Modifier.height(8.dp))
                    Text(summary, fontWeight = FontWeight.SemiBold)
                }
            }
            if (isOwned && mediaEditMode) {
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Recipe times", fontWeight = FontWeight.SemiBold)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(value = prepTimeText, onValueChange = { prepTimeText = it.filter { ch -> ch.isDigit() }.take(4) }, label = { Text("Prep min") }, modifier = Modifier.weight(1f), singleLine = true)
                                OutlinedTextField(value = cookTimeText, onValueChange = { cookTimeText = it.filter { ch -> ch.isDigit() }.take(4) }, label = { Text("Cook min") }, modifier = Modifier.weight(1f), singleLine = true)
                            }
                            Text("Leave blank if unknown. Total time is shown automatically when both are set.", style = MaterialTheme.typography.bodySmall)
                            OutlinedTextField(
                                value = tagsText,
                                onValueChange = { tagsText = it },
                                label = { Text("Tags") },
                                placeholder = { Text("#bbq, camping, weeknight") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true
                            )
                        }
                    }
                }
            }
            if (recipe.tags.isNotEmpty() && !mediaEditMode) {
                item {
                    Text(recipe.tags.joinToString("   ") { "#$it" }, style = MaterialTheme.typography.bodySmall)
                }
            }

            val recipeLevelMedia = recipe.media.filter { it.stepId.isBlank() }
            if (recipeLevelMedia.isNotEmpty() || (isOwned && mediaEditMode)) {
                item { SectionTitle("Photos & video") }
                if (isOwned && mediaEditMode) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Add media to the whole recipe", fontWeight = FontWeight.SemiBold)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { pickPhoto() }, modifier = Modifier.weight(1f)) { Text("+ Photo") }
                                    OutlinedButton(onClick = { pickVideo() }, modifier = Modifier.weight(1f)) { Text("+ Video") }
                                }
                                Text("Step-specific media can be added beside each Method step below.", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                items(recipeLevelMedia, key = { "recipe-media:${it.id}" }) { attachment ->
                    MediaPreview(attachment, onRemove = if (isOwned && mediaEditMode) {{ onRemoveMedia(attachment.id) }} else null)
                }
            }

            item { Button(onClick = onCook, modifier = Modifier.fillMaxWidth()) { Text("🍳 Cook this recipe") } }

            item { SectionTitle("ChefVoice Review") }
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Uses the private original cooking audio to challenge uncertain live results. It never silently rewrites your recipe.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        when {
                            !secondPassAvailable -> Text(
                                "Unavailable: no original full cooking-session audio is stored locally for this recipe.",
                                style = MaterialTheme.typography.bodySmall
                            )
                            !isSignedIn -> {
                                OutlinedButton(
                                    enabled = false,
                                    onClick = {},
                                    modifier = Modifier.fillMaxWidth()
                                ) { Text("✨ Check original audio") }
                                Text(
                                    "Sign in on Profile first. Raw cooking audio stays in your private ChefVoice Storage path.",
                                    style = MaterialTheme.typography.bodySmall
                                )
                            }
                            else -> {
                                OutlinedButton(
                                    enabled = !secondPassBusy,
                                    onClick = onRunSecondPass,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        when {
                                            secondPassBusy -> "Transcribing original audio…"
                                            recipe.secondPass != null -> "↻ Run ChefVoice Review again"
                                            else -> "✨ Check original audio"
                                        }
                                    )
                                }
                            }
                        }

                        if (secondPassMessage.isNotBlank()) {
                            Text(secondPassMessage, style = MaterialTheme.typography.bodySmall)
                        }

                        recipe.secondPass?.let { result ->
                            Text(
                                "Model: ${result.model} · Ingredients ${result.confirmedCount} confirmed / ${result.issues.size} review · Method ${result.methodConfirmedCount} confirmed / ${result.methodIssues.size} review",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }

            recipe.secondPass?.let { result ->
                if (result.transcript.isNotBlank()) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("ChefVoice Review transcript", fontWeight = FontWeight.Bold)
                                Text(result.transcript)
                            }
                        }
                    }
                }

                item {
                    Text("Ingredient review", fontWeight = FontWeight.Bold)
                }

                if (result.issues.isEmpty()) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Text(
                                "✓ No ingredient disagreements need review. ${result.confirmedCount} ingredient${if (result.confirmedCount == 1) "" else "s"} confirmed.",
                                Modifier.padding(14.dp)
                            )
                        }
                    }
                } else {
                    items(result.issues, key = { it.id }) { issue ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Text(issue.title, fontWeight = FontWeight.Bold)
                                Text(issue.detail)
                                Text(
                                    "${(issue.confidence * 100.0).roundToInt()}% review confidence",
                                    style = MaterialTheme.typography.bodySmall
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (issue.suggested != null || issue.type == "remove-live-artifact") {
                                        Button(
                                            onClick = { onAcceptSecondPass(issue.id) },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text(
                                                when {
                                                    issue.type != "remove-live-artifact" -> "Use ChefVoice Review"
                                                    issue.title == "Superseded quantity" -> "Remove old quantity"
                                                    else -> "Remove artifact"
                                                }
                                            )
                                        }
                                    }
                                    OutlinedButton(
                                        onClick = { onKeepSecondPass(issue.id) },
                                        modifier = Modifier.weight(1f)
                                    ) { Text("Keep current") }
                                }
                            }
                        }
                    }
                }

                item {
                    Text("Method review", fontWeight = FontWeight.Bold)
                }

                if (result.methodIssues.isEmpty()) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Text(
                                "✓ No method disagreements need review. ${result.methodConfirmedCount} method step${if (result.methodConfirmedCount == 1) "" else "s"} confirmed.",
                                Modifier.padding(14.dp)
                            )
                        }
                    }
                } else {
                    items(result.methodIssues, key = { "method:${it.id}" }) { issue ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                                Text(issue.title, fontWeight = FontWeight.Bold)
                                Text(issue.detail)
                                Text(
                                    "${(issue.confidence * 100.0).roundToInt()}% review confidence",
                                    style = MaterialTheme.typography.bodySmall
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (!issue.suggestedStep.isNullOrBlank()) {
                                        Button(
                                            onClick = { onAcceptSecondPassMethod(issue.id) },
                                            modifier = Modifier.weight(1f)
                                        ) { Text("Use ChefVoice Review") }
                                    }
                                    OutlinedButton(
                                        onClick = { onKeepSecondPassMethod(issue.id) },
                                        modifier = Modifier.weight(1f)
                                    ) { Text("Keep current") }
                                }
                            }
                        }
                    }
                }
            }

            item { SectionTitle("Ingredients") }
            items(recipe.ingredients, key = { "ingredient:${it.id}" }) { ingredient ->
                if (isOwned && mediaEditMode) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("• ${ingredient.displayText()}", Modifier.weight(1f))
                        TextButton(onClick = { onRemoveIngredient(ingredient.id) }) { Text("Remove") }
                    }
                } else {
                    Text("• ${ingredient.displayText()}")
                }
            }

            item { SectionTitle("Method") }
            items(recipe.steps.withIndex().toList(), key = { "method:${recipe.stepIdAt(it.index)}" }) { indexed ->
                val stepId = recipe.stepIdAt(indexed.index)
                val stepMedia = recipe.media.filter { it.stepId == stepId }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row {
                            Text("${indexed.index + 1}.", fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(8.dp))
                            Text(indexed.value, Modifier.weight(1f))
                        }
                        stepMedia.forEach { attachment ->
                            MediaPreview(attachment, onRemove = if (isOwned && mediaEditMode) {{ onRemoveMedia(attachment.id) }} else null)
                        }
                        if (isOwned && mediaEditMode) {
                            TextButton(onClick = { onRemoveStep(stepId) }, modifier = Modifier.align(Alignment.End)) { Text("Remove step") }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { pickPhoto(stepId) }, modifier = Modifier.weight(1f)) { Text("+ Photo") }
                                OutlinedButton(onClick = { pickVideo(stepId) }, modifier = Modifier.weight(1f)) { Text("+ Video") }
                            }
                        }
                    }
                }
            }

            val displayVoiceClips = voiceClipsForDisplay(recipe.voiceClips)
            if (displayVoiceClips.isNotEmpty()) {
                item { SectionTitle("Original chef voice") }
                items(displayVoiceClips, key = { it.id }) { clip ->
                    val location = clip.playableLocation()
                    OutlinedButton(
                        enabled = location.isNotBlank(),
                        onClick = { onPlayVoice(location) },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("▶ Play ${clip.label}${if (clip.remoteUrl.isNotBlank()) " · Cloud" else ""}") }
                }
            }

            if (recipe.transcript.isNotEmpty()) {
                item { SectionTitle("Cooking transcript") }
                items(recipe.transcript, key = { it.id }) { segment ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(12.dp)) {
                            Text(formatElapsed(segment.elapsedMs), fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.width(10.dp))
                            Text(segment.text, Modifier.weight(1f))
                        }
                    }
                }
            }

            item { HorizontalDivider() }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onShare, modifier = Modifier.weight(1f)) { Text("Share") }
                    OutlinedButton(onClick = onLike, modifier = Modifier.weight(1f)) {
                        Text(if (isLiked) "♥ ${formatCount(recipe.likes)}" else "♡ ${formatCount(recipe.likes)}")
                    }
                }
            }
            if (recipe.isPublic && recipe.createdAt > 0) item { Text("Published ${relativeTime(recipe.createdAt)}", style = MaterialTheme.typography.bodySmall) }
            if (recipe.authorId.isNotBlank()) {
                item {
                    OutlinedButton(onClick = onBookmark, modifier = Modifier.fillMaxWidth()) {
                        Text(if (isBookmarked) "🔖 Saved to cookbook" else "🔖 Save to cookbook")
                    }
                }
                item { SectionTitle("Comments · ${recipe.commentCount}") }
                val rootComments = comments.filter { it.parentCommentId.isBlank() }
                if (rootComments.isEmpty()) {
                    item { Text("No comments yet. Be the first to talk about this recipe.") }
                } else {
                    rootComments.forEach { comment ->
                        item(key = "comment:${comment.id}") {
                            val highlighted = focusedCommentId == comment.id
                            Card(Modifier.fillMaxWidth(), colors = if (highlighted) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer) else CardDefaults.cardColors()) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(comment.authorName, fontWeight = FontWeight.Bold)
                                    Text(comment.text)
                                    if (isSignedIn) {
                                        Row {
                                            TextButton(onClick = { replyTarget = comment; replyText = "" }) { Text("Reply") }
                                            if (comment.authorId != signedInUserId && comment.authorId.isNotBlank()) TextButton(onClick = { onReportComment(comment) }) { Text("Report", color = MaterialTheme.colorScheme.error) }
                                        }
                                    }
                                }
                            }
                        }
                        val replies = comments.filter { it.parentCommentId == comment.id }
                        replies.forEach { reply ->
                            item(key = "reply:${reply.id}") {
                                val highlighted = focusedCommentId == reply.id
                                Card(Modifier.fillMaxWidth().padding(start = 28.dp), colors = if (highlighted) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer) else CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Text(reply.authorName, fontWeight = FontWeight.Bold)
                                        if (reply.replyToName.isNotBlank()) Text("Reply to ${reply.replyToName}", style = MaterialTheme.typography.bodySmall)
                                        Text(reply.text)
                                        if (isSignedIn && reply.authorId != signedInUserId) TextButton(onClick = { onReportComment(reply) }) { Text("Report", color = MaterialTheme.colorScheme.error) }
                                    }
                                }
                            }
                        }
                    }
                }
                replyTarget?.let { target ->
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("Replying to ${target.authorName}", fontWeight = FontWeight.SemiBold)
                                    TextButton(onClick = { replyTarget = null; replyText = "" }) { Text("Cancel") }
                                }
                                OutlinedTextField(value = replyText, onValueChange = { replyText = it.take(800) }, label = { Text("Write a reply") }, modifier = Modifier.fillMaxWidth())
                                Button(enabled = replyText.isNotBlank(), onClick = { onReply(target, replyText); replyTarget = null; replyText = "" }, modifier = Modifier.fillMaxWidth()) { Text("Post reply") }
                            }
                        }
                    }
                }
                if (isSignedIn) {
                    item {
                        OutlinedTextField(
                            value = commentText,
                            onValueChange = { commentText = it.take(800) },
                            label = { Text("Add a comment") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    item {
                        Button(
                            enabled = commentText.isNotBlank(),
                            onClick = { onComment(commentText); commentText = "" },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Post comment") }
                    }
                } else {
                    item { Text("Sign in on Profile to like, comment, follow and bookmark.") }
                }
            }
            if (cloudMessage.isNotBlank()) item { Text(cloudMessage, style = MaterialTheme.typography.bodySmall) }
            if (isOwned) {
                if (recipe.isPublic && recipe.communityUpdatePending) {
                    item {
                        Button(enabled = !recipeMutationBusy, onClick = onPublish, modifier = Modifier.fillMaxWidth()) { Text("🌎 Update Community") }
                    }
                }
                item {
                    if (recipe.isPublic) {
                        OutlinedButton(enabled = !recipeMutationBusy, onClick = onUnpublish, modifier = Modifier.fillMaxWidth()) { Text(if (recipeMutationBusy) "Updating…" else "Remove from Community") }
                    } else {
                        Button(enabled = !recipeMutationBusy, onClick = onPublish, modifier = Modifier.fillMaxWidth()) { Text("🌎 Publish to Community") }
                    }
                }
                item { TextButton(enabled = !recipeMutationBusy, onClick = { showDeleteConfirm = true }, modifier = Modifier.fillMaxWidth()) { Text(if (recipeMutationBusy) "Deleting…" else "Delete recipe") } }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete recipe?") },
            text = { Text(if (recipe.authorId.isNotBlank()) "ChefVoice will delete the cloud/Community recipe first. Only after that succeeds will it remove the recipe from this phone." else "This local recipe will be removed from this phone. This cannot be undone.") },
            confirmButton = { Button(onClick = { showDeleteConfirm = false; onDelete() }) { Text("Delete recipe") } },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") } }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CookingScreen(recipe: Recipe, onBack: () -> Unit, onPlayVoice: (String) -> Unit) {
    var stepIndex by remember(recipe.id) { mutableIntStateOf(0) }
    val step = recipe.steps.getOrNull(stepIndex)
    val speakerContext = LocalContext.current
    val speaker = remember { RecipeSpeaker(speakerContext) }
    var readAloud by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { speaker.shutdown() } }
    LaunchedEffect(stepIndex, readAloud) {
        if (readAloud) speaker.speak(step.orEmpty()) else speaker.stop()
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Cooking · ${recipe.title}") },
            navigationIcon = { TextButton(onClick = onBack) { Text("Back") } }
        )
    }) { padding ->
        Column(
            modifier = Modifier.padding(padding).padding(20.dp).fillMaxSize(),
            verticalArrangement = Arrangement.Center
        ) {
            if (recipe.steps.isEmpty()) {
                Text("No cooking steps were added to this recipe.", style = MaterialTheme.typography.headlineSmall)
            } else {
                Text("STEP ${stepIndex + 1} OF ${recipe.steps.size}", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(14.dp))
                Text(step.orEmpty(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                val activeStepMedia = recipe.media.filter { it.stepId == recipe.stepIdAt(stepIndex) }
                if (activeStepMedia.isNotEmpty()) {
                    Spacer(Modifier.height(14.dp))
                    activeStepMedia.take(2).forEach { MediaPreview(it) }
                    if (activeStepMedia.size > 2) Text("+${activeStepMedia.size - 2} more media item${if (activeStepMedia.size - 2 == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(28.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        enabled = stepIndex > 0,
                        onClick = { stepIndex-- },
                        modifier = Modifier.weight(1f)
                    ) { Text("Previous") }
                    Button(
                        enabled = stepIndex < recipe.steps.lastIndex,
                        onClick = { stepIndex++ },
                        modifier = Modifier.weight(1f)
                    ) { Text("Next") }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = { readAloud = !readAloud }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (readAloud) "🔊 Reading aloud — tap to stop" else "🔊 Read steps aloud")
                }
                if (recipe.voiceClips.isNotEmpty()) {
                    Spacer(Modifier.height(18.dp))
                    OutlinedButton(
                        onClick = { onPlayVoice(recipe.voiceClips.first().playableLocation()) },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("▶ Play chef's voice") }
                }
            }
        }
    }
}

@Composable
private fun PublicChefProfileScreen(
    uid: String,
    profile: ChefProfile?,
    followerCount: Long,
    recipes: List<Recipe>,
    isFollowing: Boolean,
    isSelf: Boolean,
    isSignedIn: Boolean,
    loading: Boolean,
    activeLive: LiveSession?,
    isBlocked: Boolean,
    onBack: () -> Unit,
    onFollow: () -> Unit,
    onMessage: () -> Unit,
    onReport: () -> Unit,
    onToggleBlock: () -> Unit,
    onWatchLive: (LiveSession) -> Unit,
    onOpenRecipe: (Recipe) -> Unit
) {
    LazyColumn(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { TextButton(onClick = onBack) { Text("← Back") } }
        item {
            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
                Column {
                    RemoteProfileImage(profile?.coverPhotoUrl.orEmpty(), "Chef cover", Modifier.fillMaxWidth().height(170.dp))
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        RemoteProfileImage(profile?.photoUrl.orEmpty(), "Chef profile", Modifier.size(82.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(profile?.displayName?.ifBlank { "Chef" } ?: if (loading) "Loading chef…" else "Chef", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            if (!profile?.bio.isNullOrBlank()) Text(profile!!.bio, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                        Column { Text("$followerCount", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Followers", style = MaterialTheme.typography.bodySmall) }
                        Column { Text("${recipes.size}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Recipes", style = MaterialTheme.typography.bodySmall) }
                    }
                    if (!profile?.favoriteThings.isNullOrEmpty()) { Spacer(Modifier.height(10.dp)); Text(profile!!.favoriteThings.joinToString("  ·  "), Modifier.padding(horizontal = 14.dp), style = MaterialTheme.typography.bodySmall) }
                    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (!isSelf) Button(enabled = isSignedIn, onClick = onFollow, modifier = Modifier.weight(1f)) { Text(if (isFollowing) "✓ Following" else "+ Follow") }
                        if (!isSelf && isSignedIn) OutlinedButton(onClick = onMessage, modifier = Modifier.weight(1f)) { Text("✉ Message") }
                        if (!isSelf && isSignedIn) {
                            var menuOpen by remember { mutableStateOf(false) }
                            Box {
                                TextButton(onClick = { menuOpen = true }) { Text("⋯", fontWeight = FontWeight.Bold) }
                                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                    DropdownMenuItem(text = { Text("⚑ Report chef", color = MaterialTheme.colorScheme.error) }, onClick = { menuOpen = false; onReport() })
                                    DropdownMenuItem(text = { Text(if (isBlocked) "Unblock chef" else "🚫 Block chef", color = MaterialTheme.colorScheme.error) }, onClick = { menuOpen = false; onToggleBlock() })
                                }
                            }
                        }
                    }
                    if (activeLive != null) Button(onClick = { onWatchLive(activeLive) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 14.dp)) { Text("🔴 Watch Live") }
                }
            }
        }
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("Finished dishes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Text("${recipes.size}") } }
        if (recipes.isEmpty()) item { EmptyState("No public recipes yet", "This chef has not published a finished dish yet.") }
        else items(recipes.chunked(2), key = { row -> row.joinToString("|") { it.id } }) { rowRecipes ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                rowRecipes.forEach { recipe ->
                    Card(Modifier.weight(1f).clickable { onOpenRecipe(recipe) }) {
                        Column {
                            val hero = recipe.media.firstOrNull { it.type == MediaType.IMAGE } ?: recipe.media.firstOrNull()
                            if (hero != null) RecipeMediaBanner(hero, Modifier.fillMaxWidth().height(150.dp)) else Box(Modifier.fillMaxWidth().height(150.dp).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) { Text("🍽️", style = MaterialTheme.typography.headlineLarge) }
                            Text(recipe.title, Modifier.padding(10.dp), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                if (rowRecipes.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        item { Text("Follower identities are not exposed here. ChefVoice shows counts only for now.", style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun ProfileScreen(
    cloudConfigured: Boolean,
    isSignedIn: Boolean,
    signedInEmail: String,
    signedInEmailVerified: Boolean,
    moderatorAccess: Boolean,
    moderationReports: List<ChefReport>,
    moderationError: String,
    displayName: String,
    bio: String,
    photoUrl: String,
    coverPhotoUrl: String,
    favoriteThings: List<String>,
    recipeCount: Int,
    publicCount: Int,
    followerCount: Long,
    followingCount: Int,
    bookmarkCount: Int,
    bookmarks: List<Recipe>,
    accountBusy: Boolean,
    cloudMessage: String,
    needsReauthForDelete: Boolean,
    isPro: Boolean,
    proEntitlement: ProEntitlement,
    proPreviewAvailable: Boolean,
    proPreviewOverride: Boolean,
    onProPreviewChange: (Boolean) -> Unit,
    onSeePro: () -> Unit,
    secondPassUsed: Int,
    secondPassLimit: Int,
    cloudRecipeCount: Int,
    unreadMessageCount: Int,
    unreadNotificationCount: Int,
    blackoutMode: Boolean,
    onBlackoutModeChange: (Boolean) -> Unit,
    onSaveProfile: (String, String, List<String>) -> Unit,
    onUploadProfilePhoto: (String, Uri) -> Unit,
    onMessages: () -> Unit,
    onNotifications: () -> Unit,
    onCommunity: () -> Unit,
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String, String) -> Unit,
    onResetPassword: (String) -> Unit,
    onVerifyEmail: () -> Unit,
    onDeleteAccount: () -> Unit,
    onConfirmDeletePassword: (String) -> Unit,
    onCancelDeleteReauth: () -> Unit,
    onModerateReport: (String, String, String, String) -> Unit,
    onSignOut: () -> Unit,
    onOpenRecipe: (Recipe) -> Unit
) {
    var name by remember(displayName) { mutableStateOf(displayName) }
    var bioText by remember(bio) { mutableStateOf(bio) }
    var favoritesText by remember(favoriteThings) { mutableStateOf(favoriteThings.joinToString(", ")) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var creatingAccount by remember { mutableStateOf(false) }
    var newChefName by remember { mutableStateOf("") }
    var deleteArmed by remember { mutableStateOf(false) }
    var deletePassword by remember { mutableStateOf("") }
    var moderationNote by remember { mutableStateOf("") }
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onUploadProfilePhoto("avatar", uri)
    }
    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onUploadProfilePhoto("cover", uri)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("Chef Profile", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(if (isSignedIn) "Signed in as $signedInEmail" else "Your public cooking identity across ChefVoice Community.")
        }

        item {
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Appearance", fontWeight = FontWeight.Bold)
                        Text(if (blackoutMode) "Blackout mode is on" else "Reduce bright white screens", style = MaterialTheme.typography.bodySmall)
                    }
                    OutlinedButton(onClick = { onBlackoutModeChange(!blackoutMode) }) { Text(if (blackoutMode) "☀ Light" else "🌙 Blackout") }
                }
            }
        }

        if (isSignedIn) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        RemoteProfileImage(coverPhotoUrl, "Chef profile cover", Modifier.fillMaxWidth().height(150.dp))
                        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            RemoteProfileImage(photoUrl, "Chef profile photo", Modifier.size(76.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(name.ifBlank { "Chef" }, fontWeight = FontWeight.Bold)
                                Text("$followerCount followers · $followingCount following · $publicCount public recipes", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        Row(Modifier.padding(horizontal = 14.dp).padding(bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                enabled = !accountBusy,
                                onClick = { avatarPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                modifier = Modifier.weight(1f)
                            ) { Text("Profile photo") }
                            OutlinedButton(
                                enabled = !accountBusy,
                                onClick = { coverPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                modifier = Modifier.weight(1f)
                            ) { Text("Cover photo") }
                        }
                    }
                }
            }
        }

        if (!cloudConfigured) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Firebase not connected", fontWeight = FontWeight.Bold)
                        Text("The app still works locally. Put google-services.json in the app folder and rebuild to activate accounts and Community.")
                    }
                }
            }
        } else if (!isSignedIn) {
            // Signing in and creating an account are separate modes. They used to share
            // one form, which showed returning users a "Chef name for new account" field
            // bound to the same state as the profile editor below - so typing a name
            // while signing in silently rewrote the saved display name.
            item {
                Text(
                    if (creatingAccount) "Create your ChefVoice account" else "Sign in to ChefVoice",
                    fontWeight = FontWeight.Bold
                )
            }
            item { OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
            item { OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth(), singleLine = true, visualTransformation = PasswordVisualTransformation()) }
            if (creatingAccount) {
                item {
                    OutlinedTextField(
                        value = newChefName,
                        onValueChange = { newChefName = it.take(80) },
                        label = { Text("Chef name") },
                        supportingText = { Text("How other cooks will see you in Community. You can change it later.") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
            }
            item {
                if (creatingAccount) {
                    Button(
                        enabled = !accountBusy && email.isNotBlank() && password.length >= 6 && newChefName.isNotBlank(),
                        onClick = { onSignUp(email, password, newChefName) },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Create account") }
                } else {
                    Button(
                        enabled = !accountBusy && email.isNotBlank() && password.length >= 6,
                        onClick = { onSignIn(email, password) },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Sign in") }
                }
            }
            item {
                OutlinedButton(
                    enabled = !accountBusy,
                    onClick = { creatingAccount = !creatingAccount },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (creatingAccount) "Already have an account? Sign in" else "New to ChefVoice? Create an account") }
            }
            if (!creatingAccount) {
                item { OutlinedButton(enabled = !accountBusy && email.isNotBlank(), onClick = { onResetPassword(email) }, modifier = Modifier.fillMaxWidth()) { Text("Forgot password?") } }
            }
        }

        if (isSignedIn) {
            item {
                ProMembershipCard(
                    isPro = isPro,
                    entitlement = proEntitlement,
                    secondPassUsed = secondPassUsed,
                    secondPassLimit = secondPassLimit,
                    cloudRecipeCount = cloudRecipeCount,
                    onSeePro = onSeePro
                )
            }
            if (proPreviewAvailable) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Preview ChefVoice Pro", fontWeight = FontWeight.Bold)
                                Text(
                                    "Debug builds only. Renders the Pro experience without a purchase. " +
                                        "Nothing is written to your account and this switch does not exist in a release build.",
                                    style = MaterialTheme.typography.bodySmall
                                )
                            }
                            Switch(checked = proPreviewOverride, onCheckedChange = onProPreviewChange)
                        }
                    }
                }
            }
        }

        // Profile editing needs an account to save to. These fields used to render
        // while signed out, above a Save button that could not do anything.
        if (isSignedIn) {
            item { OutlinedTextField(value = name, onValueChange = { name = it.take(80) }, label = { Text("Chef / display name") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
            item { OutlinedTextField(value = bioText, onValueChange = { bioText = it.take(500) }, label = { Text("Chef bio") }, supportingText = { Text("Tell people what you love about cooking.") }, modifier = Modifier.fillMaxWidth(), minLines = 3) }
            item {
                OutlinedTextField(
                    value = favoritesText,
                    onValueChange = { favoritesText = it.take(240) },
                    label = { Text("Favorite things to cook") },
                    supportingText = { Text("Comma separated · e.g. BBQ, pasta, seafood, baking") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
            }
            item {
                Button(
                    enabled = !accountBusy,
                    onClick = { onSaveProfile(name, bioText, favoritesText.split(',').map { it.trim() }.filter { it.isNotBlank() }) },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Save Chef Profile") }
            }

            if (favoriteThings.isNotEmpty()) item { FavoriteThingsCard(favoriteThings) }
        }

        if (isSignedIn) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Account & privacy", fontWeight = FontWeight.Bold)
                        Text("Email ${if (signedInEmailVerified) "verified" else "not verified"}", style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(enabled = !accountBusy && !signedInEmailVerified, onClick = onVerifyEmail, modifier = Modifier.weight(1f)) { Text(if (signedInEmailVerified) "✓ Verified" else "Verify email") }
                            OutlinedButton(enabled = !accountBusy, onClick = { onResetPassword(signedInEmail) }, modifier = Modifier.weight(1f)) { Text("Reset password") }
                        }
                        Text("Deleting your cloud account removes owned Community data but intentionally keeps local Cook & Capture recipes on this phone.", style = MaterialTheme.typography.bodySmall)
                        if (needsReauthForDelete) {
                            Text("For security, enter your password to confirm this is you before we permanently delete your account.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            OutlinedTextField(
                                value = deletePassword,
                                onValueChange = { deletePassword = it },
                                label = { Text("Password") },
                                visualTransformation = PasswordVisualTransformation(),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    enabled = !accountBusy && deletePassword.isNotBlank(),
                                    onClick = { onConfirmDeletePassword(deletePassword); deletePassword = "" },
                                    modifier = Modifier.weight(1f)
                                ) { Text("Confirm delete") }
                                OutlinedButton(
                                    enabled = !accountBusy,
                                    onClick = { deletePassword = ""; deleteArmed = false; onCancelDeleteReauth() },
                                    modifier = Modifier.weight(1f)
                                ) { Text("Cancel") }
                            }
                        } else if (!deleteArmed) {
                            OutlinedButton(enabled = !accountBusy, onClick = { deleteArmed = true }, modifier = Modifier.fillMaxWidth()) { Text("Delete ChefVoice cloud account") }
                        } else {
                            Text("Confirm permanent cloud deletion. Recent sign-in is required.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(enabled = !accountBusy, onClick = { deleteArmed = false; onDeleteAccount() }, modifier = Modifier.weight(1f)) { Text("Confirm delete") }
                                OutlinedButton(onClick = { deleteArmed = false }, modifier = Modifier.weight(1f)) { Text("Cancel") }
                            }
                        }
                    }
                }
            }
        }

        if (moderatorAccess) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Safety moderation", fontWeight = FontWeight.Bold)
                        Text("Visible only to ChefVoice admin/moderator claims.", style = MaterialTheme.typography.bodySmall)
                        if (moderationError.isNotBlank()) Text(moderationError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(value = moderationNote, onValueChange = { moderationNote = it.take(1000) }, label = { Text("Optional moderator note") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                    }
                }
            }
            if (moderationReports.isEmpty()) item { Text("No recent reports.", style = MaterialTheme.typography.bodySmall) }
            items(moderationReports, key = { "report-${it.id}" }) { report ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${report.targetType}: ${report.targetId.ifBlank { report.targetUid }}", fontWeight = FontWeight.Bold)
                        Text(report.reason)
                        Text("Status: ${report.status}", style = MaterialTheme.typography.bodySmall)
                        if (report.status == "open") {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                OutlinedButton(enabled = !accountBusy, onClick = { onModerateReport(report.id, "reviewed", moderationNote, "") }, modifier = Modifier.weight(1f)) { Text("Reviewed") }
                                run {
                                    val action = when (report.targetType.lowercase()) {
                                        "user" -> "restrict_24h"
                                        "recipe" -> "unpublish_recipe"
                                        "comment", "reply", "message" -> "remove_content"
                                        else -> ""
                                    }
                                    val label = when (action) {
                                        "restrict_24h" -> "Restrict 24h"
                                        "unpublish_recipe" -> "Remove from Community"
                                        "remove_content" -> "Remove content"
                                        else -> "Action unavailable"
                                    }
                                    Button(enabled = !accountBusy && action.isNotBlank(), onClick = { onModerateReport(report.id, "actioned", moderationNote, action) }, modifier = Modifier.weight(1f)) { Text(label) }
                                }
                            }
                            OutlinedButton(enabled = !accountBusy, onClick = { onModerateReport(report.id, "dismissed", moderationNote, "") }, modifier = Modifier.fillMaxWidth()) { Text("Dismiss") }
                        } else if (report.moderatorNote.isNotBlank() || report.action.isNotBlank()) {
                            Text(report.moderatorNote.ifBlank { report.action }, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }

        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Community", fontWeight = FontWeight.Bold)
                    Text("$recipeCount saved recipes · $publicCount public · $bookmarkCount saved from Community")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onMessages, modifier = Modifier.weight(1f)) { Text(if (unreadMessageCount > 0) "✉ Messages ($unreadMessageCount)" else "✉ Messages") }
                        OutlinedButton(onClick = onNotifications, modifier = Modifier.weight(1f)) { Text(if (unreadNotificationCount > 0) "🔔 Alerts ($unreadNotificationCount)" else "🔔 Alerts") }
                    }
                    OutlinedButton(onClick = onCommunity, modifier = Modifier.fillMaxWidth()) { Text("🌎 Find chefs") }
                }
            }
        }

        if (bookmarks.isNotEmpty()) {
            item { SectionTitle("Saved from Community") }
            items(bookmarks, key = { it.id }) { recipe -> RecipeCard(recipe) { onOpenRecipe(recipe) } }
        }

        if (cloudMessage.isNotBlank()) item { Text(cloudMessage, style = MaterialTheme.typography.bodySmall) }
        if (isSignedIn) item { OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") } }
        item { Text("v0.10.1 adds optional prep/cook time metadata and keeps saved photo/video editing, parser behavior, and Second Pass review intact.", style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun ChefProfileSummaryCard(profile: ChefProfile) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RemoteProfileImage(profile.photoUrl, "${profile.displayName} profile photo", Modifier.size(56.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(profile.displayName.ifBlank { "Chef" }, fontWeight = FontWeight.Bold)
                    if (profile.bio.isNotBlank()) Text(profile.bio, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
            }
            if (profile.favoriteThings.isNotEmpty()) FavoriteThingsCard(profile.favoriteThings)
        }
    }
}

@Composable
private fun FavoriteThingsCard(items: List<String>) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Favorite things to cook", fontWeight = FontWeight.Bold)
            Text(items.take(12).joinToString("  ·  "))
        }
    }
}

@Composable
private fun RemoteProfileImage(url: String, description: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, shape = RoundedCornerShape(18.dp)) {
        ChefAsyncImage(
            model = url.takeIf { it.startsWith("https://") },
            contentDescription = description,
            modifier = Modifier.fillMaxSize()
        ) {
            Text("👨‍🍳", style = MaterialTheme.typography.headlineMedium)
        }
    }
}

/**
 * Holds the screen awake while the chef is capturing. A phone propped against the
 * flour bag should not lock itself halfway through a recipe.
 */
@Composable
private fun KeepScreenOn(enabled: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, enabled) {
        view.keepScreenOn = enabled
        onDispose { view.keepScreenOn = false }
    }
}

@Composable
private fun BrandCoverScreen() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        Image(
            painter = painterResource(R.drawable.chefvoice_cover),
            contentDescription = "ChefVoice cover",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize()
        )
    }
}

@Composable
private fun BrandHeroImage(resId: Int, contentDescription: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp)
    ) {
        Image(
            painter = painterResource(resId),
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(170.dp)
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
}

@Composable
private fun EmptyState(title: String, body: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(body)
        }
    }
}

/**
 * Placeholder pricing for the pre-billing demo only.
 *
 * Real prices must come from Play `ProductDetails.formattedPrice` once Billing is
 * wired: Play localises price and currency per storefront, and a hard-coded string
 * shows the wrong currency to most of the world. This object exists so there is
 * exactly one place to delete when that lands.
 */
private object DemoPricing {
    const val MONTHLY = "$6.99/month"
    const val ANNUAL = "$39.99/year"
    const val ANNUAL_NOTE = "Save about 52% versus monthly"
}

/**
 * Remaining complimentary access in whatever unit reads naturally. "641 days left" is
 * true and useless; a chef two years into free Pro wants to hear months. Only used for
 * the founding window — the 90-day promo stays in days, where the precision is the
 * point and "2 months left" would blur a deadline that is close enough to matter.
 */
private fun remainingLabel(days: Int): String =
    if (days >= 60) {
        val months = days / 30
        "$months month${if (months == 1) "" else "s"}"
    } else {
        "$days day${if (days == 1) "" else "s"}"
    }

@Composable
private fun ProMembershipCard(
    isPro: Boolean,
    entitlement: ProEntitlement,
    secondPassUsed: Int,
    secondPassLimit: Int,
    cloudRecipeCount: Int,
    onSeePro: () -> Unit
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when {
                        isPro && entitlement.isFounding -> "ChefVoice Pro · Founding member"
                        isPro && entitlement.isPromo -> "ChefVoice Pro · Free launch access"
                        isPro -> "ChefVoice Pro"
                        else -> "ChefVoice Free"
                    },
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                if (isPro) Text("✓ Active", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
            }

            when {
                // Complimentary access is stated plainly, before any payment-state
                // messaging below. These chefs never entered a payment method, so
                // warning them about one, or offering to manage a subscription they
                // do not have, would be nonsense.
                isPro && entitlement.isFounding -> {
                    val days = entitlement.daysRemaining()
                    Text(
                        when {
                            days <= 0 ->
                                "Your founding Pro access has ended. Everything you cooked stays yours."
                            // Defensive: a founding grant always carries an expiry now.
                            days == Int.MAX_VALUE ->
                                "You were one of the first ${FoundingAccess.SEATS} chefs on " +
                                    "ChefVoice. Pro is yours — no card, no renewal, nothing to cancel."
                            else ->
                                "You were one of the first ${FoundingAccess.SEATS} chefs on " +
                                    "ChefVoice. Pro is free for ${FoundingAccess.FOUNDING_YEARS} " +
                                    "years — ${remainingLabel(days)} left. No card, no renewal, " +
                                    "nothing to cancel."
                        },
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                isPro && entitlement.isPromo -> {
                    val days = entitlement.daysRemaining()
                    Text(
                        if (days > 0)
                            "The first ${FoundingAccess.PROMO_DAYS} days of Pro are free — " +
                                "$days ${if (days == 1) "day" else "days"} left. " +
                                "No card, and nothing happens automatically when it ends."
                        else "Your free Pro access has ended. Everything you cooked stays yours.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                // Grace period and account hold are the states worth surfacing plainly.
                // A large share of subscription churn is a failed card, not a decision,
                // and a chef who does not know their payment failed cannot fix it.
                entitlement.status == ProEntitlement.STATUS_IN_GRACE -> Text(
                    "Your last payment did not go through. Google Play is retrying — update your payment method to keep Pro.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
                entitlement.status == ProEntitlement.STATUS_ON_HOLD -> Text(
                    "Your subscription is on hold because payment failed. Pro features are paused until it is fixed in Google Play.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
                entitlement.status == ProEntitlement.STATUS_PAUSED -> Text(
                    "Your subscription is paused. Resume it in Google Play to get Pro back.",
                    style = MaterialTheme.typography.bodySmall
                )
                isPro -> Text(
                    "Unlimited cloud recipes, video, and ${ProTierLimits.SECOND_PASS_PER_MONTH} Second Pass reviews a month.",
                    style = MaterialTheme.typography.bodySmall
                )
                else -> Text(
                    "${FreeTierLimits.CLOUD_RECIPES} cloud recipes, 1 photo per recipe, and " +
                        "${FreeTierLimits.SECOND_PASS_PER_MONTH} Second Pass reviews a month. " +
                        "Cooking and local recipes are always free.",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            HorizontalDivider()
            Text(
                "Second Pass this month: $secondPassUsed of $secondPassLimit",
                style = MaterialTheme.typography.bodySmall
            )
            Text(
                if (isPro) "Cloud-synced recipes: $cloudRecipeCount"
                else "Cloud-synced recipes: $cloudRecipeCount of ${FreeTierLimits.CLOUD_RECIPES}",
                style = MaterialTheme.typography.bodySmall
            )
            Text(
                if (isPro) "Video slots unlocked" else "Video slots need Pro · 1 photo per recipe on Free",
                style = MaterialTheme.typography.bodySmall
            )

            if (!isPro) {
                Button(onClick = onSeePro, modifier = Modifier.fillMaxWidth()) { Text("See ChefVoice Pro") }
            }
        }
    }
}

/**
 * The paywall. Worded as capability rather than restriction, and never shown before
 * a chef has finished a recipe — the value has to land before the ask.
 */
@Composable
private fun ProPaywallDialog(
    trigger: String,
    onDismiss: () -> Unit,
    onStartCheckout: (String) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ChefVoice Pro") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    when (trigger) {
                        PaywallTrigger.SECOND_PASS ->
                            "Second Pass checks every recipe against your original audio and shows you what it caught. " +
                                "Two free each month — ${ProTierLimits.SECOND_PASS_PER_MONTH} a month with ChefVoice Pro."
                        PaywallTrigger.CLOUD_LIMIT ->
                            "You've filled your ${FreeTierLimits.CLOUD_RECIPES} free cloud recipes. " +
                                "ChefVoice Pro syncs your whole cookbook so it survives a lost phone."
                        PaywallTrigger.VIDEO ->
                            "Video slots let you show the technique, not just the result. ChefVoice Pro unlocks them."
                        else ->
                            "More room to cook, sync and review — without touching what's already free."
                    }
                )
                Text("Pro includes", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                Text(
                    "• Unlimited cloud-synced recipes\n" +
                        "• Video slots on your recipes\n" +
                        "• ${ProTierLimits.SECOND_PASS_PER_MONTH} Second Pass reviews a month\n" +
                        "• Private recipes, collections, export and print",
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    "Cooking, the deterministic parser and every recipe saved on this phone stay free and keep working.",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        },
        confirmButton = {
            Column {
                Button(
                    onClick = { onStartCheckout(ProEntitlement.PRODUCT_ANNUAL) },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(DemoPricing.ANNUAL) }
                Text(DemoPricing.ANNUAL_NOTE, style = MaterialTheme.typography.bodySmall)
                OutlinedButton(
                    onClick = { onStartCheckout(ProEntitlement.PRODUCT_MONTHLY) },
                    modifier = Modifier.fillMaxWidth()
                ) { Text(DemoPricing.MONTHLY) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Not now") } }
    )
}

/** Where a paywall was raised from. Recorded with the `paywall_shown` analytics event. */
object PaywallTrigger {
    const val SECOND_PASS = "second_pass"
    const val CLOUD_LIMIT = "cloud_limit"
    const val VIDEO = "video"
    const val PROFILE = "profile"
}
