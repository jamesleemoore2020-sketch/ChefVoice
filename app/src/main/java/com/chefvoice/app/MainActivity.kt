package com.chefvoice.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.chefvoice.app.notifications.NotificationHelper
import com.chefvoice.app.ui.ChefVoiceApp

class MainActivity : ComponentActivity() {
    private var pendingLiveSessionId by mutableStateOf("")
    private var pendingNotificationEventId by mutableStateOf("")

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Android 15 draws every targetSdk-35+ app edge to edge with no opt-out.
        // Declaring it here means the system bars get transparent, correctly
        // contrasted backgrounds instead of the app silently painting under them.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Install App Check before any Firebase-backed repository can be created.
        // Debug builds use a private debug token; release builds use Play Integrity.
        AppCheckBootstrap.install(this)
        NotificationHelper.ensureChannel(this)
        requestNotificationPermissionOnce()
        captureNotificationIntent(intent)
        setContent {
            ChefVoiceApp(
                pendingLiveSessionId = pendingLiveSessionId,
                onLiveNotificationConsumed = ::consumeLiveNotificationRoute,
                pendingNotificationEventId = pendingNotificationEventId,
                onNotificationEventConsumed = ::consumeNotificationEventRoute
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureNotificationIntent(intent)
    }

    private fun captureNotificationIntent(intent: Intent?) {
        val type = intent?.getStringExtra(NotificationHelper.EXTRA_TYPE).orEmpty()
        if (type == "live") {
            val sessionId = intent?.getStringExtra(NotificationHelper.EXTRA_LIVE_SESSION_ID).orEmpty()
            if (sessionId.isNotBlank()) pendingLiveSessionId = sessionId
            return
        }
        val eventId = intent?.getStringExtra(NotificationHelper.EXTRA_EVENT_ID).orEmpty()
        if (eventId.isNotBlank()) pendingNotificationEventId = eventId
    }

    private fun consumeLiveNotificationRoute(sessionId: String) {
        if (pendingLiveSessionId != sessionId) return
        pendingLiveSessionId = ""
        intent?.removeExtra(NotificationHelper.EXTRA_EVENT_ID)
        intent?.removeExtra(NotificationHelper.EXTRA_TYPE)
        intent?.removeExtra(NotificationHelper.EXTRA_LIVE_SESSION_ID)
    }

    private fun consumeNotificationEventRoute(eventId: String) {
        if (pendingNotificationEventId != eventId) return
        pendingNotificationEventId = ""
        intent?.removeExtra(NotificationHelper.EXTRA_EVENT_ID)
        intent?.removeExtra(NotificationHelper.EXTRA_TYPE)
        intent?.removeExtra(NotificationHelper.EXTRA_RECIPE_ID)
        intent?.removeExtra(NotificationHelper.EXTRA_COMMENT_ID)
    }

    private fun requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences("chefvoice_notifications", MODE_PRIVATE)
        if (prefs.getBoolean("permission_prompted", false)) return
        prefs.edit().putBoolean("permission_prompted", true).apply()
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
