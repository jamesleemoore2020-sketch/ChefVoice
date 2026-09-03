package com.chefvoice.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.chefvoice.app.MainActivity
import com.chefvoice.app.R

object NotificationHelper {
    const val CHANNEL_ID = "chefvoice_social_activity"
    const val EXTRA_EVENT_ID = "chefvoice_notification_event_id"
    const val EXTRA_TYPE = "chefvoice_notification_type"
    const val EXTRA_LIVE_SESSION_ID = "chefvoice_notification_live_session_id"
    const val EXTRA_RECIPE_ID = "chefvoice_notification_recipe_id"
    const val EXTRA_COMMENT_ID = "chefvoice_notification_comment_id"
    private const val PREFS = "chefvoice_notifications"
    private const val SEEN_EVENTS = "shown_event_ids"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "ChefVoice activity",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Messages, comments, likes, followed-chef Live alerts, and other ChefVoice activity"
        }
        manager.createNotificationChannel(channel)
    }

    fun showSocialNotification(
        context: Context,
        eventId: String,
        title: String,
        body: String,
        type: String = "",
        recipeId: String = "",
        liveSessionId: String = "",
        commentId: String = ""
    ) {
        if (eventId.isBlank() || alreadyShown(context, eventId)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(context)

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_EVENT_ID, eventId)
            putExtra(EXTRA_TYPE, type)
            putExtra(EXTRA_RECIPE_ID, recipeId)
            putExtra(EXTRA_LIVE_SESSION_ID, liveSessionId)
            putExtra(EXTRA_COMMENT_ID, commentId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            eventId.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title.ifBlank { "ChefVoice" })
            .setContentText(body.ifBlank { "You have new ChefVoice activity." })
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.ifBlank { "You have new ChefVoice activity." }))
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(pendingIntent)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(eventId.hashCode(), notification)
        rememberShown(context, eventId)
    }

    private fun alreadyShown(context: Context, eventId: String): Boolean {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SEEN_EVENTS, "").orEmpty()
        return raw.split('|').any { it == eventId }
    }

    private fun rememberShown(context: Context, eventId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val existing = prefs.getString(SEEN_EVENTS, "").orEmpty()
            .split('|')
            .filter { it.isNotBlank() && it != eventId }
        val next = (existing + eventId).takeLast(100).joinToString("|")
        prefs.edit().putString(SEEN_EVENTS, next).apply()
    }
}
