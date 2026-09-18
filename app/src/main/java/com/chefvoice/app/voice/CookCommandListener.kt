package com.chefvoice.app.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.chefvoice.app.util.CookCommand
import com.chefvoice.app.util.CookCommands
import java.util.Locale

/**
 * Listens for a short spoken command while the chef is cooking with their hands full.
 *
 * This is **not** the capture pipeline and shares no code with it. Nothing it hears is
 * transcribed, kept, parsed or written anywhere: each recognition result is matched
 * against a small fixed command vocabulary and then discarded. Anything that is not
 * one of those commands is ignored entirely, which is what keeps kitchen conversation
 * from driving the screen.
 *
 * It rolls its own sessions because Android's recognizer ends one whenever the speaker
 * pauses, and a chef cooking is mostly pausing. A session that ends is simply started
 * again until [stop] is called.
 */
class CookCommandListener(
    context: Context,
    private val onCommand: (CookCommand) -> Unit,
    private val onStatus: (String) -> Unit
) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false
    /** Guards against a restart scheduled by a session that has already been replaced. */
    private var generation = 0

    val isRunning: Boolean get() = running

    fun start(): Boolean {
        if (running) return true
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            onStatus("Hands-free needs speech recognition, which this phone does not have.")
            return false
        }
        running = true
        generation++
        return try {
            createRecognizer()
            listen()
            onStatus("Hands-free on · say \"next\", \"back\" or \"read out loud\"")
            true
        } catch (t: Throwable) {
            running = false
            releaseRecognizer()
            onStatus("Hands-free could not start: ${t.message ?: "the microphone is busy"}")
            false
        }
    }

    fun stop() {
        if (!running) return
        running = false
        generation++
        releaseRecognizer()
        onStatus("")
    }

    private fun createRecognizer() {
        releaseRecognizer()
        val created = SpeechRecognizer.createSpeechRecognizer(appContext)
        created.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                // Acting on a partial makes the screen jump while the chef is still
                // speaking, so partials are only used to catch a command early when it
                // is unambiguous on its own.
                handle(partialResults, fromPartial = true)
            }

            override fun onResults(results: Bundle?) {
                handle(results, fromPartial = false)
                restart(120)
            }

            override fun onError(error: Int) {
                // Silence and timeouts are the normal state of a kitchen, not failures.
                val fatal = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                if (fatal) {
                    running = false
                    releaseRecognizer()
                    onStatus("Hands-free needs microphone permission.")
                    return
                }
                restart(if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 600 else 250)
            }
        })
        recognizer = created
    }

    private fun handle(bundle: Bundle?, fromPartial: Boolean) {
        if (!running) return
        val heard = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
        // Every alternative is checked, not just the top one: a one-word command is
        // exactly where the recognizer's first guess is least reliable.
        val command = heard.firstNotNullOfOrNull { CookCommands.match(it) } ?: return
        if (fromPartial && !command.safeFromPartial) return
        mainHandler.post { if (running) onCommand(command) }
    }

    private fun restart(delayMs: Long) {
        if (!running) return
        val issuedAt = generation
        mainHandler.postDelayed({
            if (!running || issuedAt != generation) return@postDelayed
            runCatching { listen() }.onFailure {
                // A recognizer that will not restart is recreated once rather than
                // leaving hands-free silently dead with the toggle still showing on.
                runCatching { createRecognizer(); listen() }
                    .onFailure { onStatus("Hands-free stopped. Tap to try again.") }
            }
        }, delayMs)
    }

    private fun listen() {
        recognizer?.startListening(commandIntent())
    }

    private fun releaseRecognizer() {
        recognizer?.let {
            runCatching { it.stopListening() }
            runCatching { it.cancel() }
            runCatching { it.destroy() }
        }
        recognizer = null
    }

    /**
     * Biased hard toward the command words. Unlike capture, this recognizer is not
     * trying to understand cooking narration -- it only has to tell six words apart
     * from everything else a kitchen contains.
     */
    private fun commandIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            putStringArrayListExtra(
                RecognizerIntent.EXTRA_BIASING_STRINGS,
                ArrayList(CookCommands.biasingWords)
            )
        }
    }
}
