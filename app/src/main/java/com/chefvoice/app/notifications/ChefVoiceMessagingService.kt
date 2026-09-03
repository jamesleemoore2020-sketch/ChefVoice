package com.chefvoice.app.notifications

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class ChefVoiceMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        super.onRegistered(installationId)
        saveInstallationForSignedInUser(installationId)
    }

    override fun onUnregistered(installationId: String) {
        super.onUnregistered(installationId)
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        FirebaseFirestore.getInstance()
            .collection("users").document(uid)
            .collection("notificationDevices").document(installationId)
            .delete()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        val recipientUid = data["recipientUid"].orEmpty()
        val currentUid = FirebaseAuth.getInstance().currentUser?.uid.orEmpty()

        // Notification payloads are intentionally data-only. This account check keeps
        // stale device registrations from exposing one user's alerts after sign-out.
        if (recipientUid.isBlank() || recipientUid != currentUid) return

        NotificationHelper.showSocialNotification(
            context = this,
            eventId = data["eventId"].orEmpty(),
            title = data["title"].orEmpty(),
            body = data["body"].orEmpty(),
            type = data["type"].orEmpty(),
            recipeId = data["recipeId"].orEmpty(),
            liveSessionId = data["liveSessionId"].orEmpty(),
            commentId = data["commentId"].orEmpty()
        )
    }

    private fun saveInstallationForSignedInUser(installationId: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        FirebaseFirestore.getInstance()
            .collection("users").document(uid)
            .collection("notificationDevices").document(installationId)
            .set(
                mapOf(
                    "fid" to installationId,
                    "platform" to "android",
                    "updatedAt" to System.currentTimeMillis()
                )
            )
    }
}
