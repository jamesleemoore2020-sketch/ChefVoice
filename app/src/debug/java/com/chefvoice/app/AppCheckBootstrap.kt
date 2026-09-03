package com.chefvoice.app

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Private sideload/test App Check bootstrap.
 *
 * The generated debug secret must be registered in Firebase Console before it
 * becomes VALID. Never commit or share the secret. Production/release builds
 * compile a different implementation that uses Play Integrity.
 */
internal object AppCheckBootstrap {
    private const val TAG = "ChefVoiceAppCheck"

    fun install(context: Context) {
        val firebaseApp = FirebaseApp.initializeApp(context)
        if (firebaseApp == null) {
            Log.i(TAG, "Firebase is not configured; App Check stayed inactive for this local-only build.")
            return
        }

        val appCheck = FirebaseAppCheck.getInstance(firebaseApp)
        appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())

        // Request once at startup so Firebase emits the private debug secret to
        // local Logcat on first run. Registration is intentionally a manual Console
        // step so no secret is ever baked into source or build scripts.
        appCheck.getAppCheckToken(false)
            .addOnSuccessListener {
                Log.i(TAG, "App Check debug token exchange succeeded; monitoring requests can be VALID.")
            }
            .addOnFailureListener { error ->
                Log.w(
                    TAG,
                    "App Check debug provider is active but not yet validated. Register the locally generated debug secret in Firebase Console; enforcement remains off.",
                    error
                )
            }
    }
}
