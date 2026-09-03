package com.chefvoice.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.chefvoice.app.MainActivity
import com.chefvoice.app.R

/**
 * Keeps the microphone (and, while broadcasting, the camera) alive when ChefVoice
 * is not the foreground app.
 *
 * Android 11 cuts microphone input to background apps and Android 9 blocks the
 * camera outright. Without this service a cooking session recorded silence the
 * moment the chef switched apps or the screen locked, and a Live broadcast had to
 * be killed on ON_STOP to avoid it dying silently.
 */
class ChefVoiceForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val mode = intent?.getStringExtra(EXTRA_MODE).orEmpty()
        if (intent?.action == ACTION_STOP || mode.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        ensureChannel(this)
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (mode == MODE_LIVE) "ChefVoice is live" else "ChefVoice is listening")
            .setContentText(
                if (mode == MODE_LIVE) "Your kitchen is broadcasting. Tap to return."
                else "Recording your cooking session. Tap to return."
            )
            .setOngoing(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java)
                        .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (mode == MODE_LIVE) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            startForeground(NOTIFICATION_ID, notification, types)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY
    }

    companion object {
        const val CHANNEL_ID = "chefvoice_capture"
        const val MODE_COOKING = "cooking"
        const val MODE_LIVE = "live"
        private const val EXTRA_MODE = "chefvoice_capture_mode"
        private const val ACTION_STOP = "com.chefvoice.app.STOP_CAPTURE"
        private const val NOTIFICATION_ID = 4711

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Cooking capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shown while ChefVoice is recording a cooking session or broadcasting Live."
                setShowBadge(false)
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        /**
         * Safe to call when the service is already running; the system just
         * redelivers the intent. Never throws: on the rare devices that refuse a
         * foreground start, capture continues in the foreground app as before.
         */
        fun start(context: Context, mode: String) {
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, ChefVoiceForegroundService::class.java).putExtra(EXTRA_MODE, mode)
                )
            }
        }

        fun stop(context: Context) {
            runCatching {
                context.stopService(Intent(context, ChefVoiceForegroundService::class.java))
            }
        }
    }
}
