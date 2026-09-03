package com.chefvoice.app

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

/** Production App Check bootstrap. Release builds attest with Play Integrity. */
internal object AppCheckBootstrap {
    private const val TAG = "ChefVoiceAppCheck"

    fun install(context: Context) {
        val firebaseApp = FirebaseApp.initializeApp(context)
        if (firebaseApp == null) {
            Log.i(TAG, "Firebase is not configured; App Check stayed inactive for this local-only build.")
            return
        }
        FirebaseAppCheck.getInstance(firebaseApp).installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
    }
}
