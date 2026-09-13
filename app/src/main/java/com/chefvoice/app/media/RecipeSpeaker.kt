package com.chefvoice.app.media

import android.content.Context
import android.speech.tts.TextToSpeech

/**
 * Thin wrapper around Android's built-in text-to-speech engine, used to read
 * recipe steps aloud hands-free while cooking. The constructor is async, so
 * speak() silently no-ops until onInit reports success -- there is no
 * synchronous alternative in the platform API.
 */
class RecipeSpeaker(context: Context) {
    private var ready = false
    private val engine = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
    }

    fun speak(text: String) {
        if (!ready || text.isBlank()) return
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "chefvoice-step")
    }

    fun stop() {
        engine.stop()
    }

    fun shutdown() {
        engine.shutdown()
    }
}
