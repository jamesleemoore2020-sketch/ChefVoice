package com.chefvoice.app.cloud

import android.content.Context
import android.net.Uri
import android.media.MediaMetadataRetriever
import android.os.Handler
import android.os.Looper
import com.chefvoice.app.model.ChefNotification
import com.chefvoice.app.model.ChefProfile
import com.chefvoice.app.model.ChefReport
import com.chefvoice.app.model.ChefSearchResult
import com.chefvoice.app.model.DirectConversation
import com.chefvoice.app.model.DirectMessage
import com.chefvoice.app.model.Ingredient
import com.chefvoice.app.model.LiveComment
import com.chefvoice.app.model.LiveSession
import com.chefvoice.app.model.MediaAttachment
import com.chefvoice.app.model.MediaType
import com.chefvoice.app.model.NotificationPreferences
import com.chefvoice.app.model.Recipe
import com.chefvoice.app.model.stableStepIds
import com.chefvoice.app.model.RecipeComment
import com.chefvoice.app.model.VoiceClip
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

data class CloudSecondPassSegment(
    val text: String,
    val confidence: Double? = null
)

data class CloudSecondPassResult(
    val provider: String,
    val model: String,
    val transcript: String,
    val segments: List<CloudSecondPassSegment>,
    val processedAt: Long
)


data class CloudRecipeMutationCheck(
    val exists: Boolean,
    val authorId: String
)

private data class CloudUploadPermit(
    val permitId: String,
    val token: String
)

/**
 * Firebase-backed social layer for ChefVoice.
 *
 * The Android project deliberately builds without google-services.json. When that file is
 * present in app/, the Google Services plugin creates the resources needed for Firebase's
 * automatic default-app initialization and this repository becomes active.
 */
class FirebaseSocialRepository(private val context: Context) {
    companion object {
        const val LIVE_HEARTBEAT_INTERVAL_MS = 10_000L
        const val LIVE_LEASE_TIMEOUT_MS = 35_000L
        const val LIVE_LEGACY_GRACE_MS = 90_000L
        private const val LIVE_LEASE_REFRESH_MS = 5_000L
        private const val MAX_PUBLISHED_MEDIA_SLOTS = 24
        private const val MAX_PUBLIC_VOICE_SLOTS = 16
        private const val SECOND_PASS_MAX_DECLARED_DURATION_MS = 90L * 60L * 1000L
    }

    private var publicRecipeCursor: DocumentSnapshot? = null
    private var publicRecipeHasMore: Boolean = true
    private val communityPageSize = 60L

    val isConfigured: Boolean
        get() = FirebaseApp.getApps(context).isNotEmpty()

    private fun authOrNull(): FirebaseAuth? = if (!isConfigured) null else runCatching { FirebaseAuth.getInstance() }.getOrNull()
    private fun dbOrNull(): FirebaseFirestore? = if (!isConfigured) null else runCatching { FirebaseFirestore.getInstance() }.getOrNull()
    private fun storageOrNull(): FirebaseStorage? = if (!isConfigured) null else runCatching { FirebaseStorage.getInstance() }.getOrNull()
    private fun functionsOrNull(): FirebaseFunctions? = if (!isConfigured) null else runCatching { FirebaseFunctions.getInstance("us-central1") }.getOrNull()

    private fun authorizeStorageUpload(
        kind: String,
        recipeId: String = "",
        fileName: String,
        bytes: Long,
        contentType: String,
        callback: (CloudUploadPermit?, String?) -> Unit
    ) {
        if (bytes <= 0L) return callback(null, "ChefVoice could not determine the upload size.")
        val functions = functionsOrNull() ?: return callback(null, "Cloud Functions are not available.")
        functions.getHttpsCallable("authorizeChefVoiceStorageUpload")
            .call(mapOf("kind" to kind, "recipeId" to recipeId, "fileName" to fileName, "bytes" to bytes, "contentType" to contentType))
            .addOnSuccessListener { result ->
                val data = result.data as? Map<*, *>
                val permitId = data?.get("permitId")?.toString().orEmpty()
                val token = data?.get("token")?.toString().orEmpty()
                if (permitId.isBlank() || token.isBlank()) callback(null, "ChefVoice could not authorize this cloud upload.")
                else callback(CloudUploadPermit(permitId, token), null)
            }
            .addOnFailureListener { callback(null, it.message ?: "ChefVoice cloud upload authorization failed.") }
    }

    private fun metadataWithPermit(
        contentType: String,
        permit: CloudUploadPermit,
        extra: Map<String, String> = emptyMap()
    ): StorageMetadata {
        val builder = StorageMetadata.Builder().setContentType(contentType)
        extra.forEach { (key, value) -> builder.setCustomMetadata(key, value) }
        builder.setCustomMetadata("chefvoicePermitId", permit.permitId)
        builder.setCustomMetadata("chefvoiceUploadToken", permit.token)
        return builder.build()
    }

    private fun uriSize(uri: Uri): Long {
        val afdSize = runCatching { context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L }.getOrDefault(-1L)
        return afdSize.coerceAtLeast(0L)
    }

    private fun audioDurationMs(file: File): Long {
        if (!file.exists() || file.length() <= 0L) return 0L
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.absolutePath)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
        } catch (_: Throwable) {
            0L
        } finally {
            runCatching { retriever.release() }
        }
    }

    val currentUser: FirebaseUser?
        get() = authOrNull()?.currentUser

    fun addAuthListener(onChanged: (FirebaseUser?) -> Unit): FirebaseAuth.AuthStateListener? {
        val auth = authOrNull() ?: run {
            onChanged(null)
            return null
        }
        val listener = FirebaseAuth.AuthStateListener { onChanged(it.currentUser) }
        auth.addAuthStateListener(listener)
        return listener
    }

    fun removeAuthListener(listener: FirebaseAuth.AuthStateListener?) {
        if (listener != null) authOrNull()?.removeAuthStateListener(listener)
    }

    fun signUp(email: String, password: String, displayName: String, callback: (String?) -> Unit) {
        val auth = authOrNull() ?: return callback("Firebase is not connected yet.")
        auth.createUserWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener { result ->
                val user = result.user ?: return@addOnSuccessListener callback("Account created, but the user session was unavailable.")
                val name = displayName.trim().ifBlank { email.substringBefore('@').ifBlank { "Chef" } }
                saveProfile(
                    ChefProfile(uid = user.uid, displayName = name),
                    isNewProfile = true,
                    callback = callback
                )
            }
            .addOnFailureListener { callback(it.message ?: "Could not create account.") }
    }

    fun signIn(email: String, password: String, callback: (String?) -> Unit) {
        val auth = authOrNull() ?: return callback("Firebase is not connected yet.")
        auth.signInWithEmailAndPassword(email.trim(), password)
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not sign in.") }
    }

    fun signOut(callback: () -> Unit = {}) {
        val auth = authOrNull() ?: return callback()
        val uid = auth.currentUser?.uid.orEmpty()
        if (uid.isBlank()) {
            auth.signOut()
            callback()
            return
        }
        val db = dbOrNull()
        if (db == null) {
            auth.signOut()
            callback()
            return
        }
        FirebaseInstallations.getInstance().id.addOnCompleteListener { idTask ->
            val fid = idTask.result.orEmpty()
            if (idTask.isSuccessful && fid.isNotBlank()) {
                db.collection("users").document(uid).collection("notificationDevices").document(fid)
                    .delete()
                    .addOnCompleteListener {
                        auth.signOut()
                        callback()
                    }
            } else {
                auth.signOut()
                callback()
            }
        }
    }

    fun sendPasswordReset(email: String, callback: (String?) -> Unit = {}) {
        val auth = authOrNull() ?: return callback("Firebase is not connected yet.")
        val clean = email.trim()
        if (clean.isBlank()) return callback("Enter the ChefVoice account email first.")
        auth.sendPasswordResetEmail(clean)
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not send password reset email.") }
    }

    fun sendVerificationEmail(callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to verify your ChefVoice email.")
        if (user.isEmailVerified) return callback(null)
        user.sendEmailVerification()
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not send verification email.") }
    }

    /**
     * FirebaseAuth's cached [currentUser] only picks up a server-side isEmailVerified
     * flip via [android.gms.FirebaseUser.reload] -- the AuthStateListener does not fire
     * just because verification status changed, so without this callers stay stuck
     * showing "not verified" until the next sign-in.
     */
    fun refreshEmailVerification(callback: (Boolean) -> Unit) {
        val user = currentUser ?: return callback(false)
        user.reload()
            .addOnSuccessListener { callback(user.isEmailVerified) }
            .addOnFailureListener { callback(user.isEmailVerified) }
    }

    fun checkModeratorAccess(callback: (Boolean, String?) -> Unit) {
        val user = currentUser ?: return callback(false, null)
        user.getIdToken(true)
            .addOnSuccessListener { result ->
                val claims = result.claims
                callback(claims["admin"] == true || claims["moderator"] == true, null)
            }
            .addOnFailureListener { callback(false, it.message ?: "Could not verify moderator access.") }
    }

    fun listenModerationReports(
        onChanged: (List<ChefReport>) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("reports")
            .orderBy("createdAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(75)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Moderation reports could not be loaded.")
                    return@addSnapshotListener
                }
                onChanged(snapshot?.documents.orEmpty().map { it.toChefReport() })
            }
    }

    fun moderateReport(
        reportId: String,
        status: String,
        moderatorNote: String = "",
        action: String = "",
        callback: (String?) -> Unit = {}
    ) {
        val functions = functionsOrNull() ?: return callback("Firebase Functions are not available.")
        functions.getHttpsCallable("moderateChefVoiceReport")
            .call(mapOf(
                "reportId" to reportId.trim(),
                "status" to status.trim(),
                "moderatorNote" to moderatorNote.trim().take(1000),
                "action" to action.trim().take(240)
            ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not update report.") }
    }

    /**
     * @param callback (needsReauth, error). needsReauth is true when the backend's auth_time
     * freshness gate rejected the request; the ID token is valid but wasn't minted by a recent
     * interactive sign-in. Call [reauthenticateAndDeleteChefVoiceAccount] rather than
     * treating that case as a generic failure.
     */
    fun deleteChefVoiceAccount(callback: (needsReauth: Boolean, error: String?) -> Unit = { _, _ -> }) {
        val functions = functionsOrNull() ?: return callback(false, "Firebase Functions are not available.")
        if (currentUser == null) return callback(false, "Sign in to delete your ChefVoice account.")
        functions.getHttpsCallable("deleteChefVoiceAccount")
            .withTimeout(540, TimeUnit.SECONDS)
            .call()
            .addOnSuccessListener {
                runCatching { authOrNull()?.signOut() }
                callback(false, null)
            }
            .addOnFailureListener { error ->
                val functionsError = error as? FirebaseFunctionsException
                if (functionsError?.code == FirebaseFunctionsException.Code.FAILED_PRECONDITION) {
                    callback(true, null)
                } else {
                    callback(false, error.message ?: "Could not delete ChefVoice account.")
                }
            }
    }

    /**
     * Re-proves identity with the account's password and forces a fresh ID token so the backend
     * sees a current `auth_time`, then retries deletion. `getIdToken(true)` is required: the
     * reauthenticate() call alone does not refresh the cached token the Functions SDK sends.
     */
    fun reauthenticateAndDeleteChefVoiceAccount(password: String, callback: (needsReauth: Boolean, error: String?) -> Unit = { _, _ -> }) {
        val user = currentUser ?: return callback(false, "Sign in to delete your ChefVoice account.")
        val email = user.email
        if (email.isNullOrBlank()) return callback(false, "This account has no email/password sign-in to verify against.")
        if (password.isBlank()) return callback(false, "Enter your password to continue.")
        user.reauthenticate(EmailAuthProvider.getCredential(email, password))
            .addOnSuccessListener {
                user.getIdToken(true)
                    .addOnSuccessListener { deleteChefVoiceAccount(callback) }
                    .addOnFailureListener { callback(false, it.message ?: "Could not refresh your sign-in. Try again.") }
            }
            .addOnFailureListener { callback(false, it.message ?: "Incorrect password.") }
    }

    fun syncNotificationDevice(callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback(null)
        val db = dbOrNull() ?: return callback("Firestore is not available for notifications.")
        runCatching { FirebaseMessaging.getInstance() }.getOrNull()
            ?.register()
            ?.addOnCompleteListener { registerTask ->
                if (!registerTask.isSuccessful) {
                    callback(registerTask.exception?.message ?: "Phone notifications could not be registered.")
                    return@addOnCompleteListener
                }
                FirebaseInstallations.getInstance().id.addOnCompleteListener { idTask ->
                    val fid = idTask.result.orEmpty()
                    if (!idTask.isSuccessful || fid.isBlank()) {
                        callback(idTask.exception?.message ?: "Phone notification installation ID was unavailable.")
                        return@addOnCompleteListener
                    }
                    // The async registration may finish after an account switch. Never
                    // attach this installation to a user who is no longer signed in.
                    if (currentUser?.uid != user.uid) {
                        callback(null)
                        return@addOnCompleteListener
                    }
                    db.collection("users").document(user.uid).collection("notificationDevices").document(fid)
                        .set(mapOf(
                            "fid" to fid,
                            "platform" to "android",
                            "updatedAt" to System.currentTimeMillis()
                        ))
                        .addOnSuccessListener { callback(null) }
                        .addOnFailureListener { callback(it.message ?: "Phone notification registration could not be saved.") }
                }
            } ?: callback("Firebase Messaging is not available.")
    }

    fun transcribePrivateChefVoice(
        recipeId: String,
        audioPath: String,
        callback: (CloudSecondPassResult?, String?) -> Unit
    ) {
        val user = currentUser ?: return callback(null, "Sign in before running ChefVoice Review.")
        val storage = storageOrNull() ?: return callback(null, "Cloud Storage is not available.")
        val functions = functionsOrNull() ?: return callback(null, "Cloud Functions are not available.")
        val audioFile = File(audioPath)
        if (!audioFile.exists() || audioFile.length() <= 44L) {
            callback(null, "The original local cooking audio could not be found.")
            return
        }

        val extension = audioFile.extension.lowercase().ifBlank { "wav" }
        val contentType = when (extension) {
            "wav" -> "audio/wav"
            "m4a", "mp4" -> "audio/mp4"
            "ogg" -> "audio/ogg"
            "flac" -> "audio/flac"
            "webm" -> "audio/webm"
            else -> "audio/mpeg"
        }
        if (!user.isEmailVerified) {
            callback(null, "Verify your email before using ChefVoice Review. Local Cook & Capture remains available.")
            return
        }
        val durationMs = audioDurationMs(audioFile)
        if (durationMs <= 0L) {
            callback(null, "ChefVoice could not read the original audio duration. The local recording was not changed.")
            return
        }
        if (durationMs > SECOND_PASS_MAX_DECLARED_DURATION_MS) {
            callback(null, "ChefVoice Review supports cooking recordings up to 90 minutes. The original local audio is unchanged.")
            return
        }
        val target = storage.reference.child(
            "privateVoice/${user.uid}/$recipeId/session"
        )
        authorizeStorageUpload("private_session", recipeId, "session", audioFile.length(), contentType) { permit, permitError ->
            if (permit == null) {
                callback(null, permitError ?: "ChefVoice could not authorize the private audio upload.")
                return@authorizeStorageUpload
            }
            val metadata = metadataWithPermit(contentType, permit, mapOf("chefvoiceDurationMs" to durationMs.toString()))
            target.putFile(Uri.fromFile(audioFile), metadata)
            .addOnSuccessListener {
                val callable = functions
                    .getHttpsCallable("transcribeChefVoice")
                    .withTimeout(30L, TimeUnit.MINUTES)
                callable.call(mapOf("recipeId" to recipeId))
                    .addOnSuccessListener { result ->
                        val data = result.data as? Map<*, *>
                        if (data == null) {
                            callback(null, "ChefVoice Review returned an unreadable response.")
                            return@addOnSuccessListener
                        }
                        val rawSegments = data["segments"] as? List<*> ?: emptyList<Any?>()
                        val segments = rawSegments.mapNotNull { row ->
                            val map = row as? Map<*, *> ?: return@mapNotNull null
                            val text = map["text"]?.toString()?.trim().orEmpty()
                            if (text.isBlank()) return@mapNotNull null
                            CloudSecondPassSegment(
                                text = text,
                                confidence = (map["confidence"] as? Number)?.toDouble()
                            )
                        }
                        callback(
                            CloudSecondPassResult(
                                provider = data["provider"]?.toString().orEmpty().ifBlank { "google-cloud-speech-v2" },
                                model = data["model"]?.toString().orEmpty().ifBlank { "chirp_3" },
                                transcript = data["transcript"]?.toString().orEmpty(),
                                segments = segments,
                                processedAt = (data["processedAt"] as? Number)?.toLong()
                                    ?: System.currentTimeMillis()
                            ),
                            null
                        )
                    }
                    .addOnFailureListener { error ->
                        val message = if (error is FirebaseFunctionsException) {
                            error.message ?: "ChefVoice Review failed (${error.code})."
                        } else {
                            error.message ?: "ChefVoice Review failed."
                        }
                        callback(null, message)
                    }
            }
            .addOnFailureListener { error ->
                callback(null, error.message ?: "Could not upload the private original cooking audio.")
            }
        }
    }

    /**
     * [isNewProfile] must be true only for the first write of a profile document.
     *
     * createdAt is immutable under the users update rule. Sending it on an edit put
     * it into diff().affectedKeys(), which the rule's allowlist rejects, so every
     * profile edit and every profile-photo save failed with PERMISSION_DENIED.
     */
    fun saveProfile(profile: ChefProfile, isNewProfile: Boolean = false, callback: (String?) -> Unit = {}) {
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val ref = db.collection("users").document(profile.uid)

        fun write(includeCreatedAt: Boolean) {
            val data = buildMap<String, Any> {
                put("displayName", profile.displayName.trim().ifBlank { "Chef" })
                put("bio", profile.bio.trim().take(500))
                put("photoUrl", profile.photoUrl)
                put("coverPhotoUrl", profile.coverPhotoUrl)
                put("favoriteThings", profile.favoriteThings.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(12))
                if (includeCreatedAt) put("createdAt", profile.createdAt)
            }
            ref.set(data, SetOptions.merge())
                .addOnSuccessListener { callback(null) }
                .addOnFailureListener { callback(it.message ?: "Could not save profile.") }
        }

        if (!isNewProfile) return write(includeCreatedAt = false)

        // Sign-up and the profile listener can both decide a profile is missing
        // before either write lands. Confirm the document really is absent, so the
        // loser of that race downgrades to a normal update instead of resending
        // createdAt and being denied.
        ref.get()
            .addOnSuccessListener { snapshot -> write(includeCreatedAt = !snapshot.exists()) }
            .addOnFailureListener { write(includeCreatedAt = true) }
    }


    fun uploadProfileImage(kind: String, uri: Uri, callback: (String?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in before adding profile photos.")
        val storage = storageOrNull() ?: return callback(null, "Cloud Storage is not available.")
        val safeKind = if (kind == "cover") "cover" else "avatar"
        val contentType = context.contentResolver.getType(uri) ?: "image/jpeg"
        val size = uriSize(uri)
        if (size <= 0L) return callback(null, "ChefVoice could not determine the profile image size.")
        val ref = storage.reference.child("profiles/${user.uid}/$safeKind/profile.jpg")
        authorizeStorageUpload(if (safeKind == "cover") "profile_cover" else "profile_avatar", fileName = "profile.jpg", bytes = size, contentType = contentType) { permit, permitError ->
            if (permit == null) { callback(null, permitError ?: "Profile image upload was not authorized."); return@authorizeStorageUpload }
            ref.putFile(uri, metadataWithPermit(contentType, permit))
                .continueWithTask { task ->
                    if (!task.isSuccessful) throw task.exception ?: IllegalStateException("Profile image upload failed.")
                    ref.downloadUrl
                }
                .addOnSuccessListener { callback(it.toString(), null) }
                .addOnFailureListener { callback(null, it.message ?: "Could not upload profile photo.") }
        }
    }

    fun listenProfile(uid: String, onChanged: (ChefProfile?) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).addSnapshotListener { snapshot, _ ->
            if (snapshot == null || !snapshot.exists()) onChanged(null)
            else onChanged(snapshot.toChefProfile())
        }
    }

    fun getProfile(uid: String, callback: (ChefProfile?) -> Unit) {
        if (uid.isBlank()) return callback(null)
        val db = dbOrNull() ?: return callback(null)
        db.collection("users").document(uid).get()
            .addOnSuccessListener { snapshot -> callback(if (snapshot.exists()) snapshot.toChefProfile() else null) }
            .addOnFailureListener { callback(null) }
    }

    fun getFollowerCount(uid: String, callback: (Long?, String?) -> Unit) {
        if (uid.isBlank()) return callback(0L, null)
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        db.collection("users").document(uid).get()
            .addOnSuccessListener { callback((it.getLong("followerCount") ?: 0L).coerceAtLeast(0L), null) }
            .addOnFailureListener { callback(null, it.message ?: "Follower count could not be loaded.") }
    }

    fun searchChefProfiles(searchText: String, callback: (List<ChefSearchResult>?, String?) -> Unit) {
        val term = searchText.trim().lowercase()
        if (term.length < 2) return callback(emptyList(), null)
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val matches = mutableListOf<ChefProfile>()
        var scanned = 0

        fun finish() {
            if (matches.isEmpty()) { callback(emptyList(), null); return }
            val results = arrayOfNulls<ChefSearchResult>(matches.size)
            val remaining = AtomicInteger(matches.size)
            matches.forEachIndexed { index, profile ->
                getFollowerCount(profile.uid) { count, _ ->
                    results[index] = ChefSearchResult(profile, count ?: 0L)
                    if (remaining.decrementAndGet() == 0) callback(results.filterNotNull(), null)
                }
            }
        }

        fun page(after: DocumentSnapshot?) {
            var query = db.collection("users").orderBy(com.google.firebase.firestore.FieldPath.documentId()).limit(50)
            if (after != null) query = query.startAfter(after)
            query.get()
                .addOnSuccessListener { snapshot ->
                    scanned += snapshot.size()
                    snapshot.documents.forEach { doc ->
                        if (matches.size >= 12) return@forEach
                        val profile = runCatching { doc.toChefProfile() }.getOrNull() ?: return@forEach
                        val haystack = listOf(profile.displayName, profile.bio).plus(profile.favoriteThings).joinToString(" ").lowercase()
                        if (haystack.contains(term)) matches += profile
                    }
                    val last = snapshot.documents.lastOrNull()
                    if (matches.size >= 12 || snapshot.size() < 50 || scanned >= 300 || last == null) finish() else page(last)
                }
                .addOnFailureListener { callback(null, it.message ?: "Chef search could not be loaded.") }
        }
        page(null)
    }

    fun listenPublicRecipes(onChanged: (List<Recipe>, Boolean) -> Unit, onError: (String) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("recipes")
            .whereEqualTo("isPublic", true)
            .orderBy("updatedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(communityPageSize)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Community feed could not be loaded.")
                    return@addSnapshotListener
                }
                publicRecipeCursor = snapshot?.documents?.lastOrNull()
                publicRecipeHasMore = snapshot?.size()?.toLong() == communityPageSize
                val recipes = snapshot?.documents.orEmpty().mapNotNull { runCatching { it.toCloudRecipe() }.getOrNull() }
                onChanged(recipes, publicRecipeHasMore)
            }
    }

    fun loadMorePublicRecipes(callback: (List<Recipe>?, Boolean, String?) -> Unit) {
        val db = dbOrNull() ?: return callback(null, false, "Firestore is not available.")
        val cursor = publicRecipeCursor ?: return callback(emptyList(), false, null)
        if (!publicRecipeHasMore) return callback(emptyList(), false, null)
        db.collection("recipes")
            .whereEqualTo("isPublic", true)
            .orderBy("updatedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .startAfter(cursor)
            .limit(communityPageSize)
            .get()
            .addOnSuccessListener { snapshot ->
                if (!snapshot.isEmpty) publicRecipeCursor = snapshot.documents.lastOrNull()
                publicRecipeHasMore = snapshot.size().toLong() == communityPageSize
                callback(snapshot.documents.mapNotNull { runCatching { it.toCloudRecipe() }.getOrNull() }, publicRecipeHasMore, null)
            }
            .addOnFailureListener { callback(null, publicRecipeHasMore, it.message ?: "Could not load more Community recipes.") }
    }

    fun publishRecipe(recipe: Recipe, displayName: String, callback: (Recipe?, String?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in before publishing to Community.", null)
        if (!user.isEmailVerified) return callback(null, "Verify your email before uploading Community media. Local Cook & Capture remains available.", null)
        if (recipe.media.size > MAX_PUBLISHED_MEDIA_SLOTS) return callback(null, "Community recipes can publish up to $MAX_PUBLISHED_MEDIA_SLOTS photo/video items. Extra local media was not uploaded.", null)
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.", null)
        val warnings = mutableListOf<String>()
        val recipeRef = db.collection("recipes").document(recipe.id)

        // Stage an owner-readable recipe before any Storage write. New recipes stay
        // private until their public media upload finishes; existing public recipes
        // keep their prior visibility while an owner edits them.
        recipeRef.get()
            .addOnSuccessListener { existing ->
                val trustedLikes = (existing.getLong("likes") ?: 0L).toInt().coerceAtLeast(0)
                val trustedComments = (existing.getLong("commentCount") ?: 0L).toInt().coerceAtLeast(0)
                val stage = recipe.copy(
                    isPublic = existing.exists() && existing.getBoolean("isPublic") == true,
                    authorId = user.uid,
                    authorName = displayName.ifBlank { "Chef" },
                    updatedAt = System.currentTimeMillis(),
                    likes = trustedLikes,
                    commentCount = trustedComments
                )
                recipeRef.set(stage.toCloudMap())
                    .addOnSuccessListener {
                        uploadMedia(recipe, user.uid, warnings) { uploadedMedia ->
                            uploadVoice(recipe, user.uid, warnings) { uploadedVoice ->
                                val pending = uploadedMedia.any { it.remoteUrl.isBlank() && it.path.isNotBlank() }
                                val published = recipe.copy(
                                    isPublic = !pending,
                                    authorId = user.uid,
                                    authorName = displayName.ifBlank { "Chef" },
                                    media = uploadedMedia,
                                    voiceClips = uploadedVoice,
                                    communityUpdatePending = pending,
                                    updatedAt = System.currentTimeMillis(),
                                    likes = trustedLikes,
                                    commentCount = trustedComments
                                )
                                recipeRef.set(published.toCloudMap())
                                    .addOnSuccessListener {
                                        val warning = warnings.takeIf { it.isNotEmpty() }?.joinToString(" ")
                                        callback(published, null, warning)
                                    }
                                    .addOnFailureListener { callback(null, it.message ?: "Could not publish recipe.", null) }
                            }
                        }
                    }
                    .addOnFailureListener { callback(null, it.message ?: "Could not prepare recipe media upload.", null) }
            }
            .addOnFailureListener { callback(null, it.message ?: "Could not verify recipe social counters.", null) }
    }

    fun inspectRecipeForMutation(recipeId: String, callback: (CloudRecipeMutationCheck?, String?) -> Unit) {
        currentUser ?: return callback(null, "Sign in first.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        db.collection("recipes").document(recipeId).get()
            .addOnSuccessListener { snapshot ->
                if (!snapshot.exists()) {
                    callback(CloudRecipeMutationCheck(exists = false, authorId = ""), null)
                } else {
                    callback(
                        CloudRecipeMutationCheck(
                            exists = true,
                            authorId = snapshot.getString("authorId").orEmpty()
                        ),
                        null
                    )
                }
            }
            .addOnFailureListener { callback(null, it.message ?: "Could not verify cloud recipe ownership.") }
    }

    fun unpublishRecipe(recipeId: String, callback: (String?) -> Unit) {
        val user = currentUser ?: return callback("Sign in first.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("recipes").document(recipeId)
            .update(mapOf("isPublic" to false, "updatedAt" to System.currentTimeMillis(), "authorId" to user.uid))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not remove recipe from Community.") }
    }

    fun deleteCloudRecipe(recipeId: String, callback: (String?) -> Unit = {}) {
        currentUser ?: return callback("Sign in first.")
        val functions = functionsOrNull() ?: return callback("Cloud Functions are not available.")
        functions.getHttpsCallable("deleteChefVoiceRecipe")
            .call(mapOf("recipeId" to recipeId))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not permanently delete cloud recipe.") }
    }

    fun listenLikedRecipeIds(uid: String, onChanged: (Set<String>) -> Unit): ListenerRegistration? =
        listenIdSet(uid, "likes", onChanged)

    fun listenBookmarkIds(uid: String, onChanged: (Set<String>) -> Unit): ListenerRegistration? =
        listenIdSet(uid, "bookmarks", onChanged)

    fun listenFollowingIds(uid: String, onChanged: (Set<String>) -> Unit): ListenerRegistration? =
        listenIdSet(uid, "following", onChanged)

    private fun listenIdSet(uid: String, collection: String, onChanged: (Set<String>) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).collection(collection)
            .addSnapshotListener { snapshot, _ -> onChanged(snapshot?.documents.orEmpty().map { it.id }.toSet()) }
    }

    fun toggleLike(recipeId: String, callback: (Boolean?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in to like recipes.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val recipeRef = db.collection("recipes").document(recipeId)
        val likeRef = recipeRef.collection("likes").document(user.uid)
        val userLikeRef = db.collection("users").document(user.uid).collection("likes").document(recipeId)
        var likedAfter = false

        db.runTransaction { tx ->
            val recipeSnap = tx.get(recipeRef)
            val likeSnap = tx.get(likeRef)
            if (!recipeSnap.exists()) throw IllegalStateException("Recipe no longer exists.")
            if (likeSnap.exists()) {
                likedAfter = false
                tx.delete(likeRef)
                tx.delete(userLikeRef)
            } else {
                likedAfter = true
                val data = mapOf("createdAt" to System.currentTimeMillis())
                tx.set(likeRef, data)
                tx.set(userLikeRef, data)
            }
        }.addOnSuccessListener { callback(likedAfter, null) }
            .addOnFailureListener { callback(null, it.message ?: "Could not update like.") }
    }

    fun toggleBookmark(recipeId: String, callback: (Boolean?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in to save Community recipes.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val ref = db.collection("users").document(user.uid).collection("bookmarks").document(recipeId)
        ref.get().addOnSuccessListener { snapshot ->
            if (snapshot.exists()) {
                ref.delete().addOnSuccessListener { callback(false, null) }
                    .addOnFailureListener { callback(null, it.message ?: "Could not remove bookmark.") }
            } else {
                ref.set(mapOf("recipeId" to recipeId, "createdAt" to System.currentTimeMillis()))
                    .addOnSuccessListener { callback(true, null) }
                    .addOnFailureListener { callback(null, it.message ?: "Could not save bookmark.") }
            }
        }.addOnFailureListener { callback(null, it.message ?: "Could not check bookmark.") }
    }

    fun toggleFollow(targetUid: String, callback: (Boolean?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in to follow chefs.")
        if (targetUid.isBlank() || targetUid == user.uid) return callback(null, "You cannot follow this profile.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val followingRef = db.collection("users").document(user.uid).collection("following").document(targetUid)
        val followerRef = db.collection("users").document(targetUid).collection("followers").document(user.uid)
        followingRef.get().addOnSuccessListener { snapshot ->
            val batch = db.batch()
            if (snapshot.exists()) {
                batch.delete(followingRef)
                batch.delete(followerRef)
                batch.commit().addOnSuccessListener { callback(false, null) }
                    .addOnFailureListener { callback(null, it.message ?: "Could not unfollow chef.") }
            } else {
                val data = mapOf("createdAt" to System.currentTimeMillis())
                batch.set(followingRef, data)
                batch.set(followerRef, data)
                batch.commit().addOnSuccessListener { callback(true, null) }
                    .addOnFailureListener { callback(null, it.message ?: "Could not follow chef.") }
            }
        }.addOnFailureListener { callback(null, it.message ?: "Could not check follow status.") }
    }

    fun listenNotifications(
        uid: String,
        onChanged: (List<ChefNotification>) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).collection("notifications")
            .orderBy("createdAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Notifications could not be loaded.")
                    return@addSnapshotListener
                }
                onChanged(snapshot?.documents.orEmpty().mapNotNull { doc ->
                    runCatching { doc.toChefNotification() }.getOrNull()
                })
            }
    }

    fun listenNotificationPreferences(
        uid: String,
        onChanged: (NotificationPreferences) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).collection("settings").document("notifications")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Notification preferences could not be loaded.")
                    return@addSnapshotListener
                }
                val data = snapshot?.data.orEmpty()
                onChanged(
                    NotificationPreferences(
                        messages = data["messages"] as? Boolean ?: true,
                        comments = data["comments"] as? Boolean ?: true,
                        likes = data["likes"] as? Boolean ?: true,
                        live = data["live"] as? Boolean ?: true,
                        followers = data["followers"] as? Boolean ?: true,
                        replies = data["replies"] as? Boolean ?: true
                    )
                )
            }
    }

    fun saveNotificationPreferences(preferences: NotificationPreferences, callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to update notification preferences.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("users").document(user.uid).collection("settings").document("notifications")
            .set(mapOf(
                "messages" to preferences.messages,
                "comments" to preferences.comments,
                "likes" to preferences.likes,
                "live" to preferences.live,
                "followers" to preferences.followers,
                "replies" to preferences.replies,
                "updatedAt" to System.currentTimeMillis()
            ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Notification preferences could not be saved.") }
    }

    fun markNotificationRead(notificationId: String, readAt: Long = System.currentTimeMillis(), callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to update notifications.")
        if (notificationId.isBlank()) return callback(null)
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("users").document(user.uid).collection("notifications").document(notificationId)
            .update("readAt", readAt.coerceAtLeast(1L))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Notification could not be marked read.") }
    }

    fun deleteNotifications(notificationIds: Collection<String>, callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to clear notifications.")
        val ids = notificationIds.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(100)
        if (ids.isEmpty()) return callback(null)
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val batch = db.batch()
        ids.forEach { id ->
            batch.delete(db.collection("users").document(user.uid).collection("notifications").document(id))
        }
        batch.commit()
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Notifications could not be cleared.") }
    }

    fun listenConversations(uid: String, onChanged: (List<DirectConversation>) -> Unit, onError: (String) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("conversations")
            .whereArrayContains("participantIds", uid)
            // Without an order the limit returned an arbitrary 100 conversations,
            // so a busy inbox could hide the newest thread. Needs the
            // participantIds + updatedAt composite index in firestore.indexes.json.
            .orderBy("updatedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Messages could not be loaded.")
                    return@addSnapshotListener
                }
                val conversations = snapshot?.documents.orEmpty()
                    .mapNotNull { runCatching { it.toDirectConversation() }.getOrNull() }
                    .sortedByDescending { it.updatedAt }
                onChanged(conversations)
            }
    }

    fun listenMessageReadAt(
        uid: String,
        onChanged: (Map<String, Long>) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).collection("messageReads")
            .limit(100)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Unread message status could not be loaded.")
                    return@addSnapshotListener
                }
                val reads = snapshot?.documents.orEmpty().associate { doc ->
                    doc.id to doc.data?.get("lastReadAt").asLong()
                }
                onChanged(reads)
            }
    }

    fun submitReport(
        targetType: String,
        targetId: String = "",
        targetUid: String = "",
        contextId: String = "",
        reason: String = "Safety concern",
        callback: (String?) -> Unit = {}
    ) {
        val user = currentUser ?: return callback("Sign in to report ChefVoice content.")
        val type = targetType.trim()
        if (type !in setOf("user", "recipe", "comment", "reply", "message")) return callback("Unsupported report type.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("reports").document().set(mapOf(
            "reporterUid" to user.uid,
            "targetType" to type,
            "targetId" to targetId.trim().take(180),
            "targetUid" to targetUid.trim().take(180),
            "contextId" to contextId.trim().take(180),
            "reason" to reason.trim().ifBlank { "Safety concern" }.take(500),
            "createdAt" to System.currentTimeMillis(),
            "status" to "open"
        )).addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not submit report.") }
    }

    fun listenBlockedUserIds(
        uid: String,
        onChanged: (Set<String>) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("users").document(uid).collection("blocks")
            .limit(500)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Blocked-chef status could not be loaded.")
                    return@addSnapshotListener
                }
                onChanged(snapshot?.documents.orEmpty().map { it.id }.toSet())
            }
    }

    fun setUserBlocked(blockedUid: String, blocked: Boolean, callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to manage blocked chefs.")
        if (blockedUid.isBlank() || blockedUid == user.uid) return callback("Choose another ChefVoice member.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val blockRef = db.collection("users").document(user.uid).collection("blocks").document(blockedUid)
        if (blocked) {
            blockRef.set(mapOf(
                "blockedUid" to blockedUid,
                "createdAt" to System.currentTimeMillis()
            ))
                .addOnSuccessListener { callback(null) }
                .addOnFailureListener { callback(it.message ?: "Chef could not be blocked.") }
        } else {
            blockRef.delete()
                .addOnSuccessListener { callback(null) }
                .addOnFailureListener { callback(it.message ?: "Chef could not be unblocked.") }
        }
    }

    fun markConversationRead(conversationId: String, lastReadAt: Long, callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in to update unread messages.")
        if (conversationId.isBlank() || lastReadAt <= 0L) return callback(null)
        val belongsToUser = conversationId.startsWith(user.uid + "--") || conversationId.endsWith("--" + user.uid)
        if (!belongsToUser) return callback("This conversation is not available to this account.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("users").document(user.uid).collection("messageReads").document(conversationId)
            .set(mapOf(
                "conversationId" to conversationId,
                "lastReadAt" to lastReadAt
            ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Unread message status could not be updated.") }
    }

    fun startConversation(
        targetUid: String,
        targetName: String,
        ownName: String,
        callback: (DirectConversation?, String?) -> Unit
    ) {
        val user = currentUser ?: return callback(null, "Sign in to message chefs.")
        if (targetUid.isBlank() || targetUid == user.uid) return callback(null, "Choose another ChefVoice member to message.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val ids = listOf(user.uid, targetUid).sorted()
        val conversationId = ids.joinToString("--")
        val ref = db.collection("conversations").document(conversationId)
        ref.get().addOnSuccessListener { snapshot ->
            val now = System.currentTimeMillis()
            val names = mapOf(
                user.uid to ownName.trim().ifBlank { "Chef" },
                targetUid to targetName.trim().ifBlank { "Chef" }
            )
            if (snapshot.exists()) {
                callback(snapshot.toDirectConversation(), null)
            } else {
                val data = mapOf(
                    "participantIds" to ids,
                    "participantNames" to names,
                    "lastMessage" to "",
                    "lastSenderId" to "",
                    "createdAt" to now,
                    "updatedAt" to now
                )
                ref.set(data)
                    .addOnSuccessListener { callback(
                        DirectConversation(
                            id = conversationId,
                            participantIds = ids,
                            participantNames = names,
                            createdAt = now,
                            updatedAt = now
                        ), null
                    ) }
                    .addOnFailureListener { callback(null, it.message ?: "Could not start messages.") }
            }
        }.addOnFailureListener { callback(null, it.message ?: "Could not check messages.") }
    }

    fun listenDirectMessages(
        conversationId: String,
        onChanged: (List<DirectMessage>) -> Unit,
        onError: (String) -> Unit
    ): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("conversations").document(conversationId).collection("messages")
            .orderBy("createdAt")
            .limit(250)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Conversation could not be loaded.")
                    return@addSnapshotListener
                }
                val messages = snapshot?.documents.orEmpty().mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    DirectMessage(
                        id = doc.id,
                        senderId = data["senderId"].asString(),
                        senderName = data["senderName"].asString().ifBlank { "Chef" },
                        text = data["text"].asString(),
                        createdAt = data["createdAt"].asLong()
                    )
                }
                onChanged(messages)
            }
    }

    fun sendDirectMessage(
        conversation: DirectConversation,
        text: String,
        senderName: String,
        callback: (String?) -> Unit
    ) {
        val user = currentUser ?: return callback("Sign in to send messages.")
        if (!conversation.participantIds.contains(user.uid)) return callback("This conversation is not available to this account.")
        val clean = text.trim().take(2000)
        if (clean.isBlank()) return callback("Write a message first.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val conversationRef = db.collection("conversations").document(conversation.id)
        val messageRef = conversationRef.collection("messages").document()
        val now = System.currentTimeMillis()
        messageRef.set(mapOf(
            "senderId" to user.uid,
            "senderName" to senderName.trim().ifBlank { "Chef" },
            "text" to clean,
            "createdAt" to now
        ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not send message.") }
    }

    fun listenComments(recipeId: String, onChanged: (List<RecipeComment>) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("recipes").document(recipeId).collection("comments")
            .orderBy("createdAt")
            .limit(100)
            .addSnapshotListener { snapshot, _ ->
                val comments = snapshot?.documents.orEmpty().mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    RecipeComment(
                        id = doc.id,
                        authorId = data["authorId"].asString(),
                        authorName = data["authorName"].asString().ifBlank { "Chef" },
                        text = data["text"].asString(),
                        createdAt = data["createdAt"].asLong(),
                        parentCommentId = data["parentCommentId"].asString(),
                        replyToUid = data["replyToUid"].asString(),
                        replyToName = data["replyToName"].asString()
                    )
                }
                onChanged(comments)
            }
    }

    fun addComment(recipeId: String, text: String, authorName: String, callback: (String?) -> Unit) {
        val user = currentUser ?: return callback("Sign in to comment.")
        val clean = text.trim().take(800)
        if (clean.isBlank()) return callback("Write a comment first.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val commentRef = db.collection("recipes").document(recipeId).collection("comments").document()
        commentRef.set(mapOf(
            "authorId" to user.uid,
            "authorName" to authorName.ifBlank { "Chef" },
            "text" to clean,
            "createdAt" to System.currentTimeMillis()
        ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not post comment.") }
    }

    fun addCommentReply(recipeId: String, parent: RecipeComment, text: String, authorName: String, callback: (String?) -> Unit) {
        val user = currentUser ?: return callback("Sign in to reply.")
        val clean = text.trim().take(800)
        if (clean.isBlank()) return callback("Write a reply first.")
        if (parent.id.isBlank()) return callback("That comment is no longer available.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val commentRef = db.collection("recipes").document(recipeId).collection("comments").document()
        commentRef.set(mapOf(
            "authorId" to user.uid,
            "authorName" to authorName.ifBlank { "Chef" },
            "text" to clean,
            "createdAt" to System.currentTimeMillis(),
            "parentCommentId" to parent.id,
            "replyToUid" to parent.authorId,
            "replyToName" to parent.authorName
        ))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not post reply.") }
    }

    fun listenLiveSessions(onChanged: (List<LiveSession>) -> Unit, onError: (String) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        val handler = Handler(Looper.getMainLooper())
        var latest = emptyList<LiveSession>()
        fun emit() {
            val now = System.currentTimeMillis()
            onChanged(latest.filter { it.isFreshLive(now) }.sortedByDescending { it.startedAt })
        }
        val refresh = object : Runnable {
            override fun run() {
                emit()
                handler.postDelayed(this, LIVE_LEASE_REFRESH_MS)
            }
        }
        val snapshotListener = db.collection("liveSessions")
            .whereEqualTo("status", "LIVE")
            .limit(50)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    onError(error.message ?: "Live sessions could not be loaded.")
                    return@addSnapshotListener
                }
                latest = snapshot?.documents.orEmpty()
                    .mapNotNull { runCatching { it.toLiveSession() }.getOrNull() }
                emit()
            }
        handler.postDelayed(refresh, LIVE_LEASE_REFRESH_MS)
        return object : ListenerRegistration {
            override fun remove() {
                handler.removeCallbacks(refresh)
                snapshotListener.remove()
            }
        }
    }

    private fun LiveSession.isFreshLive(now: Long = System.currentTimeMillis()): Boolean {
        if (status != "LIVE") return false
        if (heartbeatAt > 0L) return (now - heartbeatAt).coerceAtLeast(0L) <= LIVE_LEASE_TIMEOUT_MS
        return startedAt > 0L && (now - startedAt).coerceAtLeast(0L) <= LIVE_LEGACY_GRACE_MS
    }

    fun startLiveSession(title: String, hostName: String, callback: (LiveSession?, String?) -> Unit) {
        val user = currentUser ?: return callback(null, "Sign in before going live.")
        val db = dbOrNull() ?: return callback(null, "Firestore is not available.")
        val ref = db.collection("liveSessions").document()
        val session = LiveSession(
            id = ref.id,
            hostId = user.uid,
            hostName = hostName.trim().ifBlank { "Chef" },
            title = title.trim().ifBlank { "Live cooking" },
            status = "STARTING",
            startedAt = System.currentTimeMillis(),
            heartbeatAt = System.currentTimeMillis()
        )
        ref.set(session.toCloudMap())
            .addOnSuccessListener { callback(session, null) }
            .addOnFailureListener { callback(null, it.message ?: "Could not start live session.") }
    }

    fun markLiveSessionReady(sessionId: String, callback: (String?) -> Unit = {}) {
        currentUser ?: return callback("Sign in before broadcasting live.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("liveSessions").document(sessionId)
            .update(mapOf("status" to "LIVE", "heartbeatAt" to System.currentTimeMillis()))
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not mark Live room ready.") }
    }

    fun endLiveSession(sessionId: String, callback: (String?) -> Unit) {
        val user = currentUser ?: return callback("Sign in first.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("liveSessions").document(sessionId)
            .update(
                mapOf(
                    "status" to "ENDED",
                    "endedAt" to System.currentTimeMillis(),
                    "heartbeatAt" to 0L
                )
            )
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not end live session.") }
    }

    fun updateLiveHeartbeat(sessionId: String, callback: (String?) -> Unit = {}) {
        val user = currentUser ?: return callback("Sign in before broadcasting live.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        db.collection("liveSessions").document(sessionId)
            .update("heartbeatAt", System.currentTimeMillis())
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not renew Live lease.") }
    }

    fun listenLiveComments(sessionId: String, onChanged: (List<LiveComment>) -> Unit): ListenerRegistration? {
        val db = dbOrNull() ?: return null
        return db.collection("liveSessions").document(sessionId).collection("comments")
            .orderBy("createdAt")
            .limit(150)
            .addSnapshotListener { snapshot, _ ->
                val comments = snapshot?.documents.orEmpty().mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    LiveComment(
                        id = doc.id,
                        authorId = data["authorId"].asString(),
                        authorName = data["authorName"].asString().ifBlank { "Chef" },
                        text = data["text"].asString(),
                        createdAt = data["createdAt"].asLong()
                    )
                }
                onChanged(comments)
            }
    }

    fun addLiveComment(sessionId: String, text: String, authorName: String, callback: (String?) -> Unit) {
        val user = currentUser ?: return callback("Sign in to join live chat.")
        val clean = text.trim().take(500)
        if (clean.isBlank()) return callback("Write a live comment first.")
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val comment = mapOf(
            "authorId" to user.uid,
            "authorName" to authorName.ifBlank { "Chef" },
            "text" to clean,
            "createdAt" to System.currentTimeMillis()
        )
        db.collection("liveSessions").document(sessionId).collection("comments")
            .add(comment)
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not post live comment.") }
    }

    fun sendLiveReaction(sessionId: String, reaction: String, callback: (String?) -> Unit = {}) {
        val db = dbOrNull() ?: return callback("Firestore is not available.")
        val field = when (reaction) {
            "heart" -> "heartCount"
            "fire" -> "fireCount"
            "clap" -> "clapCount"
            else -> return callback("Unknown live reaction.")
        }
        val user = currentUser ?: return callback("Sign in to react to a live.")
        val liveRef = db.collection("liveSessions").document(sessionId)
        val stateRef = liveRef.collection("reactionState").document(user.uid)
        val batch = db.batch()
        batch.update(liveRef, field, FieldValue.increment(1L))
        batch.set(stateRef, mapOf("reaction" to reaction, "updatedAt" to System.currentTimeMillis()))
        batch.commit()
            .addOnSuccessListener { callback(null) }
            .addOnFailureListener { callback(it.message ?: "Could not send reaction.") }
    }

    private fun uploadMedia(
        recipe: Recipe,
        uid: String,
        warnings: MutableList<String>,
        done: (List<MediaAttachment>) -> Unit
    ) {
        val storage = storageOrNull()
        if (recipe.media.isEmpty() || storage == null) {
            if (recipe.media.any { it.remoteUrl.isBlank() }) warnings += "Photos/video stayed on this phone because Cloud Storage is not enabled."
            done(recipe.media)
            return
        }
        val output = recipe.media.toMutableList()
        fun next(index: Int) {
            if (index >= output.size) return done(output)
            val item = output[index]
            if (item.remoteUrl.isNotBlank() || item.path.isBlank() || !File(item.path).exists()) {
                next(index + 1)
                return
            }
            val file = File(item.path)
            val fileName = "slot-${index.toString().padStart(2, '0')}"
            val ref = storage.reference.child("recipes/$uid/${recipe.id}/publicMedia/$fileName")
            val contentType = when (file.extension.lowercase()) {
                "mp4", "mov", "webm", "mkv" -> if (file.extension.lowercase() == "webm") "video/webm" else "video/mp4"
                "png" -> "image/png"
                "webp" -> "image/webp"
                else -> "image/jpeg"
            }
            authorizeStorageUpload("public_media", recipe.id, fileName, file.length(), contentType) { permit, permitError ->
                if (permit == null) { warnings += permitError ?: "One photo/video upload was not authorized."; next(index + 1); return@authorizeStorageUpload }
                ref.putFile(Uri.fromFile(file), metadataWithPermit(contentType, permit))
                    .addOnSuccessListener {
                        ref.downloadUrl.addOnSuccessListener { uri ->
                            output[index] = item.copy(remoteUrl = uri.toString())
                            next(index + 1)
                        }.addOnFailureListener {
                            warnings += "One media download URL could not be created."
                            next(index + 1)
                        }
                    }
                    .addOnFailureListener {
                        warnings += "One photo/video stayed local (${it.message ?: "Storage unavailable"})."
                        next(index + 1)
                    }
            }
        }
        next(0)
    }

    private fun uploadVoice(
        recipe: Recipe,
        uid: String,
        warnings: MutableList<String>,
        done: (List<VoiceClip>) -> Unit
    ) {
        val storage = storageOrNull()
        if (recipe.voiceClips.isEmpty() || storage == null) {
            if (recipe.voiceClips.any { it.remoteUrl.isBlank() }) warnings += "Chef voice stayed on this phone because Cloud Storage is not enabled."
            done(recipe.voiceClips)
            return
        }
        val output = recipe.voiceClips.toMutableList()
        fun next(index: Int) {
            if (index >= output.size) return done(output)
            val clip = output[index]
            if (clip.remoteUrl.isNotBlank() || clip.path.isBlank() || !File(clip.path).exists()) {
                next(index + 1)
                return
            }
            val file = File(clip.path)
            val ext = file.extension.ifBlank { "m4a" }
            val isFullCookingSession = clip.label.equals("Full cooking session", ignoreCase = true)
            if (!isFullCookingSession && index >= MAX_PUBLIC_VOICE_SLOTS) {
                warnings += "One chef voice clip stayed local because Community voice is capped at $MAX_PUBLIC_VOICE_SLOTS clips."
                next(index + 1)
                return
            }
            val ref = if (isFullCookingSession) {
                storage.reference.child("privateVoice/$uid/${recipe.id}/session")
            } else {
                storage.reference.child("recipes/$uid/${recipe.id}/voice/clip-${index.toString().padStart(2, '0')}")
            }
            val contentType = when (ext.lowercase()) {
                "wav" -> "audio/wav"
                "m4a", "mp4" -> "audio/mp4"
                "ogg" -> "audio/ogg"
                "flac" -> "audio/flac"
                "webm" -> "audio/webm"
                else -> "audio/mpeg"
            }
            var durationMs = 0L
            if (isFullCookingSession) {
                durationMs = audioDurationMs(file)
                if (durationMs <= 0L || durationMs > SECOND_PASS_MAX_DECLARED_DURATION_MS) {
                    warnings += "Private cooking audio stayed local because its duration could not be verified within the 90-minute cloud limit."
                    next(index + 1)
                    return
                }
            }
            val fileName = if (isFullCookingSession) "session" else "clip-${index.toString().padStart(2, '0')}"
            val permitKind = if (isFullCookingSession) "private_session" else "voice_clip"
            authorizeStorageUpload(permitKind, recipe.id, fileName, file.length(), contentType) { permit, permitError ->
                if (permit == null) { warnings += permitError ?: "One chef voice upload was not authorized."; next(index + 1); return@authorizeStorageUpload }
                val extra = if (isFullCookingSession) mapOf("chefvoiceDurationMs" to durationMs.toString()) else emptyMap()
                ref.putFile(Uri.fromFile(file), metadataWithPermit(contentType, permit, extra))
                    .addOnSuccessListener {
                        if (isFullCookingSession) {
                            // Raw cooking-session audio stays private and is never given a
                            // tokenized public download URL or written into a public recipe doc.
                            output[index] = clip.copy(remoteUrl = "")
                            next(index + 1)
                        } else {
                            ref.downloadUrl.addOnSuccessListener { uri ->
                                output[index] = clip.copy(remoteUrl = uri.toString())
                                next(index + 1)
                            }.addOnFailureListener {
                                warnings += "One chef voice download URL could not be created."
                                next(index + 1)
                            }
                        }
                    }
                    .addOnFailureListener {
                        warnings += "One chef voice clip stayed local (${it.message ?: "Storage unavailable"})."
                        next(index + 1)
                    }
            }
        }
        next(0)
    }
}

private fun Recipe.toCloudMap(): Map<String, Any> = mapOf(
    "id" to id,
    "title" to title,
    "description" to description,
    "servings" to servings,
    "prepTimeMinutes" to prepTimeMinutes,
    "cookTimeMinutes" to cookTimeMinutes,
    "ingredients" to ingredients.map { mapOf("id" to it.id, "quantity" to it.quantity, "unit" to it.unit, "name" to it.name) },
    "steps" to steps,
    "stepIds" to stableStepIds(),
    "media" to media.filter { it.remoteUrl.isNotBlank() }.map {
        mapOf("id" to it.id, "type" to it.type.name, "url" to it.remoteUrl, "stepId" to it.stepId, "caption" to it.caption)
    },
    "voiceClips" to voiceClips
        .filter { it.remoteUrl.isNotBlank() && !it.label.equals("Full cooking session", ignoreCase = true) }
        .map {
            mapOf("id" to it.id, "label" to it.label, "createdAt" to it.createdAt, "url" to it.remoteUrl)
        },
    "isPublic" to isPublic,
    "authorId" to authorId,
    "authorName" to authorName,
    "createdAt" to createdAt,
    "updatedAt" to updatedAt,
    "likes" to likes,
    "commentCount" to commentCount
)

private fun LiveSession.toCloudMap(): Map<String, Any> = mapOf(
    "hostId" to hostId,
    "hostName" to hostName,
    "title" to title,
    "status" to status,
    "startedAt" to startedAt,
    "heartbeatAt" to heartbeatAt,
    "endedAt" to endedAt,
    "heartCount" to heartCount,
    "fireCount" to fireCount,
    "clapCount" to clapCount
)

private fun DocumentSnapshot.toChefProfile(): ChefProfile {
    val data = data.orEmpty()
    return ChefProfile(
        uid = id,
        displayName = data["displayName"].asString().ifBlank { "Chef" },
        bio = data["bio"].asString(),
        photoUrl = data["photoUrl"].asString(),
        coverPhotoUrl = data["coverPhotoUrl"].asString(),
        favoriteThings = data["favoriteThings"].asStringList(),
        createdAt = data["createdAt"].asLong().takeIf { it > 0L } ?: System.currentTimeMillis()
    )
}

private fun DocumentSnapshot.toCloudRecipe(): Recipe {
    val data = data.orEmpty()
    val ingredients = data["ingredients"].asMapList().map { item ->
        Ingredient(
            id = item["id"].asString().ifBlank { UUID.randomUUID().toString() },
            quantity = item["quantity"].asString(),
            unit = item["unit"].asString(),
            name = item["name"].asString()
        )
    }
    val media = data["media"].asMapList().map { item ->
        MediaAttachment(
            id = item["id"].asString().ifBlank { UUID.randomUUID().toString() },
            path = "",
            type = runCatching { MediaType.valueOf(item["type"].asString()) }.getOrDefault(MediaType.IMAGE),
            remoteUrl = item["url"].asString(),
            stepId = item["stepId"].asString(),
            caption = item["caption"].asString()
        )
    }
    val voice = data["voiceClips"].asMapList().map { item ->
        VoiceClip(
            id = item["id"].asString().ifBlank { UUID.randomUUID().toString() },
            path = "",
            label = item["label"].asString().ifBlank { "Chef voice" },
            createdAt = item["createdAt"].asLong(),
            remoteUrl = item["url"].asString()
        )
    }
    return Recipe(
        id = id,
        title = data["title"].asString(),
        description = data["description"].asString(),
        servings = data["servings"].asLong().toInt().coerceAtLeast(1),
        prepTimeMinutes = data["prepTimeMinutes"].asLong().toInt().coerceAtLeast(0),
        cookTimeMinutes = data["cookTimeMinutes"].asLong().toInt().coerceAtLeast(0),
        ingredients = ingredients,
        steps = data["steps"].asStringList(),
        stepIds = data["stepIds"].asStringList(),
        media = media,
        voiceClips = voice,
        transcript = emptyList(),
        isPublic = data["isPublic"] as? Boolean ?: false,
        authorId = data["authorId"].asString(),
        authorName = data["authorName"].asString().ifBlank { "Chef" },
        createdAt = data["createdAt"].asLong(),
        updatedAt = data["updatedAt"].asLong(),
        likes = data["likes"].asLong().toInt().coerceAtLeast(0),
        commentCount = data["commentCount"].asLong().toInt().coerceAtLeast(0)
    )
}


private fun DocumentSnapshot.toChefReport(): ChefReport {
    val data = data.orEmpty()
    return ChefReport(
        id = id,
        reporterUid = data["reporterUid"].asString(),
        targetType = data["targetType"].asString(),
        targetId = data["targetId"].asString(),
        targetUid = data["targetUid"].asString(),
        contextId = data["contextId"].asString(),
        reason = data["reason"].asString().ifBlank { "Safety concern" },
        status = data["status"].asString().ifBlank { "open" },
        moderatorNote = data["moderatorNote"].asString(),
        action = data["action"].asString(),
        createdAt = data["createdAt"].asLong(),
        reviewedAt = data["reviewedAt"].asLong()
    )
}

private fun DocumentSnapshot.toChefNotification(): ChefNotification {
    val data = data.orEmpty()
    return ChefNotification(
        id = id,
        type = data["type"].asString(),
        actorUid = data["actorUid"].asString(),
        actorName = data["actorName"].asString().ifBlank { "Chef" },
        title = data["title"].asString().ifBlank { "ChefVoice" },
        body = data["body"].asString(),
        recipeId = data["recipeId"].asString(),
        conversationId = data["conversationId"].asString(),
        liveSessionId = data["liveSessionId"].asString(),
        commentId = data["commentId"].asString(),
        createdAt = data["createdAt"].asLong(),
        readAt = data["readAt"].asLong()
    )
}

private fun DocumentSnapshot.toDirectConversation(): DirectConversation {
    val data = data.orEmpty()
    return DirectConversation(
        id = id,
        participantIds = data["participantIds"].asStringList(),
        participantNames = data["participantNames"].asStringMap(),
        lastMessage = data["lastMessage"].asString(),
        lastSenderId = data["lastSenderId"].asString(),
        createdAt = data["createdAt"].asLong(),
        updatedAt = data["updatedAt"].asLong()
    )
}

private fun DocumentSnapshot.toLiveSession(): LiveSession {
    val data = data.orEmpty()
    return LiveSession(
        id = id,
        hostId = data["hostId"].asString(),
        hostName = data["hostName"].asString().ifBlank { "Chef" },
        title = data["title"].asString().ifBlank { "Live cooking" },
        status = data["status"].asString().ifBlank { "LIVE" },
        startedAt = data["startedAt"].asLong(),
        heartbeatAt = data["heartbeatAt"].asLong(),
        endedAt = data["endedAt"].asLong(),
        heartCount = data["heartCount"].asLong().toInt().coerceAtLeast(0),
        fireCount = data["fireCount"].asLong().toInt().coerceAtLeast(0),
        clapCount = data["clapCount"].asLong().toInt().coerceAtLeast(0)
    )
}

private fun Any?.asString(): String = this as? String ?: ""
private fun Any?.asLong(): Long = (this as? Number)?.toLong() ?: 0L
private fun Any?.asStringList(): List<String> = (this as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
private fun Any?.asStringMap(): Map<String, String> = (this as? Map<*, *>)?.mapNotNull { (key, value) ->
    val k = key as? String ?: return@mapNotNull null
    val v = value as? String ?: return@mapNotNull null
    k to v
}?.toMap() ?: emptyMap()
@Suppress("UNCHECKED_CAST")
private fun Any?.asMapList(): List<Map<String, Any?>> = (this as? List<*>)?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()
